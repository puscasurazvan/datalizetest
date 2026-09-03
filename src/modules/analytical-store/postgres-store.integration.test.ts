import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  ANALYTICAL_STATEMENT_TIMEOUT_MS,
  IMPORT_STATEMENT_TIMEOUT_MS,
  analyticalPool,
  importPool,
} from "@/db/analytical"
import { applicationPool, db } from "@/db/client"
import {
  analyticalColumns,
  analyticalTables,
  datasets,
  datasetVersions,
  organizations,
  users,
} from "@/db/schema"
import { createTestRequestContext } from "@/shared/context/testing"

import { PostgresAnalyticalStore } from "./postgres-store"

// Integration coverage for the write surface (this module's CLAUDE.md,
// docs/adr/0002): a version table is created with the expected physical
// columns and types read back from information_schema; no returned DTO
// contains a physical name; a second createVersionTable for the same
// version does not fail or duplicate; dropVersion removes both the table
// and its mapping rows.
describe("PostgresAnalyticalStore (integration)", () => {
  const store = new PostgresAnalyticalStore()
  const runId = randomUUID()
  const userId = randomUUID()
  const organizationId = randomUUID()
  const otherOrganizationId = randomUUID()
  const context = createTestRequestContext({
    userId,
    organizationId,
    role: "owner",
    organizationTimezone: "UTC",
  })
  const otherContext = createTestRequestContext({
    userId,
    organizationId: otherOrganizationId,
    role: "owner",
    organizationTimezone: "UTC",
  })

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      name: "Analytical Store Test User",
      email: `analytical-store-${runId}@example.test`,
      emailVerified: true,
    })
    await db.insert(organizations).values([
      { id: organizationId, name: "Analytical Store Test Org", slug: `analytical-store-${runId}` },
      {
        id: otherOrganizationId,
        name: "Analytical Store Other Org",
        slug: `analytical-store-other-${runId}`,
      },
    ])
  })

  afterAll(async () => {
    await db.delete(analyticalColumns).where(eq(analyticalColumns.organizationId, organizationId))
    await db.delete(analyticalTables).where(eq(analyticalTables.organizationId, organizationId))
    await db.delete(datasetVersions).where(eq(datasetVersions.organizationId, organizationId))
    await db.delete(datasets).where(eq(datasets.organizationId, organizationId))
    await db.delete(organizations).where(eq(organizations.id, organizationId))
    await db.delete(organizations).where(eq(organizations.id, otherOrganizationId))
    await db.delete(users).where(eq(users.id, userId))
    await importPool.end()
    await analyticalPool.end()
    await applicationPool.end()
  })

  /** Inserts a dataset + a COMPLETED-shaped dataset_version row and returns its id. */
  async function createDatasetVersion(): Promise<string> {
    const datasetId = randomUUID()
    await db.insert(datasets).values({
      id: datasetId,
      organizationId,
      name: `Test Dataset ${randomUUID()}`,
      createdByUserId: userId,
    })

    const versionId = randomUUID()
    await db.insert(datasetVersions).values({
      id: versionId,
      organizationId,
      datasetId,
      versionNumber: 1,
      status: "RUNNING",
      timezoneUsedForNaiveTimestamps: "UTC",
    })

    return versionId
  }

  it("creates a version table whose physical columns and types match information_schema", async () => {
    const versionId = await createDatasetVersion()

    const summary = await store.createVersionTable(context, versionId, [
      { columnId: "col_id", type: "string" },
      { columnId: "col_amount", type: "decimal" },
      { columnId: "col_count", type: "integer" },
      { columnId: "col_active", type: "boolean" },
      { columnId: "col_signup", type: "date" },
      { columnId: "col_created", type: "timestamptz" },
    ])

    expect(summary).toEqual({
      datasetVersionId: versionId,
      columnIds: ["col_id", "col_amount", "col_count", "col_active", "col_signup", "col_created"],
    })

    const physicalTableName = `dv_${versionId.replaceAll("-", "")}`
    const columnsResult = await applicationPool.query<{
      column_name: string
      data_type: string
    }>(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'analytical' and table_name = $1
       order by ordinal_position`,
      [physicalTableName],
    )

    expect(columnsResult.rows).toEqual([
      { column_name: "c_0", data_type: "text" },
      { column_name: "c_1", data_type: "numeric" },
      { column_name: "c_2", data_type: "bigint" },
      { column_name: "c_3", data_type: "boolean" },
      { column_name: "c_4", data_type: "date" },
      { column_name: "c_5", data_type: "timestamp with time zone" },
    ])

    await store.dropVersion(context, versionId)
  })

  it("returns no physical table or column name from createVersionTable, loadRows, or dropVersion", async () => {
    const versionId = await createDatasetVersion()

    const createResult = await store.createVersionTable(context, versionId, [
      { columnId: "col_amount", type: "decimal" },
    ])
    const loadResult = await store.loadRows(context, versionId, oneRow({ col_amount: "1.00" }))
    const dropResult = await store.dropVersion(context, versionId)

    const serialized = JSON.stringify({ createResult, loadResult, dropResult })
    expect(serialized).not.toMatch(/dv_[0-9a-f]{32}/)
    expect(serialized).not.toMatch(/\bc_\d+\b/)
    expect(serialized).not.toContain("analytical")
  })

  it("is idempotent: a second createVersionTable for the same version does not fail or duplicate rows", async () => {
    const versionId = await createDatasetVersion()

    await store.createVersionTable(context, versionId, [
      { columnId: "col_amount", type: "decimal" },
    ])
    await store.loadRows(context, versionId, oneRow({ col_amount: "1.00" }))

    // Second call: same shape. Must not throw, and must leave exactly one
    // analytical_tables row and one analytical_columns row behind, plus a
    // freshly truncated (empty) physical table.
    await expect(
      store.createVersionTable(context, versionId, [{ columnId: "col_amount", type: "decimal" }]),
    ).resolves.toBeDefined()

    const tableRows = await db
      .select()
      .from(analyticalTables)
      .where(eq(analyticalTables.datasetVersionId, versionId))
    expect(tableRows).toHaveLength(1)

    const columnRows = await db
      .select()
      .from(analyticalColumns)
      .where(eq(analyticalColumns.datasetVersionId, versionId))
    expect(columnRows).toHaveLength(1)

    const physicalTableName = `dv_${versionId.replaceAll("-", "")}`
    const countResult = await applicationPool.query<{ count: string }>(
      `select count(*)::text as count from analytical.${quoteForTest(physicalTableName)}`,
    )
    expect(countResult.rows[0]?.count).toBe("0")

    await store.dropVersion(context, versionId)
  })

  it("loadRows COPYs rows into the physical table, translating Column ID to physical column", async () => {
    const versionId = await createDatasetVersion()
    await store.createVersionTable(context, versionId, [
      { columnId: "col_id", type: "string" },
      { columnId: "col_amount", type: "decimal" },
    ])

    const result = await store.loadRows(
      context,
      versionId,
      rowsFrom([
        { col_id: "1", col_amount: "10.50" },
        { col_id: "2", col_amount: null },
      ]),
    )

    expect(result).toEqual({ rowCount: 2 })

    const physicalTableName = `dv_${versionId.replaceAll("-", "")}`
    const dataResult = await applicationPool.query<{ c_0: string; c_1: string | null }>(
      `select c_0, c_1 from analytical.${quoteForTest(physicalTableName)} order by c_0`,
    )
    expect(dataResult.rows).toEqual([
      { c_0: "1", c_1: "10.50" },
      { c_0: "2", c_1: null },
    ])

    await store.dropVersion(context, versionId)
  })

  it("readRows returns rows keyed by Column ID, never by physical name", async () => {
    const versionId = await createDatasetVersion()
    await store.createVersionTable(context, versionId, [
      { columnId: "col_id", type: "string" },
      { columnId: "col_amount", type: "decimal" },
    ])
    await store.loadRows(
      context,
      versionId,
      rowsFrom([
        { col_id: "1", col_amount: "10.50" },
        { col_id: "2", col_amount: null },
      ]),
    )

    const preview = await store.readRows(context, versionId, 10)

    expect(preview.columnIds).toEqual(["col_id", "col_amount"])
    expect(preview.rows).toHaveLength(2)
    // Keyed by Column ID only — no c_0/c_1 anywhere in the result.
    expect(JSON.stringify(preview)).not.toMatch(/c_\d/)
    expect(preview.rows).toContainEqual({ col_id: "1", col_amount: "10.50" })
    expect(preview.rows).toContainEqual({ col_id: "2", col_amount: null })

    await store.dropVersion(context, versionId)
  })

  it("readRows keeps a decimal a string, so precision survives the read", async () => {
    const versionId = await createDatasetVersion()
    await store.createVersionTable(context, versionId, [
      { columnId: "col_amount", type: "decimal" },
    ])
    // More precision than a JS number can hold — the point of numeric.
    await store.loadRows(context, versionId, oneRow({ col_amount: "12345678901234567890.12345" }))

    const preview = await store.readRows(context, versionId, 10)

    expect(preview.rows[0]?.col_amount).toBe("12345678901234567890.12345")

    await store.dropVersion(context, versionId)
  })

  it("readRows honours its limit", async () => {
    const versionId = await createDatasetVersion()
    await store.createVersionTable(context, versionId, [{ columnId: "col_id", type: "string" }])
    await store.loadRows(
      context,
      versionId,
      rowsFrom([{ col_id: "1" }, { col_id: "2" }, { col_id: "3" }]),
    )

    expect((await store.readRows(context, versionId, 2)).rows).toHaveLength(2)

    await store.dropVersion(context, versionId)
  })

  it("readRows rejects a limit outside its bounds rather than clamping it", async () => {
    const versionId = await createDatasetVersion()
    await store.createVersionTable(context, versionId, [{ columnId: "col_id", type: "string" }])

    for (const limit of [0, -1, 1.5, 201]) {
      await expect(store.readRows(context, versionId, limit)).rejects.toMatchObject({
        code: "VALIDATION",
      })
    }

    await store.dropVersion(context, versionId)
  })

  it("readRows refuses a dataset version belonging to another organization", async () => {
    const versionId = await createDatasetVersion()
    await store.createVersionTable(context, versionId, [{ columnId: "col_id", type: "string" }])
    await store.loadRows(context, versionId, oneRow({ col_id: "1" }))

    await expect(store.readRows(otherContext, versionId, 10)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })

    await store.dropVersion(context, versionId)
  })

  it("dropVersion removes both the physical table and its analytical_tables/analytical_columns rows", async () => {
    const versionId = await createDatasetVersion()
    await store.createVersionTable(context, versionId, [
      { columnId: "col_amount", type: "decimal" },
    ])

    await store.dropVersion(context, versionId)

    const tableRows = await db
      .select()
      .from(analyticalTables)
      .where(eq(analyticalTables.datasetVersionId, versionId))
    expect(tableRows).toHaveLength(0)

    const columnRows = await db
      .select()
      .from(analyticalColumns)
      .where(eq(analyticalColumns.datasetVersionId, versionId))
    expect(columnRows).toHaveLength(0)

    const physicalTableName = `dv_${versionId.replaceAll("-", "")}`
    const existsResult = await applicationPool.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.tables
         where table_schema = 'analytical' and table_name = $1
       ) as exists`,
      [physicalTableName],
    )
    expect(existsResult.rows[0]?.exists).toBe(false)
  })

  it("dropVersion on a version with no registered table is a no-op, not an error", async () => {
    const versionId = await createDatasetVersion()
    await expect(store.dropVersion(context, versionId)).resolves.toBeUndefined()
  })

  it("createVersionTable rejects a datasetVersionId that does not belong to the caller's organization", async () => {
    const versionId = await createDatasetVersion() // belongs to `organizationId`, not `otherOrganizationId`

    await expect(
      store.createVersionTable(otherContext, versionId, [
        { columnId: "col_amount", type: "decimal" },
      ]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("loadRows against a version with no createVersionTable call yet fails with NOT_FOUND", async () => {
    const versionId = await createDatasetVersion()
    await expect(store.loadRows(context, versionId, rowsFrom([]))).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  // Regression for the confirmed defect: loadRows's zero-column early
  // return used to abandon the caller's row stream without draining or
  // releasing it — against the real object storage this holds the
  // response socket open indefinitely. `import.load` now rejects a
  // zero-column confirmed schema before ever reaching loadRows (this
  // module's own CLAUDE.md keeps this store agnostic of that upstream
  // policy), so this exercises the defensive backstop directly.
  it("loadRows against a zero-column table closes the caller's row stream instead of abandoning it", async () => {
    const versionId = await createDatasetVersion()
    await store.createVersionTable(context, versionId, [])

    const tracked = trackedRowStream(5)
    const result = await store.loadRows(context, versionId, tracked.iterable)

    expect(result).toEqual({ rowCount: 0 })
    expect(tracked.wasReleased()).toBe(true)
    // Never drained past the first item — the whole point of closing via
    // the iterator's own return() rather than reading everything and
    // discarding it.
    expect(tracked.itemsPulled()).toBeLessThan(5)

    await store.dropVersion(context, versionId)
  })

  it("does not weaken the interactive pool's 30s timeout: import pool is 10 minutes, interactive pool stays 30 seconds", async () => {
    expect(IMPORT_STATEMENT_TIMEOUT_MS).toBe(600_000)
    expect(ANALYTICAL_STATEMENT_TIMEOUT_MS).toBe(30_000)

    const importTimeout = await importPool.query<{ statement_timeout: string }>(
      "show statement_timeout",
    )
    expect(importTimeout.rows[0]?.statement_timeout).toBe("10min")

    const interactiveTimeout = await analyticalPool.query<{ statement_timeout: string }>(
      "show statement_timeout",
    )
    expect(interactiveTimeout.rows[0]?.statement_timeout).toBe("30s")
  })
})

/** A one-shot async iterable yielding a single row — for tests that only need one. */
function oneRow(
  row: Readonly<Record<string, string | null>>,
): AsyncIterable<Readonly<Record<string, string | null>>> {
  return rowsFrom([row])
}

function rowsFrom(
  rows: readonly Readonly<Record<string, string | null>>[],
): AsyncIterable<Readonly<Record<string, string | null>>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) {
        yield row
      }
    },
  }
}

