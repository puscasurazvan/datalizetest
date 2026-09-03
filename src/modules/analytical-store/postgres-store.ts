/**
 * `PostgresAnalyticalStore` — the Postgres implementation of the analytical
 * store's write surface (./types.ts, docs/adr/0002, this module's
 * CLAUDE.md).
 *
 * Pool discipline (src/db/CLAUDE.md "Three pools, never cross them"):
 * - DDL that touches the `analytical` schema (`CREATE TABLE`, `TRUNCATE`,
 *   `DROP TABLE`) and row loading (`COPY ... FROM STDIN`) run on
 *   `importPool` — never on `analyticalPool`, which is reserved for
 *   interactive query execution and never touched by this module.
 * - Every write to `analytical_tables` / `analytical_columns` — this
 *   module's own registry, a `public`-schema metadata table — runs on the
 *   application pool (`db`, `@/db/client`), after the physical DDL has
 *   already succeeded. This is the "no transaction across pools" ordering
 *   docs/decisions/06 #16 requires: the physical operation commits first,
 *   the metadata commit is strictly last, so a crash in between leaves at
 *   worst a stale metadata row an idempotent retry corrects — never a
 *   metadata row pointing at a physical table that doesn't exist.
 */
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import { asc, eq } from "drizzle-orm"
import { from as pgCopyFrom } from "pg-copy-streams"

import type { ResolvedQuery } from "@/modules/queries"
import { analyticalPool, importPool } from "@/db/analytical"
import { db } from "@/db/client"
import { analyticalColumns, analyticalTables, datasetVersions } from "@/db/schema"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"
import { scopedWhere } from "@/shared/repository"

import { compileQuery } from "./compile-query"
import { encodeCopyLine } from "./copy-encoding"
import type { CopyColumn } from "./copy-encoding"
import { runQuery } from "./execute-query"
import {
  ANALYTICAL_SCHEMA,
  assertDatasetVersionId,
  physicalColumnName,
  physicalTableName,
  qualifiedTableName,
  quoteIdentifier,
} from "./physical-names"
import type {
  AnalyticalColumnDefinition,
  AnalyticalColumnType,
  AnalyticalRow,
  AnalyticalStore,
  AnalyticalTableSummary,
  ExecuteResult,
  LoadRowsResult,
  ReadRowsResult,
} from "./types"

/**
 * A preview is a screenful, not a page of results. Capped here as well as
 * in the caller so the cap is a property of the store rather than of
 * whoever happens to call it.
 */
const MAX_PREVIEW_ROWS = 200

/**
 * Every cell is selected as `::text`, so a value is a string or null —
 * the same shape `AnalyticalRow` uses for loading, and the same reason:
 * a `decimal` must not become a JS number on the way out any more than on
 * the way in (docs/decisions/06 #11).
 */
function toRowByColumnId(
  mapping: readonly { columnId: string }[],
  values: readonly unknown[],
): AnalyticalRow {
  const row: Record<string, string | null> = {}
  mapping.forEach((column, index) => {
    const value = values[index]
    row[column.columnId] = typeof value === "string" ? value : null
  })
  return row
}

/**
 * The six Datalize column types, mapped to Postgres (docs/decisions/04,
 * docs/decisions/06 #11). `decimal` is `numeric`, never `double precision`
 * — a `SUM(amount)` over a million rows must not lose precision on the
 * product's first query, and `numeric` crosses the wire as a string,
 * matching how `AnalyticalRow` already represents a decimal cell.
 */
const PG_TYPE_BY_ANALYTICAL_TYPE: Record<AnalyticalColumnType, string> = {
  string: "text",
  integer: "bigint",
  decimal: "numeric",
  boolean: "boolean",
  date: "date",
  timestamptz: "timestamptz",
}

