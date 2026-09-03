/**
 * `import.load` (docs/decisions/06 #1, #16). Creates the physical table
 * through the analytical store, streams rows into it against
 * `imports.confirmed_schema`, records unparseable/ambiguous/nonexistent
 * cells in `import_errors`, and commits `dataset_versions` /
 * `datasets.current_version_id` / `imports` metadata strictly last — see
 * `../CLAUDE.md`.
 *
 * Retry convergence (docs/decisions/06 #16): every step here is
 * idempotent by construction — `deleteImportErrors` clears the previous
 * attempt's rows, `createRunningVersion` claims the same version id on a
 * retry (it only runs when `imports.dataset_version_id` is still unset),
 * `createVersionTable` truncates before loading, and `finalizeVersion`
 * delete-then-reinserts `dataset_columns`. A second dispatch of an already
 * `COMPLETED` import is a pure no-op — this is what makes "dispatch load
 * twice -> one version, no duplicate rows" hold.
 */
import type { Readable } from "node:stream"

import { streamRows } from "./csv-stream"
import { encodeCell } from "./cell-encoding"
import { resolveColumnIds } from "./column-continuity"
import type { NewColumn, ResolvedColumn } from "./column-continuity"
import { ImportErrorRecorder } from "./error-recorder"
import { parseConfirmedSchema } from "./schema-types"
import { toNodeReadable } from "./storage-stream"

import type { AnalyticalRow, AnalyticalStore } from "@/modules/analytical-store"
import { ObjectKey } from "@/modules/storage"
import type { StorageProvider } from "@/modules/storage"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

import {
  createRunningVersion,
  finalizeVersion,
  findCurrentVersionColumns,
  markVersionFailed,
} from "../repository/dataset-version-repository"
import { deleteImportErrors, insertImportErrors } from "../repository/import-error-repository"
import {
  getImportForContext,
  markImportCompleted,
  markImportFailed,
} from "../repository/import-repository"
import type { ImportRow } from "../repository/import-repository"

export type LoadImportDeps = {
  readonly storage: StorageProvider
  readonly analyticalStore: AnalyticalStore
}

const ERROR_MESSAGES = {
  UNPARSEABLE_VALUE: (columnName: string, type: string) =>
    `Value in column "${columnName}" could not be parsed as ${type}.`,
  FIELD_COUNT_MISMATCH: (expected: number, actual: number) =>
    `Row has ${actual} fields, expected ${expected}.`,
  AMBIGUOUS_LOCAL_TIME: (columnName: string) =>
    `Value in column "${columnName}" is an ambiguous local time during a DST fall-back; resolved to the earlier instant.`,
  NONEXISTENT_LOCAL_TIME: (columnName: string) =>
    `Value in column "${columnName}" is a local time that does not exist during a DST spring-forward; resolved forward.`,
  ENCODING: (columnName: string) =>
    `Value in column "${columnName}" contains an invalid character and could not be loaded.`,
} as const

export async function loadImport(
  context: RequestContext,
  importId: string,
  deps: LoadImportDeps,
): Promise<void> {
  const importRow = await getImportForContext(context, importId)
  if (importRow.status === "COMPLETED" || importRow.status === "CANCELLED") {
    return
  }

  if (importRow.confirmedSchema === null) {
    await markImportFailed(
      context,
      importId,
      "MISSING_CONFIRMED_SCHEMA",
      "No confirmed schema was recorded for this import.",
    )
    return
  }

  try {
    await runLoad(context, importRow, deps)
  } catch (error) {
    if (error instanceof AppError) {
      await markImportFailed(context, importId, error.code, error.message)
      await markVersionFailedIfClaimed(context, importId)
      return
    }
    await markImportFailed(context, importId, "INTERNAL", "Load failed unexpectedly.")
    await markVersionFailedIfClaimed(context, importId)
    throw error
  }
}

/**
 * Marks the Dataset Version this attempt claimed FAILED alongside the
 * import, so the two never drift (docs/decisions/06 #16's shared status
 * enum exists precisely so they can't). Re-fetches the row rather than
 * trusting the `importRow` snapshot `runLoad` was called with: a version is
 * claimed by `createRunningVersion` partway through `runLoad`, in its own
 * committed transaction, so a failure after that point has already
 * persisted `imports.datasetVersionId` — the pre-call snapshot would still
 * show `null`. A failure before a version was ever claimed (no version
 * exists yet) leaves this a no-op, correctly.
 */
async function markVersionFailedIfClaimed(
  context: RequestContext,
  importId: string,
): Promise<void> {
  const current = await getImportForContext(context, importId)
  if (current.datasetVersionId !== null) {
    await markVersionFailed(context, current.datasetVersionId)
  }
}

