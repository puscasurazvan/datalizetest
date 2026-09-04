import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { PostgresAnalyticalStore } from "@/modules/analytical-store"
import { getJobDispatcher, jobRegistry } from "@/modules/jobs"
import { InMemoryStorageProvider } from "@/modules/storage"
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

import { confirmImport } from "./confirm"
import { findOpenImportForDataset, getImportView } from "./read"
import { registerImportTasks } from "./register-tasks"
import { startImport } from "./start"
import { getImportForContext } from "../repository/import-repository"

// Covers getImportView / findOpenImportForDataset against the real database
// — the phase-mapping rule itself is unit-tested with no database in
// read.test.ts. Mirrors pipeline.integration.test.ts's setup (the manual
// registerImportTasks bypass, not ensureImportTasksRegistered's production
// wiring) so a test context's role can be set freely without a matching
// organization_members row.
describe("getImportView / findOpenImportForDataset (integration)", () => {
  const runId = randomUUID()
  const userId = randomUUID()
  const organizationId = randomUUID()
  const otherOrganizationId = randomUUID()

  const storage = new InMemoryStorageProvider()
  const analyticalStore = new PostgresAnalyticalStore()

  // Swapped per test, same as pipeline.integration.test.ts — the job
  // handler's own createContextForImport seam only needs to resolve *a*
  // verified context for the organization each test runs under.
  let activeContext: RequestContext

  const createdVersionIds: string[] = []

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      name: "Import Read Test User",
      email: `import-read-${runId}@example.test`,
      emailVerified: true,
    })
    await db.insert(organizations).values([
      { id: organizationId, name: "Import Read Test Org", slug: `import-read-${runId}` },
      {
        id: otherOrganizationId,
        name: "Import Read Other Org",
        slug: `import-read-other-${runId}`,
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
      // oxlint-disable-next-line no-await-in-loop -- teardown, not a hot path.
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

  function contextFor(role: string, organization = organizationId): RequestContext {
    return createTestRequestContext({
      userId,
      organizationId: organization,
      role,
      organizationTimezone: "UTC",
    })
  }

  async function uploadFixture(fileName: string): Promise<string> {
    const bytes = readFileSync(path.join(process.cwd(), "tests/fixtures", fileName))
    const target = await storage.createUploadTarget(organizationId)
    await storage.receiveUpload(target, bytes)
    return target.key.value
  }

  it("round-trips a parsed ProposedSchema for a profiled import, readable by a viewer, and is the dataset's open import", async () => {
    activeContext = contextFor("owner")

    const objectKey = await uploadFixture("transactions_stripe.csv")
    const { importId } = await startImport(
      activeContext,
      {
        objectKey,
        originalFilename: "transactions_stripe.csv",
        contentType: "text/csv",
        datasetName: `Read Path ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )

    // Plan decision 2: a viewer must be able to watch an import they
    // cannot start — a context with no relation to the owner context that
    // profiled it, distinct role included.
    const view = await getImportView(contextFor("viewer"), importId)
    expect(view.phase).toBe("awaiting_confirmation")
    if (view.phase !== "awaiting_confirmation") throw new Error("expected awaiting_confirmation")
    const byName = new Map(view.proposedSchema.columns.map((c) => [c.name, c] as const))
    expect(byName.get("amount")).toMatchObject({ type: "decimal", nullable: true })
    expect(byName.get("created_at")).toMatchObject({ type: "timestamptz" })

    const open = await findOpenImportForDataset(contextFor("viewer"), view.datasetId)
    expect(open?.importId).toBe(importId)
    expect(open?.phase).toBe("awaiting_confirmation")
  })

  it("throws NOT_FOUND for a different organization's import id", async () => {
    activeContext = contextFor("owner")

    const objectKey = await uploadFixture("transactions_stripe.csv")
    const { importId } = await startImport(
      activeContext,
      {
        objectKey,
        originalFilename: "transactions_stripe.csv",
        contentType: "text/csv",
        datasetName: `Cross Tenant Read ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )

    await expect(
      getImportView(contextFor("owner", otherOrganizationId), importId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("groups issue counts by code on the completed phase, and the dataset then has no open import", async () => {
    activeContext = contextFor("owner")

    const objectKey = await uploadFixture("transactions_stripe.csv")
    const { importId } = await startImport(
      activeContext,
      {
        objectKey,
        originalFilename: "transactions_stripe.csv",
        contentType: "text/csv",
        datasetName: `Completed Read ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )
    await confirmImport(activeContext, { importId }, { jobDispatcher: getJobDispatcher() })

    const view = await getImportView(activeContext, importId)
    expect(view.phase).toBe("completed")
    if (view.phase !== "completed") throw new Error("expected completed")
    // The version id isn't on ImportView (never had a reason to be, for
    // this screen) — read it back off the row directly for teardown only.
    const completedRow = await getImportForContext(activeContext, importId)
    if (completedRow.datasetVersionId === null) throw new Error("expected a dataset version id")
    createdVersionIds.push(completedRow.datasetVersionId)

    // H0: rowsLoaded (every row) and rowsWithRecordedIssue (a subset) are
    // both real counts, not a partition. transactions_stripe.csv's only
    // unparseable cells are in "amount" (two rows — confirmed by
    // pipeline.integration.test.ts's row-level assertion).
    expect(view.rowsLoaded).toBe(1000)
    expect(view.rowsWithRecordedIssue).toBe(2)
    expect(view.issueCountsByCode).toEqual({ UNPARSEABLE_VALUE: 2 })

    const open = await findOpenImportForDataset(activeContext, view.datasetId)
    expect(open).toBeUndefined()
  })

  // H5: a FAILED profile under InlineDispatcher never navigates the user to
  // /imports/[id] at all — the dataset-page banner (findOpenImportForDataset)
  // is the only path back to it, so a FAILED import must count as "open",
  // not get filtered out alongside COMPLETED/CANCELLED. The column-ceiling
  // failure is the cheapest way to a real FAILED row: it fails inside
  // startImport's own IMPORT_PROFILE dispatch, before any confirm step.
  it("a FAILED profile is still the dataset's open import", async () => {
    activeContext = contextFor("owner")

    const header = Array.from({ length: 101 }, (_, i) => `col_${i}`).join(",")
    const row = Array.from({ length: 101 }, (_, i) => `${i}`).join(",")
    const target = await storage.createUploadTarget(organizationId)
    await storage.receiveUpload(target, Buffer.from(`${header}\n${row}\n`))

    const { importId } = await startImport(
      activeContext,
      {
        objectKey: target.key.value,
        originalFilename: "too-wide.csv",
        contentType: "text/csv",
        datasetName: `Failed Open Read ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )

    const view = await getImportView(activeContext, importId)
    expect(view.phase).toBe("failed")

    const open = await findOpenImportForDataset(activeContext, view.datasetId)
    expect(open?.importId).toBe(importId)
    expect(open?.phase).toBe("failed")
  })

  it("a dataset's open import is undefined once a later import on it completes, even though an earlier one failed", async () => {
    activeContext = contextFor("owner")

    const header = Array.from({ length: 101 }, (_, i) => `col_${i}`).join(",")
    const row = Array.from({ length: 101 }, (_, i) => `${i}`).join(",")
    const failingTarget = await storage.createUploadTarget(organizationId)
    await storage.receiveUpload(failingTarget, Buffer.from(`${header}\n${row}\n`))

    const failed = await startImport(
      activeContext,
      {
        objectKey: failingTarget.key.value,
        originalFilename: "too-wide.csv",
        contentType: "text/csv",
        datasetName: `Failed Then Completed ${runId}`,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )
    const failedView = await getImportView(activeContext, failed.importId)
    const datasetId = failedView.datasetId

    // Add a version to the SAME dataset (dataset:manage, H4) with a file
    // that actually loads.
    const objectKey = await uploadFixture("transactions_stripe.csv")
    const { importId } = await startImport(
      activeContext,
      {
        objectKey,
        originalFilename: "transactions_stripe.csv",
        contentType: "text/csv",
        datasetId,
      },
      { storage, jobDispatcher: getJobDispatcher() },
    )
    await confirmImport(activeContext, { importId }, { jobDispatcher: getJobDispatcher() })

    const completed = await getImportForContext(activeContext, importId)
    if (completed.datasetVersionId !== null) createdVersionIds.push(completed.datasetVersionId)

    const open = await findOpenImportForDataset(activeContext, datasetId)
    expect(open).toBeUndefined()
  })
})