/**
 * Wraps an unexpected failure from the pg driver (DDL or `COPY`) so its
 * `.message` — which can and does name the physical table
 * (`relation "analytical.dv_..." does not exist`) — never becomes this
 * module's own thrown error's message. Deliberately a plain `Error`, not
 * an `AppError`: none of the small, closed `AppErrorCode` set
 * (src/shared/errors/index.ts) names "unexpected storage failure", and
 * `toSafeDto` already masks any non-`AppError` behind a generic `INTERNAL`
 * message regardless of what `.message` says — so forcing a wrong code
 * onto this would buy no additional safety, only a misleading label. The
 * original error is preserved as `cause` for server-side logs.
 */
function safeStoreError(message: string, cause: unknown): Error {
  return new Error(message, { cause })
}

async function assertVersionInOrganization(
  context: RequestContext,
  datasetVersionId: string,
): Promise<void> {
  const [version] = await db
    .select({ id: datasetVersions.id })
    .from(datasetVersions)
    .where(scopedWhere(context, datasetVersions, eq(datasetVersions.id, datasetVersionId)))
    .limit(1)

  if (!version) {
    throw new AppError("NOT_FOUND", "Dataset version not found.")
  }
}

type RegisteredTable = {
  readonly tableName: string
}

async function findRegisteredTable(
  context: RequestContext,
  datasetVersionId: string,
): Promise<RegisteredTable | undefined> {
  const [table] = await db
    .select({ tableName: analyticalTables.tableName })
    .from(analyticalTables)
    .where(
      scopedWhere(
        context,
        analyticalTables,
        eq(analyticalTables.datasetVersionId, datasetVersionId),
      ),
    )
    .limit(1)

  return table
}

type ColumnMapping = readonly { readonly columnId: string; readonly physicalName: string }[]

/**
 * The Column ID -> physical name mapping for one Dataset Version, in
 * ordinal order. Shared by `loadRows`, `readRows`, and `execute` so there
 * is exactly one query for it, not three copies that can drift apart.
 */
async function loadColumnMapping(
  context: RequestContext,
  datasetVersionId: string,
): Promise<ColumnMapping> {
  return db
    .select({
      columnId: analyticalColumns.columnId,
      physicalName: analyticalColumns.physicalName,
    })
    .from(analyticalColumns)
    .where(
      scopedWhere(
        context,
        analyticalColumns,
        eq(analyticalColumns.datasetVersionId, datasetVersionId),
      ),
    )
    .orderBy(asc(analyticalColumns.ordinal))
}

