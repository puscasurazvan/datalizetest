import { afterAll, describe, expect, it, vi } from "vitest"

import type * as Storage from "@/modules/storage"
import { ObjectKey } from "@/modules/storage"
import type { ObjectStat, UploadTarget } from "@/modules/storage"
import type { RequestContext } from "@/shared/context/request-context"
import { createTestRequestContext } from "@/shared/context/testing"

import { applicationPool } from "@/db/client"

// Regression for plan decision 4 / H1's action-wrapper change: startImportAction
// used to run `startImportInputSchema.parse()` outside its `try` and return
// whatever `startImport` threw — a client-visible unhandled rejection, not
// a renderable form error. Same mock shape as
// src/app/api/uploads/route.test.ts: only `createRequestContext` is faked
// (it reads `headers()`, unavailable outside a real request) and
// `statObject` (to report an oversized object without allocating one) —
// everything else, including the database `startImport` actually touches
// via `findImportByIdempotencyKey`, is real, hence `*.integration.test.ts`.
const context = createTestRequestContext({
  userId: "user_1",
  organizationId: `start-action-${crypto.randomUUID()}`,
  role: "owner",
  organizationTimezone: "UTC",
})

vi.mock("@/shared/context/request-context", () => ({
  createRequestContext: vi.fn<() => Promise<RequestContext>>().mockResolvedValue(context),
}))

const statObject = vi.fn<(key: ObjectKey) => Promise<ObjectStat | undefined>>()

vi.mock("@/modules/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof Storage>()),
  getStorageProvider: () => ({
    createUploadTarget: vi.fn<(organizationId: string) => Promise<UploadTarget>>(),
    readObject: vi.fn<(key: ObjectKey) => Promise<ReadableStream<Uint8Array> | undefined>>(),
    deleteObject: vi.fn<(key: ObjectKey) => Promise<void>>(),
    statObject,
  }),
}))

const { startImportAction } = await import("./start-action")

describe("startImportAction (integration)", () => {
  it("returns {ok:false} naming the byte ceiling for an oversized object, never throws", async () => {
    const key = ObjectKey.forOrganization(context.organizationId)
    statObject.mockResolvedValue({ key, sizeBytes: 60 * 1024 * 1024, lastModified: new Date() })

    const result = await startImportAction({
      objectKey: key.value,
      originalFilename: "oversized.csv",
      contentType: "text/csv",
      datasetName: "Oversized Action Test",
    })

    expect(result).toMatchObject({
      ok: false,
      formError: expect.stringContaining("File exceeds the 52428800-byte limit"),
    })
  })

  it("returns {ok:false} with a field error for a malformed input, never throws", async () => {
    const result = await startImportAction({ originalFilename: "no-object-key.csv" })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a validation failure")
    expect(result.fieldErrors.objectKey).toBeDefined()
  })
})

// `startImport`'s oversized-object rejection happens before any
// analytical-store call, so this file never opens the analytical pool —
// only `applicationPool` (findImportByIdempotencyKey's SELECT) needs closing.
afterAll(async () => {
  await applicationPool.end()
})
