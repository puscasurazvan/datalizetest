import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { qualifiedTableName } from "@/modules/analytical-store/physical-names"
import { getJobDispatcher, jobRegistry } from "@/modules/jobs"
import { InMemoryStorageProvider, getStorageProvider } from "@/modules/storage"
import { createTestRequestContext } from "@/shared/context/testing"

import { importPool } from "@/db/analytical"
import { applicationPool, db } from "@/db/client"
import {
  analyticalColumns,
  analyticalTables,
  datasetVersions,
  datasets,
  imports,
  organizationMembers,
  organizations,
  users,
} from "@/db/schema"

import { confirmImport } from "./confirm"
import { productionImportTaskDeps, ensureImportTasksRegistered } from "./register-production-tasks"
import { startImport } from "./start"
import { getImportForContext } from "../repository/import-repository"

// End-to-end regression for the confirmed defect: nothing under src/ ever
// called registerImportTasks with a real createContextForImport, so
// InlineDispatcher's registry was empty and startImportAction's own
// enqueue("IMPORT_PROFILE", ...) threw `No task registered for job type
// "IMPORT_PROFILE"`. Unlike pipeline.integration.test.ts (which wires
// registerImportTasks by hand in beforeAll), this test drives the pipeline
// through ONLY the production entry point (ensureImportTasksRegistered)
// and the REAL job-context constructor (createContextForImportJob, via
// productionImportTaskDeps) — proving the actual gap the defect named is
// closed, not just that the underlying functions work when wired manually.
describe("ensureImportTasksRegistered (integration)", () => {
  const runId = randomUUID()
  const userId = randomUUID()
  const organizationId = randomUUID()
  let versionIdToClean: string | undefined

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      name: "Production Wiring Test User",
      email: `production-wiring-${runId}@example.test`,
      emailVerified: true,
    })
    await db.insert(organizations).values({
      id: organizationId,
      name: "Production Wiring Test Org",
      slug: `production-wiring-${runId}`,
    })
    await db.insert(organizationMembers).values({
      id: randomUUID(),
      organizationId,
      userId,
      role: "owner",
    })
  })

  afterAll(async () => {
    if (versionIdToClean !== undefined) {
      const { analyticalStore } = productionImportTaskDeps()
      await analyticalStore.dropVersion(
        createTestRequestContext({
          userId,
          organizationId,
          role: "owner",
          organizationTimezone: "UTC",
        }),
        versionIdToClean,
      )
    }
    await db.delete(analyticalColumns).where(eq(analyticalColumns.organizationId, organizationId))
    await db.delete(analyticalTables).where(eq(analyticalTables.organizationId, organizationId))
    await db.delete(imports).where(eq(imports.organizationId, organizationId))
    await db.delete(datasetVersions).where(eq(datasetVersions.organizationId, organizationId))
    await db.delete(datasets).where(eq(datasets.organizationId, organizationId))
    await db
      .delete(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId))
    await db.delete(organizations).where(eq(organizations.id, organizationId))
    await db.delete(users).where(eq(users.id, userId))
    await importPool.end()
    await applicationPool.end()
  })

  it("registers IMPORT_PROFILE and IMPORT_LOAD with jobRegistry", () => {
    ensureImportTasksRegistered()

    expect(jobRegistry.get("IMPORT_PROFILE")).toBeDefined()
    expect(jobRegistry.get("IMPORT_LOAD")).toBeDefined()
  })

  it("is idempotent — calling it repeatedly does not throw or replace a working registration", () => {
    ensureImportTasksRegistered()
    ensureImportTasksRegistered()
    ensureImportTasksRegistered()

    expect(jobRegistry.get("IMPORT_PROFILE")).toBeDefined()
  })

  it(
    "a real upload runs profile -> confirm -> load end to end through only the production wiring " +
      "(no manual registerImportTasks call, no test-context override)",
    async () => {
      ensureImportTasksRegistered()

      const storage = getStorageProvider()
      if (!(storage instanceof InMemoryStorageProvider)) {
        throw new Error("expected InMemoryStorageProvider in the test environment")
      }
      const target = await storage.createUploadTarget(organizationId)
      await storage.receiveUpload(target, Buffer.from("name,amount\nalice,10\nbob,20\n"))

      const context = createTestRequestContext({
        userId,
        organizationId,
        role: "owner",
        organizationTimezone: "UTC",
      })

      // startImportAction (the real Server Action) is not called directly —
      // it reads headers() via createRequestContext, which throws outside a
      // real Next.js request. This calls the same two things it calls,
      // in the same order: ensureImportTasksRegistered() above, then
      // startImport with the real job dispatcher.
      const { importId } = await startImport(
        context,
        {
          objectKey: target.key.value,
          originalFilename: "production-wiring.csv",
          contentType: "text/csv",
          datasetName: `Production Wiring ${runId}`,
        },
        { storage, jobDispatcher: getJobDispatcher() },
      )

      const profiled = await getImportForContext(context, importId)
      expect(profiled.status).toBe("AWAITING_CONFIRMATION")
      expect(profiled.errorCode).toBeNull()

      await confirmImport(context, { importId }, { jobDispatcher: getJobDispatcher() })

      const loaded = await getImportForContext(context, importId)
      expect(loaded.status).toBe("COMPLETED")
      expect(loaded.errorCode).toBeNull()
      const versionId = loaded.datasetVersionId
      if (versionId === null) throw new Error("expected a dataset version id")
      versionIdToClean = versionId

      const rowCount = await importPool.query<{ count: string }>(
        `select count(*)::text as count from ${qualifiedTableName(versionId)}`,
      )
      expect(rowCount.rows[0]?.count).toBe("2")
    },
  )
})
