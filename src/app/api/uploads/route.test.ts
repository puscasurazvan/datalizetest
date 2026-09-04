import { describe, expect, it, vi } from "vitest"

import type { PolicyContext } from "@/modules/auth/policy"
import type * as Storage from "@/modules/storage"
import { ObjectKey, PresignedUploadUrl } from "@/modules/storage"
import type { UploadTarget } from "@/modules/storage"
import type { RequestContext } from "@/shared/context/request-context"
import { createTestRequestContext } from "@/shared/context/testing"

// Unlike src/modules/storage/s3.test.ts, this doesn't need `vi.hoisted`:
// `createTestRequestContext` is only usable once its own import has run,
// so the mock value has to be built from a plain `const` below anyway —
// the `vi.mock` factories that close over it aren't invoked until this
// file's own dynamic `await import("./route")` below runs them.
const context = createTestRequestContext({
  userId: "user_1",
  organizationId: "org_1",
  role: "owner",
  organizationTimezone: "UTC",
})
const createUploadTarget = vi.fn<(organizationId: string) => Promise<UploadTarget>>()

vi.mock("@/shared/context/request-context", () => ({
  createRequestContext: vi.fn<() => Promise<RequestContext>>().mockResolvedValue(context),
}))

// The real "@/modules/organizations" pulls in "@/db/client", which reads
// process.env at import time — pointless here since this route's own
// behavior (the memory:// refusal) doesn't depend on real policy-context
// derivation, only on `context.role` reaching `assertCan`.
vi.mock("@/modules/organizations", () => ({
  toPolicyContext: (requestContext: RequestContext): PolicyContext => ({
    organizationId: requestContext.organizationId,
    role: "owner",
  }),
}))

vi.mock("@/modules/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof Storage>()),
  getStorageProvider: () => ({ createUploadTarget }),
}))

const { POST } = await import("./route")

const key = ObjectKey.forOrganization("org_1")
const baseTarget = {
  key,
  maxSizeBytes: 50 * 1024 * 1024,
  expiresAt: new Date("2026-01-01T00:15:00Z"),
}

describe("POST /api/uploads", () => {
  // The fallback InMemoryStorageProvider (src/modules/storage/index.ts)
  // mints a `memory://` URL when no STORAGE_* variable is set — no browser
  // can PUT to that, so the route must say so instead of handing it out.
  it("refuses a memory:// upload target with a VALIDATION error", async () => {
    createUploadTarget.mockResolvedValue({
      ...baseTarget,
      url: PresignedUploadUrl.from(`memory://${key.value}`),
    })

    const response = await POST()

    expect(response.status).toBe(400)
    const body: unknown = await response.json()
    expect(body).toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("not configured"),
    })
  })

  it("returns 200 with the presigned target for an http(s) storage provider", async () => {
    const url = `http://localhost:9000/datalize-uploads/${key.value}`
    createUploadTarget.mockResolvedValue({
      ...baseTarget,
      url: PresignedUploadUrl.from(url),
    })

    const response = await POST()

    expect(response.status).toBe(200)
    const body: unknown = await response.json()
    expect(body).toMatchObject({
      key: key.value,
      url,
      maxSizeBytes: baseTarget.maxSizeBytes,
    })
  })
})
