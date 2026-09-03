import { randomUUID } from "node:crypto"

import { and, eq } from "drizzle-orm"
import type { PoolClient } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { analyticalPool, importPool } from "@/db/analytical"
import { applicationPool, db } from "@/db/client"
import {
  analyticalColumns,
  analyticalTables,
  datasetColumns,
  datasets,
  datasetVersions,
  organizations,
  queryExecutions,
  users,
} from "@/db/schema"
import { PostgresAnalyticalStore } from "@/modules/analytical-store"
import type { AnalyticalColumnDefinition, AnalyticalRow } from "@/modules/analytical-store"
import { slotKeys } from "@/modules/analytical-store/execution-slots"
import { executeQuery } from "@/modules/queries"
import type { QueryAst } from "@/modules/queries"
import { createTestRequestContext } from "@/shared/context/testing"

// End-to-end coverage of `executeQuery` (queries/CLAUDE.md "Audit &
// resolution", plan section 5 step 10) against the real test database: the
// one thing a pure unit test cannot observe is that the `query_executions`
// audit row actually lands, on both the success and failure branches, with
// the fields G9/G10 settled — validator/limits/compiler each already have
// their own pure unit coverage, so every query here is deliberately trivial.
describe("executeQuery (integration)", () => {
  const store = new PostgresAnalyticalStore()
  const runId = randomUUID()
  const userId = randomUUID()
  const organizationId = randomUUID()
  const context = createTestRequestContext({
    userId,
    organizationId,
    role: "owner",
    organizationTimezone: "America/Chicago",
  })

  const createdVersionIds: string[] = []

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      name: "Query Executor Test User",
      email: `query-executor-${runId}@example.test`,
      emailVerified: true,
    })
    await db.insert(organizations).values({
      id: organizationId,
      name: "Query Executor Test Org",
      slug: `query-executor-${runId}`,
    })
  })

  afterAll(async () => {
    for (const versionId of createdVersionIds) {
      // oxlint-disable-next-line no-await-in-loop -- test teardown, not a hot path; dropVersion drops one physical table at a time.
      await store.dropVersion(context, versionId)
    }
    await db.delete(queryExecutions).where(eq(queryExecutions.organizationId, organizationId))
    await db.delete(datasetColumns).where(eq(datasetColumns.organizationId, organizationId))
    await db.delete(analyticalColumns).where(eq(analyticalColumns.organizationId, organizationId))
    await db.delete(analyticalTables).where(eq(analyticalTables.organizationId, organizationId))
    await db.delete(datasetVersions).where(eq(datasetVersions.organizationId, organizationId))
    await db.delete(datasets).where(eq(datasets.organizationId, organizationId))
    await db.delete(organizations).where(eq(organizations.id, organizationId))
    await db.delete(users).where(eq(users.id, userId))
    await importPool.end()
    await analyticalPool.end()
    await applicationPool.end()
  })

  /**
   * A complete, queryable Dataset Version: `dataset_columns` (what
   * `getDatasetSchema` reads) and the physical table (what `store.execute`
   * reads) built from the same `columns`, so the two can never disagree the
   * way a hand-maintained pair of fixtures could.
   */
  async function seedDataset(
    columns: readonly AnalyticalColumnDefinition[],
    rows: readonly AnalyticalRow[],
  ): Promise<{ datasetId: string; versionId: string }> {
    const datasetId = randomUUID()
    const versionId = randomUUID()

    await db.insert(datasets).values({
      id: datasetId,
      organizationId,
      name: `Query Executor Test Dataset ${datasetId}`,
      createdByUserId: userId,
    })
    await db.insert(datasetVersions).values({
      id: versionId,
      organizationId,
      datasetId,
      versionNumber: 1,
      status: "COMPLETED",
      rowCount: rows.length,
      columnCount: columns.length,
      timezoneUsedForNaiveTimestamps: "UTC",
      completedAt: new Date(),
    })
    await db.update(datasets).set({ currentVersionId: versionId }).where(eq(datasets.id, datasetId))
    await db.insert(datasetColumns).values(
      columns.map((column, index) => ({
        id: randomUUID(),
        columnId: column.columnId,
        organizationId,
        datasetVersionId: versionId,
        name: column.columnId,
        type: column.type,
        nullable: false,
        position: index,
      })),
    )

    await store.createVersionTable(context, versionId, columns)
    await store.loadRows(context, versionId, rowsFrom(rows))
    createdVersionIds.push(versionId)

    return { datasetId, versionId }
  }

  const COL_QTY = "col_qty"

  it("writes one success row and returns a QueryResult keyed to it", async () => {
    const { datasetId, versionId } = await seedDataset(
      [{ columnId: COL_QTY, type: "integer" }],
      [{ [COL_QTY]: "1" }, { [COL_QTY]: "2" }, { [COL_QTY]: "3" }],
    )
    const ast: QueryAst = {
      version: 1,
      datasetId,
      dimensions: [],
      measures: [{ field: null, aggregation: "count", alias: "n" }],
      filters: [],
    }

    const result = await executeQuery(context, ast)

    expect(result.rowCount).toBe(result.rows.length)
    expect(result.rows).toEqual([{ n: "3" }])

    const row = await auditRow(versionId)
    expect(row.organizationId).toBe(organizationId)
    expect(row.datasetVersionId).toBe(versionId)
    expect(row.organizationTimezone).toBe(context.organizationTimezone)
    expect(row.status).toBe("success")
    expect(row.rowCount).toBe(result.rowCount)
    expect(row.id).toBe(result.queryId)
  })

  it("a removed Column ID raises SCHEMA_INCOMPATIBLE naming it, and writes a failed row with rowCount null", async () => {
    const { datasetId, versionId } = await seedDataset(
      [{ columnId: COL_QTY, type: "integer" }],
      [{ [COL_QTY]: "1" }],
    )
    const ast: QueryAst = {
      version: 1,
      datasetId,
      dimensions: [{ columnId: "col_removed" }],
      measures: [{ field: null, aggregation: "count", alias: "n" }],
      filters: [],
    }

    await expect(executeQuery(context, ast)).rejects.toMatchObject({
      code: "SCHEMA_INCOMPATIBLE",
      message: expect.stringContaining("col_removed"),
    })

    const row = await auditRow(versionId)
    expect(row.status).toBe("failed")
    expect(row.rowCount).toBeNull()
    expect(row.errorCode).toBe("SCHEMA_INCOMPATIBLE")
  })

  it("refuses an unpinned currency aggregate with VALIDATION, and writes a failed row", async () => {
    const COL_AMOUNT = "col_amount"
    const COL_CURRENCY = "col_currency"
    const { datasetId, versionId } = await seedDataset(
      [
        { columnId: COL_AMOUNT, type: "decimal" },
        { columnId: COL_CURRENCY, type: "string" },
      ],
      [
        { [COL_AMOUNT]: "10.00", [COL_CURRENCY]: "USD" },
        { [COL_AMOUNT]: "10.00", [COL_CURRENCY]: "EUR" },
      ],
    )
    // dataset_columns.name is the Column ID itself (seedDataset), so
    // singleCurrencyRefusal's case-insensitive name match needs a column
    // literally named "currency" — give this one that human name directly.
    await db
      .update(datasetColumns)
      .set({ name: "currency" })
      .where(
        and(
          eq(datasetColumns.columnId, COL_CURRENCY),
          eq(datasetColumns.datasetVersionId, versionId),
        ),
      )

    const ast: QueryAst = {
      version: 1,
      datasetId,
      dimensions: [],
      measures: [{ field: COL_AMOUNT, aggregation: "sum", alias: "total" }],
      filters: [],
    }

    await expect(executeQuery(context, ast)).rejects.toMatchObject({ code: "VALIDATION" })

    const row = await auditRow(versionId)
    expect(row.status).toBe("failed")
    expect(row.rowCount).toBeNull()
    expect(row.errorCode).toBe("VALIDATION")
  })

  it("a store failure (CONCURRENCY_LIMIT) still writes a failed row, and the error is rethrown", async () => {
    const { datasetId, versionId } = await seedDataset(
      [{ columnId: COL_QTY, type: "integer" }],
      [{ [COL_QTY]: "1" }],
    )
    const ast: QueryAst = {
      version: 1,
      datasetId,
      dimensions: [],
      measures: [{ field: null, aggregation: "count", alias: "n" }],
      filters: [],
    }

    const holders = await holdAllSlots(organizationId)
    try {
      await expect(executeQuery(context, ast)).rejects.toMatchObject({ code: "CONCURRENCY_LIMIT" })
    } finally {
      await releaseSlotHolders(holders)
    }

    const row = await auditRow(versionId)
    expect(row.status).toBe("failed")
    expect(row.rowCount).toBeNull()
    expect(row.errorCode).toBe("CONCURRENCY_LIMIT")
  })

  it("an unknown datasetId raises NOT_FOUND and writes no audit row", async () => {
    const countBefore = (
      await db
        .select()
        .from(queryExecutions)
        .where(eq(queryExecutions.organizationId, organizationId))
    ).length

    const ast: QueryAst = {
      version: 1,
      datasetId: randomUUID(),
      dimensions: [],
      measures: [{ field: null, aggregation: "count", alias: "n" }],
      filters: [],
    }

    await expect(executeQuery(context, ast)).rejects.toMatchObject({ code: "NOT_FOUND" })

    const countAfter = (
      await db
        .select()
        .from(queryExecutions)
        .where(eq(queryExecutions.organizationId, organizationId))
    ).length
    expect(countAfter).toBe(countBefore)
  })

  it("truncates a 10,001-row result to 10,000 with truncated/hasMore both true (G6: distinct measure values, generated here — not a CSV fixture)", async () => {
    const rows: AnalyticalRow[] = Array.from({ length: 10_001 }, (_, index) => ({
      [COL_QTY]: String(index + 1),
    }))
    const { datasetId, versionId } = await seedDataset(
      [{ columnId: COL_QTY, type: "integer" }],
      rows,
    )

    const ast: QueryAst = {
      version: 1,
      datasetId,
      dimensions: [{ columnId: COL_QTY }],
      // sum(qty) per group equals that group's own qty value (one row per
      // group, since qty is unique per row) — every measure value is
      // distinct, so the default "first measure DESC" order has no ties
      // for Postgres to break arbitrarily (G6).
      measures: [{ field: COL_QTY, aggregation: "sum", alias: "total" }],
      filters: [],
    }

    const result = await executeQuery(context, ast)

    expect(result.rowCount).toBe(10_000)
    expect(result.rows).toHaveLength(10_000)
    expect(result.hasMore).toBe(true)
    expect(result.truncated).toBe(true)

    expect((await auditRow(versionId, 1)).rowCount).toBe(10_000)

    // The omitted-limit case above can't tell `rowLimits`/`finishRows`
    // actually wired through from `engineLimit`/`effectiveLimit` having been
    // hardcoded to 10001/10000 — only a user-supplied `limit` exercises that
    // path, against the same table, no re-seed needed.
    const limited = await executeQuery(context, { ...ast, limit: 50 })
    expect(limited.rows).toHaveLength(50)
    expect(limited.hasMore).toBe(true)
    expect(limited.truncated).toBe(false)
    expect((await auditRow(versionId, 2)).rowCount).toBe(50)

    const probe = await executeQuery(context, { ...ast, limit: 0 })
    expect(probe.rows).toHaveLength(0)
    expect(probe.rowCount).toBe(0)
    expect(probe.hasMore).toBe(true)
    expect(probe.truncated).toBe(false)
    expect((await auditRow(versionId, 3)).rowCount).toBe(0)
  })
})

