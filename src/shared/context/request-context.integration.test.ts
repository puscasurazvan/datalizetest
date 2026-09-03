import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { Session } from "@/modules/auth"

// vi.mock factories are hoisted above imports; anything they reference must
// go through vi.hoisted so it exists by the time the factory runs.
const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn<(params: { headers: Headers }) => Promise<Session | null>>(),
}))

vi.mock("@/modules/auth", () => ({
  auth: { api: { getSession } },
}))

// createRequestContext() calls next/headers' headers(), which throws outside
// a real Next.js request scope. This test exercises the database
// re-verification, not Next's request plumbing, so headers() is stubbed to
// a value that is simply forwarded to the mocked getSession above.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}))

import { applicationPool, db } from "@/db/client"
import { organizationMembers, organizations, users } from "@/db/schema"

import { createRequestContext, createRequestContextForJob } from "./request-context"

function fakeSession(userId: string, activeOrganizationId: string | null): Session {
  const now = new Date()
  return {
    session: {
      id: randomUUID(),
      token: randomUUID(),
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      ipAddress: null,
      userAgent: null,
      userId,
      activeOrganizationId,
    },
    user: {
      id: userId,
      name: "Request Context Test User",
      email: `${userId}@example.test`,
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  }
}

describe("createRequestContext (integration)", () => {
  const runId = randomUUID()
  const userId = randomUUID()
  const memberOrgId = randomUUID()
  const strangerOrgId = randomUUID()

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      name: "Request Context Test User",
      email: `request-context-${runId}@example.test`,
      emailVerified: true,
    })

    await db.insert(organizations).values([
      {
        id: memberOrgId,
        name: "Member Org",
        slug: `member-org-${runId}`,
        timezone: "America/New_York",
      },
      {
        id: strangerOrgId,
        name: "Stranger Org",
        slug: `stranger-org-${runId}`,
      },
    ])

    // The user is a member of memberOrg only. strangerOrg exists in the
    // database, but no organization_members row links this user to it.
    await db.insert(organizationMembers).values({
      id: randomUUID(),
      organizationId: memberOrgId,
      userId,
      role: "owner",
    })
  })

  afterAll(async () => {
    await db.delete(organizationMembers).where(eq(organizationMembers.userId, userId))
    await db.delete(organizations).where(eq(organizations.id, memberOrgId))
    await db.delete(organizations).where(eq(organizations.id, strangerOrgId))
    await db.delete(users).where(eq(users.id, userId))
    // Pool stays open — createRequestContextForJob (integration)` below
    // shares this file and needs it; that describe's own afterAll ends it.
  })

  it("throws UNAUTHENTICATED when there is no session", async () => {
    getSession.mockResolvedValueOnce(null)

    await expect(createRequestContext()).rejects.toMatchObject({
      name: "AppError",
      code: "UNAUTHENTICATED",
    })
  })

  it("throws FORBIDDEN when the session has no active organization", async () => {
    getSession.mockResolvedValueOnce(fakeSession(userId, null))

    await expect(createRequestContext()).rejects.toMatchObject({
      name: "AppError",
      code: "FORBIDDEN",
    })
  })

  it("re-verifies membership and refuses with FORBIDDEN for an organization the user is not a member of", async () => {
    // This is the client-influenced case src/modules/auth/CLAUDE.md warns
    // about: the session's activeOrganizationId names a real organization
    // (strangerOrg), but no organization_members row backs it for this
    // user. createRequestContext must re-check the database rather than
    // trusting the session value, and refuse rather than silently scoping
    // to some other organization the user does belong to.
    getSession.mockResolvedValueOnce(fakeSession(userId, strangerOrgId))

    await expect(createRequestContext()).rejects.toMatchObject({
      name: "AppError",
      code: "FORBIDDEN",
    })
  })

  it("returns userId, organizationId, role, and organizationTimezone for a real membership", async () => {
    getSession.mockResolvedValueOnce(fakeSession(userId, memberOrgId))

    const context = await createRequestContext()

    expect(context.userId).toBe(userId)
    expect(context.organizationId).toBe(memberOrgId)
    expect(context.role).toBe("owner")
    expect(context.organizationTimezone).toBe("America/New_York")
  })
})

// createRequestContextForJob is the job-worker constructor (docs/decisions/06
// #1's import pipeline has no request/headers to build a context from) —
// same membership re-verification as createRequestContext above, driven by
// an explicit { userId, organizationId } instead of a session.
describe("createRequestContextForJob (integration)", () => {
  const runId = randomUUID()
  const userId = randomUUID()
  const memberOrgId = randomUUID()
  const strangerOrgId = randomUUID()

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      name: "Job Context Test User",
      email: `job-context-${runId}@example.test`,
      emailVerified: true,
    })

    await db.insert(organizations).values([
      {
        id: memberOrgId,
        name: "Job Context Member Org",
        slug: `job-context-member-${runId}`,
        timezone: "Europe/London",
      },
      {
        id: strangerOrgId,
        name: "Job Context Stranger Org",
        slug: `job-context-stranger-${runId}`,
      },
    ])

    await db.insert(organizationMembers).values({
      id: randomUUID(),
      organizationId: memberOrgId,
      userId,
      role: "editor",
    })
  })

  afterAll(async () => {
    await db.delete(organizationMembers).where(eq(organizationMembers.userId, userId))
    await db.delete(organizations).where(eq(organizations.id, memberOrgId))
    await db.delete(organizations).where(eq(organizations.id, strangerOrgId))
    await db.delete(users).where(eq(users.id, userId))
    await applicationPool.end()
  })

  it("returns userId, organizationId, role, and organizationTimezone for a real membership", async () => {
    const context = await createRequestContextForJob({ userId, organizationId: memberOrgId })

    expect(context.userId).toBe(userId)
    expect(context.organizationId).toBe(memberOrgId)
    expect(context.role).toBe("editor")
    expect(context.organizationTimezone).toBe("Europe/London")
  })

  it("throws FORBIDDEN for an organization the user is not a member of", async () => {
    await expect(
      createRequestContextForJob({ userId, organizationId: strangerOrgId }),
    ).rejects.toMatchObject({ name: "AppError", code: "FORBIDDEN" })
  })

  it("throws FORBIDDEN once membership is revoked between enqueue and run", async () => {
    await expect(
      createRequestContextForJob({ userId, organizationId: memberOrgId }),
    ).resolves.toMatchObject({ organizationId: memberOrgId })

    await db.delete(organizationMembers).where(eq(organizationMembers.userId, userId))

    await expect(
      createRequestContextForJob({ userId, organizationId: memberOrgId }),
    ).rejects.toMatchObject({ name: "AppError", code: "FORBIDDEN" })

    // Restore for the describe block's own afterAll / subsequent runs of this it.
    await db.insert(organizationMembers).values({
      id: randomUUID(),
      organizationId: memberOrgId,
      userId,
      role: "editor",
    })
  })
})
