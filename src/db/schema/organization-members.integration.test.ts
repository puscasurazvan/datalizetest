import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applicationPool, db } from "@/db/client"
import { organizationMembers, organizations, users } from "@/db/schema"

// docs/decisions/06 #19 (line 157): organization_members must reject a
// second row for the same (organization_id, user_id) pair at the database
// level. Better Auth's own membership writes are check-then-insert with no
// transaction (crud-members.mjs: findMemberByEmail then createMember), so
// nothing but a unique index stops two concurrent accept-invitation calls
// from creating duplicate membership rows for the same user.
describe("organization_members uniqueness (integration)", () => {
  const runId = randomUUID()
  const userId = randomUUID()
  const organizationId = randomUUID()

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      name: "Duplicate Membership Test User",
      email: `org-members-uniqueness-${runId}@example.test`,
      emailVerified: true,
    })

    await db.insert(organizations).values({
      id: organizationId,
      name: "Duplicate Membership Test Org",
      slug: `org-members-uniqueness-${runId}`,
    })
  })

  afterAll(async () => {
    await db.delete(organizationMembers).where(eq(organizationMembers.userId, userId))
    await db.delete(organizations).where(eq(organizations.id, organizationId))
    await db.delete(users).where(eq(users.id, userId))
    await applicationPool.end()
  })

  it("rejects a second membership row for the same organization and user", async () => {
    await db.insert(organizationMembers).values({
      id: randomUUID(),
      organizationId,
      userId,
      role: "owner",
    })

    await expect(
      db.insert(organizationMembers).values({
        id: randomUUID(),
        organizationId,
        userId,
        role: "viewer",
      }),
    ).rejects.toMatchObject({
      cause: { constraint: "organization_members_organization_user_idx" },
    })
  })
})