export class PostgresAnalyticalStore implements AnalyticalStore {
  async createVersionTable(
    context: RequestContext,
    datasetVersionId: string,
    columns: readonly AnalyticalColumnDefinition[],
  ): Promise<AnalyticalTableSummary> {
    assertDatasetVersionId(datasetVersionId)
    await assertVersionInOrganization(context, datasetVersionId)

    const tableName = physicalTableName(datasetVersionId)
    const qualifiedTable = qualifiedTableName(datasetVersionId)
    const columnDefinitions = columns
      .map(
        (column, ordinal) =>
          `${quoteIdentifier(physicalColumnName(ordinal))} ${PG_TYPE_BY_ANALYTICAL_TYPE[column.type]}`,
      )
      .join(", ")

    const ddlClient = await importPool.connect()
    try {
      // Idempotent by construction: IF NOT EXISTS makes a second CREATE a
      // no-op, and the unconditional TRUNCATE that follows clears any rows
      // a previous, incomplete attempt already loaded — together these are
      // what let a Trigger.dev retry of import.load converge instead of
      // duplicating or failing (docs/decisions/06 #16).
      await ddlClient.query(`CREATE TABLE IF NOT EXISTS ${qualifiedTable} (${columnDefinitions})`)
      await ddlClient.query(`TRUNCATE TABLE ${qualifiedTable}`)
    } catch (error) {
      throw safeStoreError("Could not create the dataset version's physical table.", error)
    } finally {
      ddlClient.release()
    }

    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(analyticalTables)
          .values({
            datasetVersionId,
            organizationId: context.organizationId,
            schemaName: ANALYTICAL_SCHEMA,
            tableName,
          })
          .onConflictDoUpdate({
            target: analyticalTables.datasetVersionId,
            set: { schemaName: ANALYTICAL_SCHEMA, tableName, droppedAt: null },
          })

        // Delete-then-reinsert rather than a per-row upsert: a retry's
        // `columns` is expected to be identical to the first attempt's,
        // but this also converges correctly if it is not (e.g. a
        // corrected `confirmedSchema` after a failed first load), which a
        // partial upsert onto stale rows would not.
        await tx
          .delete(analyticalColumns)
          .where(
            scopedWhere(
              context,
              analyticalColumns,
              eq(analyticalColumns.datasetVersionId, datasetVersionId),
            ),
          )

        if (columns.length > 0) {
          await tx.insert(analyticalColumns).values(
            columns.map((column, ordinal) => ({
              id: randomUUID(),
              organizationId: context.organizationId,
              datasetVersionId,
              columnId: column.columnId,
              physicalName: physicalColumnName(ordinal),
              pgType: PG_TYPE_BY_ANALYTICAL_TYPE[column.type],
              ordinal,
            })),
          )
        }
      })
    } catch (error) {
      throw safeStoreError("Could not persist the dataset version's column mapping.", error)
    }

    return { datasetVersionId, columnIds: columns.map((column) => column.columnId) }
  }

  async loadRows(
    context: RequestContext,
    datasetVersionId: string,
    rows: AsyncIterable<AnalyticalRow>,
  ): Promise<LoadRowsResult> {
    assertDatasetVersionId(datasetVersionId)

    const table = await findRegisteredTable(context, datasetVersionId)
    if (!table) {
      throw new AppError(
        "NOT_FOUND",
        "No physical table is registered for this dataset version. Call createVersionTable first.",
      )
    }

    const mapping = await loadColumnMapping(context, datasetVersionId)

    if (mapping.length === 0) {
      // Zero-column dataset versions are rejected upstream — `import.load`
      // (../imports/internal/load.ts) throws before ever calling
      // `createVersionTable` with an empty column list — so this branch is
      // a defensive backstop for a caller that reaches `loadRows` directly
      // against a zero-column registration. `rows` must still be closed
      // even though nothing here reads it: returning without ever
      // touching it abandons the caller's stream (an S3 object body, in
      // the real path) open indefinitely, since nothing else will ever
      // read or destroy it. Pulling exactly one item then breaking is the
      // minimal way to trigger cleanup — an async generator's `finally`
      // (e.g. `../imports/internal/csv-stream.ts`'s `streamRows`, which
      // destroys its source stream there) only runs once the generator has
      // been entered at least once; `break` then calls the iterator's own
      // `return()`, which propagates through that `finally` and releases
      // the underlying reader, without reading the rest of the object.
      for await (const firstRow of rows) {
        void firstRow // pulled only to trigger cleanup below — its value is never otherwise read.
        break
      }
      return { rowCount: 0 }
    }

    const copyColumns: CopyColumn[] = mapping.map((column) => ({ columnId: column.columnId }))
    const columnList = mapping.map((column) => quoteIdentifier(column.physicalName)).join(", ")
    const copySql = `COPY ${qualifiedTableName(datasetVersionId)} (${columnList}) FROM STDIN`

    const client = await importPool.connect()
    try {
      const copyStream = client.query(pgCopyFrom(copySql))
      await pipeline(Readable.from(encodedLines(rows, copyColumns)), copyStream)
      client.release()
      return { rowCount: copyStream.rowCount }
    } catch (error) {
      client.release(error instanceof Error ? error : new Error(String(error)))
      throw safeStoreError("Could not load rows into the dataset version's physical table.", error)
    }
  }

  async readRows(
    context: RequestContext,
    datasetVersionId: string,
    limit: number,
  ): Promise<ReadRowsResult> {
    assertDatasetVersionId(datasetVersionId)

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PREVIEW_ROWS) {
      throw new AppError("VALIDATION", `Preview limit must be between 1 and ${MAX_PREVIEW_ROWS}.`)
    }

    const table = await findRegisteredTable(context, datasetVersionId)
    if (!table) {
      throw new AppError("NOT_FOUND", "This dataset version has no loaded data.")
    }

    const mapping = await loadColumnMapping(context, datasetVersionId)

    if (mapping.length === 0) {
      return { columnIds: [], rows: [] }
    }

    // Physical names come from this module's own registry rows, never from
    // the caller, and `limit` is an integer bounded above — so the only
    // interpolated text is server-generated. `quoteIdentifier` is belt and
    // braces on top of that.
    const projection = mapping
      .map((column) => `${quoteIdentifier(column.physicalName)}::text`)
      .join(", ")
    const sql = `SELECT ${projection} FROM ${qualifiedTableName(datasetVersionId)} LIMIT ${limit}`

    const client = await analyticalPool.connect()
    try {
      // rowMode "array" so two logical columns mapping to the same physical
      // name could never collide into one key, and so the result's column
      // order is positional rather than dependent on driver key ordering.
      const result = await client.query({ text: sql, rowMode: "array" })
      const rows = result.rows.map((values) => toRowByColumnId(mapping, values))
      return { columnIds: mapping.map((column) => column.columnId), rows }
    } catch (error) {
      throw safeStoreError("Could not read rows from the dataset version's table.", error)
    } finally {
      client.release()
    }
  }

  async execute(
    context: RequestContext,
    datasetVersionId: string,
    query: ResolvedQuery,
    engineLimit: number,
  ): Promise<ExecuteResult> {
    assertDatasetVersionId(datasetVersionId)

    const table = await findRegisteredTable(context, datasetVersionId)
    if (!table) {
      throw new AppError("NOT_FOUND", "This dataset version has no loaded data.")
    }

    const mapping = await loadColumnMapping(context, datasetVersionId)
    const physicalNameByColumnId = new Map(
      mapping.map((column): [string, string] => [column.columnId, column.physicalName]),
    )

    // compileQuery is pure — it can throw AppError("VALIDATION") itself for
    // an unrecognized timezone, before this method ever opens a connection.
    const compiled = compileQuery(
      query,
      physicalNameByColumnId,
      qualifiedTableName(datasetVersionId),
      context.organizationTimezone,
      engineLimit,
    )

    // Dimensions then measures — compileQuery's own SELECT order — so
    // position `i` in every returned row is named by position `i` here.
    const keys = [
      ...query.dimensions.map((dimension) => dimension.column.id),
      ...query.measures.map((measure) => measure.alias),
    ]

    const { rows, durationMs } = await runQuery(context.organizationId, compiled, keys)
    return { keys, rows, durationMs }
  }

  async dropVersion(context: RequestContext, datasetVersionId: string): Promise<void> {
    assertDatasetVersionId(datasetVersionId)

    const table = await findRegisteredTable(context, datasetVersionId)
    if (!table) {
      // Idempotent no-op — mirrors StorageProvider.deleteObject
      // (src/modules/storage/provider.ts): nothing registered, nothing to do.
      return
    }

    const ddlClient = await importPool.connect()
    try {
      await ddlClient.query(`DROP TABLE IF EXISTS ${qualifiedTableName(datasetVersionId)}`)
    } catch (error) {
      throw safeStoreError("Could not drop the dataset version's physical table.", error)
    } finally {
      ddlClient.release()
    }

    try {
      await db.transaction(async (tx) => {
        await tx
          .delete(analyticalColumns)
          .where(
            scopedWhere(
              context,
              analyticalColumns,
              eq(analyticalColumns.datasetVersionId, datasetVersionId),
            ),
          )
        await tx
          .delete(analyticalTables)
          .where(
            scopedWhere(
              context,
              analyticalTables,
              eq(analyticalTables.datasetVersionId, datasetVersionId),
            ),
          )
      })
    } catch (error) {
      throw safeStoreError("Could not remove the dataset version's column mapping.", error)
    }
  }
}

async function* encodedLines(
  rows: AsyncIterable<AnalyticalRow>,
  columns: readonly CopyColumn[],
): AsyncGenerator<string> {
  for await (const row of rows) {
    yield `${encodeCopyLine(row, columns)}\n`
  }
}