/**
 * An async-generator-backed row stream (the same shape `import.load`'s
 * `encodeRows` produces — a generator, not a hand-rolled iterator object)
 * that reports whether it was ever released via the iterator protocol's
 * `return()` — the thing an early `break` (or, here, `loadRows`'s
 * zero-column backstop) triggers — and how many items were actually pulled
 * before that happened.
 */
function trackedRowStream(count: number): {
  iterable: AsyncIterable<Readonly<Record<string, string | null>>>
  wasReleased: () => boolean
  itemsPulled: () => number
} {
  let released = false
  let pulled = 0

  async function* generate(): AsyncGenerator<Readonly<Record<string, string | null>>> {
    try {
      for (let i = 0; i < count; i += 1) {
        pulled += 1
        yield { col_amount: String(i) }
      }
    } finally {
      released = true
    }
  }

  return {
    iterable: { [Symbol.asyncIterator]: generate },
    wasReleased: () => released,
    itemsPulled: () => pulled,
  }
}

/**
 * Test-only identifier quoting for building a raw `information_schema`
 * probe query against a name this test already computed itself (never a
 * value read back from `PostgresAnalyticalStore`, which never returns
 * one) — kept local rather than importing the module's own
 * `quoteIdentifier` so this test does not validate the module against
 * itself.
 */
function quoteForTest(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
