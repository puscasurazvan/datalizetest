import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import type { PoolClient } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { DatalizeColumnType, ResolvedQuery } from "@/modules/queries"
import { analyticalPool, importPool } from "@/db/analytical"
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
import { AppError } from "@/shared/errors"

import { slotKeys } from "./execution-slots"
import { PostgresAnalyticalStore } from "./postgres-store"
import type { AnalyticalColumnDefinition, AnalyticalRow } from "./types"

// Integration coverage for `execute()` (this module's CLAUDE.md, plan
// section 5 step 7): the store, not the compiler, is what proves a
// compiled query actually behaves against real Postgres — timezone
// boundaries, numeric type survival, `::text`-vs-raw ordering, and the
// advisory-lock concurrency limit are all things `compileQuery`'s pure
// unit tests cannot observe.
describe("PostgresAnalyticalStore.execute (integration)", () => {
  const store = new PostgresAnalyticalStore()
  const runId = randomUUID()
  const userId = randomUUID()
  const organizationId = randomUUID()
  const otherOrganizationId = randomUUID()
  // America/New_York so "month boundary in the workspace timezone, not
  // UTC's" is an observable, not an assumption.
  const context = createTestRequestContext({
    userId,
    organizationId,
    role: "owner",
    organizationTimezone: "America/New_York",
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
      name: "Execute Query Test User",
      email: `execute-query-${runId}@example.test`,
      emailVerified: true,
    })
    await db.insert(organizations).values([
      { id: organizationId, name: "Execute Query Test Org", slug: `execute-query-${runId}` },
      {
        id: otherOrganizationId,
        name: "Execute Query Other Org",
        slug: `execute-query-other-${runId}`,
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

  /** Column IDs used across this file's fixture table. */
  const COL_QTY = "col_qty"
  const COL_AMOUNT = "col_amount"
  const COL_CREATED = "col_created"
  const COL_EVENT_DATE = "col_event_date"

  const FIXTURE_COLUMNS: readonly AnalyticalColumnDefinition[] = [
    { columnId: COL_QTY, type: "integer" },
    { columnId: COL_AMOUNT, type: "decimal" },
    { columnId: COL_CREATED, type: "timestamptz" },
    { columnId: COL_EVENT_DATE, type: "date" },
  ]

  /** Inserts a dataset + a version row and returns its id. */
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

  /** Builds a fixture table with FIXTURE_COLUMNS, loads `rows`, and returns its id. */
  async function fixtureVersion(rows: readonly AnalyticalRow[]): Promise<string> {
    const versionId = await createDatasetVersion()
    await store.createVersionTable(context, versionId, FIXTURE_COLUMNS)
    await store.loadRows(context, versionId, rowsFrom(rows))
    return versionId
  }

  it("groups by month on the workspace timezone's boundaries, not UTC's", async () => {
    // 02:00 UTC on Jan 1 is 21:00 on Dec 31 in America/New_York — a UTC
    // month grouping would put this row in January; the workspace's own
    // timezone puts it in December.
    const versionId = await fixtureVersion([
      { [COL_CREATED]: "2024-01-01T02:00:00Z", [COL_AMOUNT]: "10.00" },
    ])

    const result = await store.execute(
      context,
      versionId,
      baseQuery({
        dimensions: [{ column: col(COL_CREATED, "timestamptz"), granularity: "month" }],
        measures: [{ column: null, aggregation: "count", alias: "n" }],
      }),
      51,
    )

    expect(result.keys).toEqual([COL_CREATED, "n"])
    expect(result.rows).toEqual([{ [COL_CREATED]: "2023-12-01", n: "1" }])

    await store.dropVersion(context, versionId)
  })

  it("a decimal sum comes back a string, not a JS number (precision, docs/decisions/06 #11)", async () => {
    const versionId = await fixtureVersion([
      { [COL_AMOUNT]: "12345678901234567890.12345" },
      { [COL_AMOUNT]: "0.00001" },
    ])

    const result = await store.execute(
      context,
      versionId,
      baseQuery({
        measures: [{ column: col(COL_AMOUNT, "decimal"), aggregation: "sum", alias: "total" }],
      }),
      51,
    )

    expect(result.rows).toEqual([{ total: "12345678901234567890.12346" }])
    expect(typeof result.rows[0]?.total).toBe("string")

    await store.dropVersion(context, versionId)
  })

  it("keys rows by Column ID and measure alias, never a physical name (c_0, c_1, …)", async () => {
    const versionId = await fixtureVersion([{ [COL_QTY]: "5", [COL_AMOUNT]: "1.00" }])

    const result = await store.execute(
      context,
      versionId,
      baseQuery({
        dimensions: [{ column: col(COL_QTY, "integer") }],
        measures: [{ column: col(COL_AMOUNT, "decimal"), aggregation: "sum", alias: "total" }],
      }),
      51,
    )

    expect(result.keys).toEqual([COL_QTY, "total"])
    expect(JSON.stringify(result)).not.toMatch(/\bc_\d+\b/)
    expect(result.rows).toEqual([{ [COL_QTY]: "5", total: "1.00" }])

    await store.dropVersion(context, versionId)
  })

  it("orders an integer dimension numerically, not lexicographically (the ::text-ordering trap)", async () => {
    const versionId = await fixtureVersion([
      { [COL_QTY]: "9" },
      { [COL_QTY]: "10" },
      { [COL_QTY]: "100" },
    ])

    const result = await store.execute(
      context,
      versionId,
      baseQuery({
        dimensions: [{ column: col(COL_QTY, "integer") }],
        measures: [],
        orderBy: [{ kind: "dimension", columnId: COL_QTY, direction: "asc" }],
      }),
      51,
    )

    // Lexicographic ("10" < "100" < "9") would produce [10, 100, 9].
    expect(result.rows.map((row) => row[COL_QTY])).toEqual(["9", "10", "100"])

    await store.dropVersion(context, versionId)
  })

  it("an 'in' filter matches on a date column (G2)", async () => {
    const versionId = await fixtureVersion([
      { [COL_EVENT_DATE]: "2026-01-01" },
      { [COL_EVENT_DATE]: "2026-02-01" },
      { [COL_EVENT_DATE]: "2026-03-01" },
    ])

    const result = await store.execute(
      context,
      versionId,
      baseQuery({
        dimensions: [{ column: col(COL_EVENT_DATE, "date") }],
        measures: [],
        filters: [
          {
            operator: "in",
            column: col(COL_EVENT_DATE, "date"),
            value: ["2026-01-01", "2026-03-01"],
          },
        ],
        orderBy: [{ kind: "dimension", columnId: COL_EVENT_DATE, direction: "asc" }],
      }),
      51,
    )

    expect(result.rows.map((row) => row[COL_EVENT_DATE])).toEqual(["2026-01-01", "2026-03-01"])

    await store.dropVersion(context, versionId)
  })

  it("a 22007 filter-value error mid-transaction returns VALIDATION and releases its slot", async () => {
    const versionId = await fixtureVersion([{ [COL_EVENT_DATE]: "2026-01-01" }])
    const badFilterQuery = baseQuery({
      measures: [],
      filters: [{ operator: "eq", column: col(COL_EVENT_DATE, "date"), value: "not-a-date" }],
    })

    // "not-a-date" bound against a `date` column: Postgres raises 22007
    // (invalid_datetime_format) once it tries to parse the bind value. Run
    // it 6 times sequentially, not once — a slot genuinely leaked on
    // ROLLBACK would still leave 4 free after a single failure, so only
    // "the org's 6th attempt, immediately after 5 straight failures, is
    // STILL just VALIDATION rather than CONCURRENCY_LIMIT" actually proves
    // every one of the 5 slots came back.
    for (let i = 0; i < 6; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- see above: each attempt must complete (and its ROLLBACK release the slot) before the next proves the slot is free.
      await expect(store.execute(context, versionId, badFilterQuery, 51)).rejects.toMatchObject({
        code: "VALIDATION",
      })
    }

    const result = await store.execute(context, versionId, baseQuery({}), 51)
    expect(result.rows).toEqual([{ n: "1" }])

    await store.dropVersion(context, versionId)
  })

  it("6 sequential executions all succeed — COMMIT releases the slot every time", async () => {
    const versionId = await fixtureVersion([{ [COL_QTY]: "1" }])

    for (let i = 0; i < 6; i += 1) {
      // Deliberately sequential: the point of this test is that each COMMIT
      // frees the slot before the next call, which Promise.all would not exercise.
      // oxlint-disable-next-line no-await-in-loop -- see above.
      const result = await store.execute(context, versionId, baseQuery({}), 51)
      expect(result.rows).toEqual([{ n: "1" }])
    }

    await store.dropVersion(context, versionId)
  })

  it("a 6th concurrent query fails fast with CONCURRENCY_LIMIT while all 5 slots are held", async () => {
    const versionId = await fixtureVersion([{ [COL_QTY]: "1" }])

    const holders = await holdAllSlots(organizationId)
    try {
      await expect(store.execute(context, versionId, baseQuery({}), 51)).rejects.toMatchObject({
        code: "CONCURRENCY_LIMIT",
      })
    } finally {
      await releaseSlotHolders(holders)
    }

    // Once released, execution succeeds again.
    const result = await store.execute(context, versionId, baseQuery({}), 51)
    expect(result.rows).toEqual([{ n: "1" }])

    await store.dropVersion(context, versionId)
  })

  it("refuses another organization's datasetVersionId with NOT_FOUND", async () => {
    const versionId = await fixtureVersion([{ [COL_QTY]: "1" }])

    await expect(store.execute(otherContext, versionId, baseQuery({}), 51)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })

    await store.dropVersion(context, versionId)
  })

  it("rejects an unrecognized timezone before ever opening a connection", async () => {
    const versionId = await fixtureVersion([{ [COL_QTY]: "1" }])
    const badTzContext = createTestRequestContext({
      userId,
      organizationId,
      role: "owner",
      organizationTimezone: "Not/AZone",
    })

    await expect(store.execute(badTzContext, versionId, baseQuery({}), 51)).rejects.toBeInstanceOf(
      AppError,
    )

    await store.dropVersion(context, versionId)
  })
})

function col(id: string, type: DatalizeColumnType) {
  return { id, name: id, type }
}

function baseQuery(overrides: Partial<ResolvedQuery>): ResolvedQuery {
  return {
    version: 1,
    datasetId: "dataset_1",
    dimensions: [],
    measures: [{ column: null, aggregation: "count", alias: "n" }],
    filters: [],
    ...overrides,
  }
}

function rowsFrom(rows: readonly AnalyticalRow[]): AsyncIterable<AnalyticalRow> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) {
        yield row
      }
    },
  }
}

/**
 * Acquires all 5 of `organizationId`'s advisory-lock slots on raw,
 * still-open transactions — proving `execute`'s 6th attempt fails fast
 * rather than waiting, without needing 5 real concurrent `execute` calls.
 */
async function holdAllSlots(organizationId: string): Promise<readonly PoolClient[]> {
  const clients: PoolClient[] = []
  // Deliberately sequential: each lock must be taken before the next is
  // attempted, to prove all 5 really are held simultaneously.
  for (const { key1, key2 } of slotKeys(organizationId)) {
    // oxlint-disable-next-line no-await-in-loop -- see above.
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
