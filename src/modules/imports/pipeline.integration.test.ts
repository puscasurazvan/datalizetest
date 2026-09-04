import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { PostgresAnalyticalStore } from "@/modules/analytical-store"
import { qualifiedTableName } from "@/modules/analytical-store/physical-names"
import { getJobDispatcher, jobRegistry } from "@/modules/jobs"
import { InMemoryStorageProvider, ObjectKey } from "@/modules/storage"
import type { ObjectStat, StorageProvider } from "@/modules/storage"
import { createTestRequestContext } from "@/shared/context/testing"
import type { RequestContext } from "@/shared/context/request-context"

import { analyticalPool, importPool } from "@/db/analytical"
import { applicationPool, db } from "@/db/client"
import {
  analyticalColumns,
  analyticalTables,
  datasetColumns,
  datasets,
  datasetVersions,
  importErrors,
  imports,
  organizations,
  users,
} from "@/db/schema"

import { confirmImport } from "./internal/confirm"
import { loadImport } from "./internal/load"
import { startImport } from "./internal/start"
import { registerImportTasks } from "./internal/register-tasks"
import { parseProposedSchema } from "./internal/schema-types"
import { getImportForContext, recordConfirmedSchema } from "./repository/import-repository"

async function physicalRowCount(versionId: string): Promise<number> {
  const result = await importPool.query<{ count: string }>(
    `select count(*)::text as count from ${qualifiedTableName(versionId)}`,
  )
  const row = result.rows[0]
  return row === undefined ? -1 : Number(row.count)
}