function rowsFrom(rows: readonly AnalyticalRow[]): AsyncIterable<AnalyticalRow> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) {
        yield row
      }
    },
  }
}

/** `expectedCount` accounts for a test that calls `executeQuery` more than once against the same version — pass the running count each time. */
async function auditRow(versionId: string, expectedCount = 1) {
  const rows = await db
    .select()
    .from(queryExecutions)
    .where(eq(queryExecutions.datasetVersionId, versionId))
  expect(rows).toHaveLength(expectedCount)
  const row = rows[rows.length - 1]
  if (!row) throw new Error("expected at least one query_executions row")
  return row
}

/**
 * Acquires all 5 of `organizationId`'s advisory-lock slots on raw,
 * still-open transactions, so `executeQuery`'s own attempt fails fast with
 * `CONCURRENCY_LIMIT` — mirrors analytical-store/execute-query.integration.test.ts's
 * helper of the same purpose; kept local rather than imported since that
 * file is a test file, not this module's public surface.
 */
async function holdAllSlots(organizationId: string): Promise<readonly PoolClient[]> {
  const clients: PoolClient[] = []
  for (const { key1, key2 } of slotKeys(organizationId)) {
    // oxlint-disable-next-line no-await-in-loop -- each lock must be taken before the next is attempted, to prove all 5 really are held simultaneously.
    const client = await analyticalPool.connect()
    // oxlint-disable-next-line no-await-in-loop -- see above.
    await client.query("BEGIN")
    // oxlint-disable-next-line no-await-in-loop -- see above.
    await client.query("SELECT pg_try_advisory_xact_lock($1::int4, $2::int4)", [key1, key2])
    clients.push(client)
  }
  return clients
}

async function releaseSlotHolders(clients: readonly PoolClient[]): Promise<void> {
  for (const client of clients) {
    // oxlint-disable-next-line no-await-in-loop -- test teardown, not a hot path.
    await client.query("ROLLBACK")
    client.release()
  }
}