async function runLoad(
  context: RequestContext,
  importRow: ImportRow,
  deps: LoadImportDeps,
): Promise<void> {
  const confirmedSchema = parseConfirmedSchema(importRow.confirmedSchema)

  // Retry convergence: clears whatever the previous attempt recorded before
  // this attempt records its own (docs/decisions/06 #16) — a no-op on a
  // first attempt.
  await deleteImportErrors(context, importRow.id)

  const versionId =
    importRow.datasetVersionId ??
    (await createRunningVersion(context, {
      importId: importRow.id,
      datasetId: importRow.datasetId,
      timezone: confirmedSchema.timezone,
    }))

  const previousColumns = await findCurrentVersionColumns(context, importRow.datasetId)
  const newColumns: readonly NewColumn[] = confirmedSchema.columns.map((column) => ({
    position: column.position,
    name: column.name,
    type: column.type,
  }))
  const resolvedColumns = resolveColumnIds(previousColumns, newColumns)

  // Defensive backstop: `import.profile` (./profile.ts) already rejects an
  // empty file (no header at all) before the user is ever asked to
  // confirm, so this should be unreachable in practice — but a zero-column
  // `confirmedSchema` must never reach `createVersionTable` regardless of
  // how it got here. Without this, a zero-column physical table is created
  // and `finalizeVersion` marks the version COMPLETED with rowCount 0,
  // columnCount 0: a dataset that can never be queried, reported to the
  // user as a successful import.
  if (resolvedColumns.length === 0) {
    throw new AppError("VALIDATION", "The confirmed schema has no columns to load.")
  }

  await deps.analyticalStore.createVersionTable(
    context,
    versionId,
    resolvedColumns.map((column) => ({ columnId: column.columnId, type: column.type })),
  )

  const keyResult = ObjectKey.parse(importRow.objectKey, context.organizationId)
  if (!keyResult.ok) {
    throw new AppError("VALIDATION", "The import's stored object key is invalid.")
  }
  const objectStream = await deps.storage.readObject(keyResult.key)
  if (objectStream === undefined) {
    throw new AppError("NOT_FOUND", "The uploaded file could not be found in storage.")
  }

  const nullableByColumnId = new Map<string, boolean>(
    resolvedColumns.map((column) => [column.columnId, false] as const),
  )
  // Bounded-memory error recording (docs/decisions/06 #5) — see
  // ./error-recorder.ts's module doc for the defect this replaces.
  // `importRow.byteSize` is the object's real, already-known size
  // (`start.ts`'s `statObject` check), threaded through so a byte-ceiling
  // rejection mid-stream names the file's true size, not the parser's
  // read position at the moment it tripped.
  const recorder = new ImportErrorRecorder((batch) =>
    insertImportErrors(context, importRow.id, batch),
  )

  const loadResult = await deps.analyticalStore.loadRows(
    context,
    versionId,
    encodeRows(
      toNodeReadable(objectStream),
      resolvedColumns,
      confirmedSchema.timezone,
      nullableByColumnId,
      recorder,
      importRow.byteSize,
    ),
  )

  await recorder.finish()

  await finalizeVersion(context, {
    versionId,
    datasetId: importRow.datasetId,
    columns: resolvedColumns,
    nullableByColumnId,
    rowCount: loadResult.rowCount,
  })

  await markImportCompleted(context, importRow.id, {
    rowsImported: loadResult.rowCount,
    rowsRejected: recorder.rowsRejected,
  })
}

/**
 * Streams the object's data rows, encoding each cell for its confirmed
 * type (../internal/cell-encoding.ts) and yielding one `AnalyticalRow` per
 * CSV row — never letting a value `COPY` cannot cast reach
 * `AnalyticalStore.loadRows` (that module's doc: `COPY` is all-or-nothing).
 * `nullableByColumnId` is filled in and `recorder` is written to as a side
 * effect while the caller's `for await` (inside `loadRows`) drains this
 * generator; `recorder`'s buffered errors are only guaranteed flushed once
 * the caller has awaited `recorder.finish()` after the stream ends.
 */
async function* encodeRows(
  input: Readable,
  columns: readonly ResolvedColumn[],
  timezone: string,
  nullableByColumnId: Map<string, boolean>,
  recorder: ImportErrorRecorder,
  knownTotalBytes: number,
): AsyncGenerator<AnalyticalRow> {
  const rows = streamRows(input, { knownTotalBytes })

  for await (const rawRow of rows) {
    const rowNumber = rows.counts.rowsRead
    let rowHadError = false

    if (rawRow.length !== columns.length) {
      await recorder.record({
        rowNumber,
        columnName: null,
        errorCode: "FIELD_COUNT_MISMATCH",
        message: ERROR_MESSAGES.FIELD_COUNT_MISMATCH(columns.length, rawRow.length),
      })
      rowHadError = true
    }

    const record: Record<string, string | null> = {}
    for (const column of columns) {
      const raw = rawRow[column.position - 1] ?? ""
      const encoded = encodeCell(raw, column.type, timezone)

      if (encoded.kind === "null") {
        record[column.columnId] = null
        nullableByColumnId.set(column.columnId, true)
        continue
      }

      if (encoded.kind === "unparseable" || encoded.kind === "encoding") {
        record[column.columnId] = null
        nullableByColumnId.set(column.columnId, true)
        const message =
          encoded.kind === "encoding"
            ? ERROR_MESSAGES.ENCODING(column.name)
            : ERROR_MESSAGES.UNPARSEABLE_VALUE(column.name, column.type)
        // The recorder's own sequential flush-on-threshold behavior
        // (docs/decisions/06 #5): each cell must be recorded before the
        // next is processed so the recorder never buffers more than its
        // batch size.
        // oxlint-disable-next-line no-await-in-loop -- see above.
        await recorder.record({
          rowNumber,
          columnName: column.name,
          errorCode: encoded.kind === "encoding" ? "ENCODING" : "UNPARSEABLE_VALUE",
          message,
        })
        rowHadError = true
        continue
      }

      record[column.columnId] = encoded.value
      if (encoded.kind === "ambiguous" || encoded.kind === "nonexistent") {
        const errorCode =
          encoded.kind === "ambiguous" ? "AMBIGUOUS_LOCAL_TIME" : "NONEXISTENT_LOCAL_TIME"
        // oxlint-disable-next-line no-await-in-loop -- see above.
        await recorder.record({
          rowNumber,
          columnName: column.name,
          errorCode,
          message: ERROR_MESSAGES[errorCode](column.name),
        })
        rowHadError = true
      }
    }

    if (rowHadError) {
      recorder.markRowRejected()
    }
    yield record
  }
}