// End-to-end coverage of the two-phase pipeline (docs/decisions/06 #1, #16)
// against the real test database, using the InlineDispatcher (env has no
// TRIGGER_SECRET_KEY — src/modules/jobs/index.ts's selectJobDispatcher) so
// IMPORT_PROFILE/IMPORT_LOAD run in-process, exactly as CI runs them.
describe("import pipeline (integration)", () => {
  const runId = randomUUID()
  const userId = randomUUID()
  const organizationId = randomUUID()
  // A second organization, for the cross-tenant coverage below — every
  // other test in this file runs under `organizationId` alone.
  const otherOrganizationId = randomUUID()

  const storage = new InMemoryStorageProvider()
  const analyticalStore = new PostgresAnalyticalStore()

  // Swapped per test via `setActiveContext` — registerImportTasks's
  // createContextForImport seam only needs to resolve *a* verified
  // context; every test in this file runs under the one organization
  // created in beforeAll, so a single mutable holder is enough.
  let activeContext: RequestContext

  // Dropped in afterAll: `createVersionTable` creates a real
  // `analytical.dv_*` Postgres table per version, and the metadata-row
  // cleanup below (deleting `analytical_tables`/`analytical_columns`) does
  // not itself drop that physical table — only `dropVersion` does. Without
  // this, repeated local runs of this file accumulate orphaned tables.
  const createdVersionIds: string[] = []

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      name: "Import Pipeline Test User",
      email: `import-pipeline-${runId}@example.test`,
      emailVerified: true,
    })
    await db.insert(organizations).values([
      { id: organizationId, name: "Import Pipeline Test Org", slug: `import-pipeline-${runId}` },
      {
        id: otherOrganizationId,
        name: "Import Pipeline Other Org",
        slug: `import-pipeline-other-${runId}`,
      },
    ])

    registerImportTasks(jobRegistry, {
      storage,
      analyticalStore,
      createContextForImport: async () => activeContext,
    })
  })

  afterAll(async () => {
    for (const versionId of createdVersionIds) {
      // oxlint-disable-next-line no-await-in-loop -- teardown, not a hot path; the analytical store's own dropVersion is the intended one-at-a-time API.
      await analyticalStore.dropVersion(
        createTestRequestContext({
          userId,
          organizationId,
          role: "owner",
          organizationTimezone: "UTC",
        }),
        versionId,
      )
    }
    await db.delete(analyticalColumns).where(eq(analyticalColumns.organizationId, organizationId))
    await db.delete(analyticalTables).where(eq(analyticalTables.organizationId, organizationId))
    await db.delete(importErrors).where(eq(importErrors.organizationId, organizationId))
    await db.delete(imports).where(eq(imports.organizationId, organizationId))
    await db.delete(datasetColumns).where(eq(datasetColumns.organizationId, organizationId))
    await db.delete(datasetVersions).where(eq(datasetVersions.organizationId, organizationId))
    await db.delete(datasets).where(eq(datasets.organizationId, organizationId))
    await db.delete(organizations).where(eq(organizations.id, organizationId))
    await db.delete(organizations).where(eq(organizations.id, otherOrganizationId))
    await db.delete(users).where(eq(users.id, userId))
    await importPool.end()
    await analyticalPool.end()
    await applicationPool.end()
  })

  function contextFor(timezone: string): RequestContext {
    return createTestRequestContext({
      userId,
      organizationId,
      role: "owner",
      organizationTimezone: timezone,
    })
  }

  const otherContext = createTestRequestContext({
    userId,
    organizationId: otherOrganizationId,
    role: "owner",
    organizationTimezone: "UTC",
  })

  async function uploadFixture(fileName: string): Promise<string> {
    const bytes = readFileSync(path.join(process.cwd(), "tests/fixtures", fileName))
    const target = await storage.createUploadTarget(organizationId)
    await storage.receiveUpload(target, bytes)
    return target.key.value
  }

  it("profile -> confirm -> load produces a queryable physical table with the right row count and schema", async () => {
    const context = contextFor("UTC")
    activeContext = context

    const objectKey = await uploadFixture("transactions_stripe.csv")
    const { importId } = await startImport(
      context,
      {
        objectKey,
        originalFilename: "transactions_stripe.csv",
        contentType: "text/csv",
        datasetName: `Transactions ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )

    const profiled = await getImportForContext(context, importId)
    expect(profiled.status).toBe("AWAITING_CONFIRMATION")

    const proposedSchema = parseProposedSchema(profiled.proposedSchema)
    const byName = new Map(proposedSchema.columns.map((c) => [c.name, c] as const))
    expect(byName.get("id")).toMatchObject({ type: "string" })
    expect(byName.get("customer_id")).toMatchObject({ type: "string" })
    expect(byName.get("amount")).toMatchObject({ type: "decimal", nullable: true })
    expect(byName.get("currency")).toMatchObject({ type: "string" })
    expect(byName.get("created_at")).toMatchObject({ type: "timestamptz" })
    expect(byName.get("plan_name")).toMatchObject({ type: "string", nullable: true })
    expect([...byName.keys()]).toEqual([
      "id",
      "customer_id",
      "customer_name",
      "amount",
      "currency",
      "status",
      "created_at",
      "plan_name",
      "country",
    ])

    await confirmImport(context, { importId }, { jobDispatcher: getJobDispatcher() })

    const loaded = await getImportForContext(context, importId)
    expect(loaded.status).toBe("COMPLETED")
    expect(loaded.datasetVersionId).not.toBeNull()
    const versionId = loaded.datasetVersionId
    if (versionId === null) throw new Error("expected a dataset version id")
    createdVersionIds.push(versionId)

    const [version] = await db
      .select()
      .from(datasetVersions)
      .where(eq(datasetVersions.id, versionId))
    expect(version?.status).toBe("COMPLETED")
    expect(version?.rowCount).toBe(1000)
    expect(version?.columnCount).toBe(9)

    const [dataset] = await db.select().from(datasets).where(eq(datasets.id, loaded.datasetId))
    expect(dataset?.currentVersionId).toBe(versionId)

    expect(await physicalRowCount(versionId)).toBe(1000)

    // Data row 3 (0-based) -> row number 4: "amount" = "N/A", unparseable.
    // Data row 7 (0-based) -> row number 8: "amount" = "$1,234.56", unparseable
    // (currency-formatted, not plain numeric — inference.ts's own rule).
    const errors = await db.select().from(importErrors).where(eq(importErrors.importId, importId))
    const amountErrors = errors.filter((e) => e.columnName === "amount")
    expect(amountErrors.map((e) => e.rowNumber).toSorted()).toEqual([4, 8])
    for (const error of amountErrors) {
      expect(error.errorCode).toBe("UNPARSEABLE_VALUE")
      expect(error.message).not.toContain("N/A")
      expect(error.message).not.toContain("1,234.56")
    }

    // No raw cell value anywhere in a message (docs/decisions/06 #5).
    for (const error of errors) {
      expect(error.message).not.toMatch(/\$|N\/A/)
    }
  })

  it("dispatching IMPORT_LOAD twice yields one dataset version and no duplicate rows", async () => {
    const context = contextFor("UTC")
    activeContext = context

    const objectKey = await uploadFixture("transactions_stripe.csv")
    const { importId } = await startImport(
      context,
      {
        objectKey,
        originalFilename: "transactions_stripe.csv",
        contentType: "text/csv",
        datasetName: `Idempotency ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )
    await confirmImport(context, { importId }, { jobDispatcher: getJobDispatcher() })

    const firstLoad = await getImportForContext(context, importId)
    const versionId = firstLoad.datasetVersionId
    if (versionId === null) throw new Error("expected a dataset version id")
    createdVersionIds.push(versionId)

    // Second dispatch of the same job type for the same import — the
    // pipeline's own idempotent short-circuit (loadImport returns early on
    // an already-COMPLETED import), not InlineDispatcher's own
    // deduplication (it has none; it ignores `idempotencyKey` entirely).
    await getJobDispatcher().enqueue("IMPORT_LOAD", { importId })

    const versions = await db
      .select()
      .from(datasetVersions)
      .where(eq(datasetVersions.datasetId, firstLoad.datasetId))
    expect(versions).toHaveLength(1)
    expect(await physicalRowCount(versionId)).toBe(1000)

    const afterSecondDispatch = await getImportForContext(context, importId)
    expect(afterSecondDispatch.rowsImported).toBe(1000)
  })

  // Regression for the confirmed defect (plan H1): recordConfirmedSchema's
  // WHERE used to carry only organization + id, so a second confirmImport
  // call — the two-tab race — passed the same pre-read AWAITING_CONFIRMATION
  // check, wrote confirmedSchema/QUEUED a second time, and dispatched a
  // second IMPORT_LOAD. InlineDispatcher doesn't dedupe on idempotencyKey
  // (jobs/CLAUDE.md), and createRunningVersion's isNull guard protects only
  // the imports UPDATE, not the dataset_versions INSERT — two RUNNING
  // versions, one orphaned. The fix is a status predicate on
  // recordConfirmedSchema's WHERE: only the confirm that still finds
  // AWAITING_CONFIRMATION at write time commits: the second sees 0 rows
  // updated and throws VALIDATION instead of ever reaching enqueue.
  it("two concurrent confirmImport calls on the same import produce one dataset_versions row, not two", async () => {
    const context = contextFor("UTC")
    activeContext = context

    const objectKey = await uploadFixture("transactions_stripe.csv")
    const { importId } = await startImport(
      context,
      {
        objectKey,
        originalFilename: "transactions_stripe.csv",
        contentType: "text/csv",
        datasetName: `Confirm Race ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )

    // Fired without awaiting either first — this is the two-tab race
    // itself, not a sequential re-confirm (which the pre-existing pre-read
    // check in confirm.ts already caught, before this fix). Both calls'
    // synchronous prefix (assertCan, then the first `await
    // getImportForContext`) runs before either reaches `recordConfirmedSchema`,
    // so both read AWAITING_CONFIRMATION and both attempt the write —
    // exactly the sequence H1 names.
    const results = await Promise.allSettled([
      confirmImport(context, { importId }, { jobDispatcher: getJobDispatcher() }),
      confirmImport(context, { importId }, { jobDispatcher: getJobDispatcher() }),
    ])

    const fulfilled = results.filter((r) => r.status === "fulfilled")
    const rejected = results.filter((r) => r.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    if (rejected[0]?.status !== "rejected") throw new Error("expected a rejection")
    expect(rejected[0].reason).toMatchObject({
      code: "VALIDATION",
      message: "This import is not awaiting confirmation.",
    })

    const finished = await getImportForContext(context, importId)
    const versionId = finished.datasetVersionId
    if (versionId === null) throw new Error("expected a dataset version id")
    createdVersionIds.push(versionId)

    const versions = await db
      .select()
      .from(datasetVersions)
      .where(eq(datasetVersions.datasetId, finished.datasetId))
    expect(versions).toHaveLength(1)
  })

  it("a file breaching the column ceiling fails with the bound named and creates no physical table", async () => {
    const context = contextFor("UTC")
    activeContext = context

    const header = Array.from({ length: 101 }, (_, i) => `col_${i}`).join(",")
    const row = Array.from({ length: 101 }, (_, i) => `${i}`).join(",")
    const csv = `${header}\n${row}\n`

    const target = await storage.createUploadTarget(organizationId)
    await storage.receiveUpload(target, Buffer.from(csv))

    const { importId } = await startImport(
      context,
      {
        objectKey: target.key.value,
        originalFilename: "too-wide.csv",
        contentType: "text/csv",
        datasetName: `Ceiling ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )

    const failed = await getImportForContext(context, importId)
    expect(failed.status).toBe("FAILED")
    expect(failed.errorCode).toBe("IMPORT_LIMIT_EXCEEDED")
    expect(failed.errorMessage).toMatch(/100-column limit/)
    expect(failed.errorMessage).toMatch(/101/)
    expect(failed.datasetVersionId).toBeNull()

    // No version was ever created for this import's dataset — profiling
    // failed before import.load ever ran, so no analytical table could
    // have been registered under it either (a table is always created
    // against a version id).
    const versionsForDataset = await db
      .select()
      .from(datasetVersions)
      .where(eq(datasetVersions.datasetId, failed.datasetId))
    expect(versionsForDataset).toHaveLength(0)
  })

  // Regression for the confirmed defect: startImport called statObject —
  // which src/modules/storage/s3.ts names as the authoritative size check,
  // since a presigned PUT cannot enforce one — but never compared the
  // result against MAX_UPLOAD_BYTES. InMemoryStorageProvider's own
  // receiveUpload already refuses an oversized body (unlike a real
  // presigned S3 PUT), so a lying stat is the only way to exercise this
  // check without actually allocating 50+ MB in the test process.
  it("rejects an oversized object before any row is written, naming the bound and the measured size", async () => {
    const context = contextFor("UTC")
    activeContext = context

    const objectKey = await uploadFixture("transactions_stripe.csv")
    const oversizedStat = 60 * 1024 * 1024

    await expect(
      startImport(
        context,
        {
          objectKey,
          originalFilename: "oversized.csv",
          contentType: "text/csv",
          datasetName: `Oversized ${runId}`,
        },
        { storage: lyingAboutSize(storage, oversizedStat), jobDispatcher: getJobDispatcher() },
      ),
    ).rejects.toMatchObject({
      code: "IMPORT_LIMIT_EXCEEDED",
      message: expect.stringContaining(String(oversizedStat)),
    })

    // No imports row was ever written for this upload — the ceiling is
    // enforced before the dataset/import transaction runs, not discovered
    // partway through profiling.
    const rows = await db
      .select()
      .from(imports)
      .where(eq(imports.originalFilename, "oversized.csv"))
    expect(rows).toHaveLength(0)
  })

  // Regression for the confirmed defect: a failed import.load used to mark
  // only the imports row FAILED, leaving the dataset_versions row it had
  // already claimed stuck at RUNNING forever (markVersionFailed existed
  // but was never called). Confirms without dispatching load (a no-op
  // JobDispatcher stands in), then deletes the uploaded object out from
  // under a direct loadImport call so runLoad throws NOT_FOUND after
  // createRunningVersion has already committed — the exact sequence the
  // original defect report reproduced.
  it("a load failure after the version is claimed marks both the import and the version FAILED", async () => {
    const context = contextFor("UTC")
    activeContext = context

    const objectKey = await uploadFixture("transactions_stripe.csv")
    const { importId } = await startImport(
      context,
      {
        objectKey,
        originalFilename: "transactions_stripe.csv",
        contentType: "text/csv",
        datasetName: `Load Failure ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )

    const noopDispatcher = { enqueue: async () => ({ runId: "noop" }) }
    await confirmImport(context, { importId }, { jobDispatcher: noopDispatcher })

    const confirmed = await getImportForContext(context, importId)
    expect(confirmed.status).toBe("QUEUED")
    expect(confirmed.datasetVersionId).toBeNull()

    // H1's WHERE predicate itself, proved deterministically rather than by
    // scheduling luck: this import is already past AWAITING_CONFIRMATION,
    // so a second `recordConfirmedSchema` call — exactly what the losing
    // side of a two-tab race runs — must match and update zero rows.
    expect(await recordConfirmedSchema(context, importId, confirmed.confirmedSchema)).toBe(0)

    await storage.deleteObject(parseKeyOrThrow(objectKey, organizationId))

    // loadImport catches an AppError, records it, and returns normally
    // (only a non-AppError failure rethrows) — so this resolves, not rejects.
    await loadImport(context, importId, { storage, analyticalStore })

    const failedImport = await getImportForContext(context, importId)
    expect(failedImport.errorCode).toBe("NOT_FOUND")
    expect(failedImport.status).toBe("FAILED")
    const versionId = failedImport.datasetVersionId
    if (versionId === null) throw new Error("expected the version to have been claimed already")
    createdVersionIds.push(versionId)

    const [version] = await db
      .select()
      .from(datasetVersions)
      .where(eq(datasetVersions.id, versionId))
    expect(version?.status).toBe("FAILED")

    // The registry row for the physical table is still there (retained for
    // a retry, per createVersionTable's CREATE IF NOT EXISTS + TRUNCATE
    // convergence) — this asserts the version didn't just vanish.
    const [table] = await db
      .select()
      .from(analyticalTables)
      .where(eq(analyticalTables.datasetVersionId, versionId))
    expect(table).toBeDefined()
  })

  // Regression for the confirmed defect: an empty upload used to complete
  // successfully as a zero-column Dataset Version — a "successful" import
  // of a dataset that can never be queried. import.profile now rejects it
  // before the user is ever asked to confirm anything.
  it("an empty file fails profiling instead of completing as a zero-column dataset version", async () => {
    const context = contextFor("UTC")
    activeContext = context

    const target = await storage.createUploadTarget(organizationId)
    await storage.receiveUpload(target, Buffer.alloc(0))

    const { importId } = await startImport(
      context,
      {
        objectKey: target.key.value,
        originalFilename: "empty.csv",
        contentType: "text/csv",
        datasetName: `Empty File ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )

    const failed = await getImportForContext(context, importId)
    expect(failed.status).toBe("FAILED")
    expect(failed.errorCode).toBe("VALIDATION")
    expect(failed.datasetVersionId).toBeNull()

    const versionsForDataset = await db
      .select()
      .from(datasetVersions)
      .where(eq(datasetVersions.datasetId, failed.datasetId))
    expect(versionsForDataset).toHaveLength(0)
  })

  it("records ambiguous and nonexistent DST local times loudly, not as silent NULLs", async () => {
    // The fixture's naive datetimes are deliberately constructed against
    // America/New_York's 2026 DST transitions (tests/fixtures/README.md).
    const context = contextFor("America/New_York")
    activeContext = context

    const objectKey = await uploadFixture("customers_saaS.csv")
    const { importId } = await startImport(
      context,
      {
        objectKey,
        originalFilename: "customers_saaS.csv",
        contentType: "text/csv",
        datasetName: `Customers ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )
    await confirmImport(context, { importId }, { jobDispatcher: getJobDispatcher() })

    const loaded = await getImportForContext(context, importId)
    expect(loaded.status).toBe("COMPLETED")
    const versionId = loaded.datasetVersionId
    if (versionId === null) throw new Error("expected a dataset version id")
    createdVersionIds.push(versionId)
    expect(await physicalRowCount(versionId)).toBe(1000)

    const [version] = await db
      .select()
      .from(datasetVersions)
      .where(eq(datasetVersions.id, versionId))
    expect(version?.timezoneUsedForNaiveTimestamps).toBe("America/New_York")

    const errors = await db.select().from(importErrors).where(eq(importErrors.importId, importId))

    // Data row 20 (0-based) -> row number 21: created_at spring-forward gap.
    const nonexistent = errors.filter((e) => e.errorCode === "NONEXISTENT_LOCAL_TIME")
    expect(nonexistent.map((e) => e.rowNumber)).toContain(21)
    expect(nonexistent.find((e) => e.rowNumber === 21)?.columnName).toBe("created_at")

    // Data row 24 (0-based) -> row number 25: canceled_at fall-back overlap.
    const ambiguous = errors.filter((e) => e.errorCode === "AMBIGUOUS_LOCAL_TIME")
    expect(ambiguous.map((e) => e.rowNumber)).toContain(25)
    expect(ambiguous.find((e) => e.rowNumber === 25)?.columnName).toBe("canceled_at")

    // Neither case is a silent NULL — both rows still carry a resolved
    // instant in the physical table (docs/decisions/06: "counted and
    // reported, not silently resolved").
    const dataResult = await importPool.query<{ c: string | null }>(
      `select c_5 as c from ${qualifiedTableName(versionId)} order by c_5 nulls last limit 1000`,
    )
    const nonNullCount = dataResult.rows.filter((row) => row.c !== null).length
    expect(nonNullCount).toBeGreaterThan(900)
  })

  // Coverage gap identified in review: every other test in this file runs
  // under one organization, so nothing exercised the scoping
  // getImportForContext / findImportByIdempotencyKey / findDatasetForContext
  // / AnalyticalStore provide — a refactor that dropped scopedWhere from
  // any of them would still pass the whole suite. This asserts the other
  // organization's context can reach none of this import's rows or its
  // physical table.
  it("a second organization cannot reach another organization's import, dataset, or physical table", async () => {
    const context = contextFor("UTC")
    activeContext = context

    const objectKey = await uploadFixture("transactions_stripe.csv")
    const { importId } = await startImport(
      context,
      {
        objectKey,
        originalFilename: "transactions_stripe.csv",
        contentType: "text/csv",
        datasetName: `Cross Tenant ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )
    await confirmImport(context, { importId }, { jobDispatcher: getJobDispatcher() })

    const loaded = await getImportForContext(context, importId)
    const versionId = loaded.datasetVersionId
    if (versionId === null) throw new Error("expected a dataset version id")
    createdVersionIds.push(versionId)

    await expect(getImportForContext(otherContext, importId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })

    // A fresh object uploaded under the OTHER organization's own key
    // prefix — isolates the assertion to the `datasetId` scoping check in
    // `assertDatasetPermission` (`findDatasetForContext`) rather than the
    // separate, already-enforced `ObjectKey` organization-prefix check.
    const otherOrgTarget = await storage.createUploadTarget(otherOrganizationId)
    await storage.receiveUpload(otherOrgTarget, Buffer.from("a\n1\n"))

    await expect(
      startImport(
        otherContext,
        {
          objectKey: otherOrgTarget.key.value,
          originalFilename: "cross-tenant.csv",
          contentType: "text/csv",
          datasetId: loaded.datasetId,
        },
        { storage, jobDispatcher: getJobDispatcher() },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })

    await expect(
      analyticalStore.loadRows(otherContext, versionId, rowsFrom([])),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(analyticalStore.dropVersion(otherContext, versionId)).resolves.toBeUndefined()

    // dropVersion is an idempotent no-op on a version it cannot see — it
    // must not have actually dropped the real organization's table. Load
    // against it once more, under the real context, to prove it's intact.
    const stillRegistered = await analyticalStore.loadRows(context, versionId, rowsFrom([]))
    expect(stillRegistered.rowCount).toBe(0)
  })
})

/** A one-shot async iterable yielding no rows — for cross-tenant assertions that only need
 * to know whether the call itself resolves or throws. */
function rowsFrom(
  rows: readonly Record<string, string | null>[],
): AsyncIterable<Record<string, string | null>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) {
        yield row
      }
    },
  }
}

/**
 * Wraps a real `StorageProvider`, reporting a caller-chosen `sizeBytes` from
 * `statObject` regardless of the object's actual size — everything else
 * delegates unchanged. Exists only to exercise `startImport`'s byte-ceiling
 * check without allocating a real 50+ MB buffer in the test process; a real
 * presigned S3 PUT has no such protection (src/modules/storage/s3.ts), so
 * this stands in for "the client uploaded something bigger than advertised".
 */
function parseKeyOrThrow(raw: string, organizationId: string): ObjectKey {
  const result = ObjectKey.parse(raw, organizationId)
  if (!result.ok) throw new Error(`could not parse object key: ${result.reason}`)
  return result.key
}

function lyingAboutSize(inner: StorageProvider, sizeBytes: number): StorageProvider {
  return {
    createUploadTarget: (organizationId) => inner.createUploadTarget(organizationId),
    readObject: (key) => inner.readObject(key),
    deleteObject: (key) => inner.deleteObject(key),
    async statObject(key: ObjectKey): Promise<ObjectStat | undefined> {
      const real = await inner.statObject(key)
      return real === undefined ? undefined : { ...real, sizeBytes }
    },
  }
}
