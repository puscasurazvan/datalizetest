import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applicationPool, db } from "@/db/client"
import { datasets, imports, organizationMembers, organizations, users } from "@/db/schema"

import { createContextForImportJob } from "./job-context"

// Confirmed defect this covers: the import pipeline could not run in any
// environment, because nothing under src/ ever called registerImportTasks
// with a real createContextForImport — and the one production
// implementation (formerly trigger/job-context.ts) unconditionally threw.
// createContextForImportJob is now real; this asserts it resolves the
// right context, and refuses correctly when it should.
describe("createContextForImportJob (integration)", () => {
  const runId = randomUUID()
  const userId = randomUUID()
  const organizationId = randomUUID()
  const datasetId = randomUUID()

  let importId: string

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      name: "Job Context Import Test User",
      email: `job-context-import-${runId}@example.test`,
      emailVerified: true,
    })
    await db.insert(organizations).values({
      id: organizationId,
      name: "Job Context Import Test Org",
      slug: `job-context-import-${runId}`,
      timezone: "Asia/Tokyo",
    })
    await db.insert(organizationMembers).values({
      id: randomUUID(),
      organizationId,
      userId,
      role: "admin",
    })
    await db.insert(datasets).values({
      id: datasetId,
      organizationId,
      name: "Job Context Import Test Dataset",
      createdByUserId: userId,
    })

    importId = randomUUID()
    await db.insert(imports).values({
      id: importId,
      organizationId,
      datasetId,
      idempotencyKey: `job-context-${runId}`,
      objectKey: `org/${organizationId}/uploads/${randomUUID()}.csv`,
      originalFilename: "job-context.csv",
      byteSize: 1_024,
      contentType: "text/csv",
      status: "PENDING",
      createdByUserId: userId,
    })
  })

  afterAll(async () => {
    await db.delete(imports).where(eq(imports.organizationId, organizationId))
    await db.delete(datasets).where(eq(datasets.organizationId, organizationId))
    await db
      .delete(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId))
    await db.delete(organizations).where(eq(organizations.id, organizationId))
    await db.delete(users).where(eq(users.id, userId))
    await applicationPool.end()
  })

  it("resolves the import's organization, creator, membership role, and organization timezone", async () => {
    const context = await createContextForImportJob(importId)

    expect(context.userId).toBe(userId)
    expect(context.organizationId).toBe(organizationId)
    expect(context.role).toBe("admin")
    expect(context.organizationTimezone).toBe("Asia/Tokyo")
  })

  it("throws NOT_FOUND for an import id that does not exist", async () => {
    await expect(createContextForImportJob(randomUUID())).rejects.toMatchObject({
      name: "AppError",
      code: "NOT_FOUND",
    })
  })

  it("throws FORBIDDEN once the creator's membership is removed", async () => {
    await db
      .delete(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId))

    await expect(createContextForImportJob(importId)).rejects.toMatchObject({
      name: "AppError",
      code: "FORBIDDEN",
    })

    // Restore so afterAll's own cleanup (and any later test in this file) is unaffected.
    await db.insert(organizationMembers).values({
      id: randomUUID(),
      organizationId,
      userId,
      role: "admin",
    })
  })
})
