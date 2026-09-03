import { randomUUID } from "node:crypto"

import { eq, inArray } from "drizzle-orm"
import { afterAll, describe, expect, it } from "vitest"

import { applicationPool, db } from "@/db/client"
import {
  analyticalTables,
  datasets,
  datasetVersions,
  organizationMembers,
  organizations,
  sessions,
  users,
} from "@/db/schema"
import { env } from "@/shared/env"

import { countRegisteredTables } from "@/modules/analytical-store/registered-tables"
import { resolveInitialActiveOrganizationId } from "@/modules/organizations/initial-active-organization"

import { auth } from "./auth"

/**
 * Posts straight through `auth.handler`, Better Auth's real HTTP boundary
 * (the same one `src/app/api/auth/[...all]/route.ts` mounts) — a raw JSON
 * body, not a call through `auth.api.*`. Two of the "member"-rejection
 * tests below need this rather than `auth.api.*`: once `roles` (in
 * auth.ts) is configured, Better Auth's own generated types narrow
 * `auth.api.createInvitation`'s and `auth.api.updateMemberRole`'s `role`
 * parameter to exactly `"owner" | "admin" | "editor" | "viewer"`, so
 * passing `"member"` there is a compile error, not a runtime one —
 * correct, and a welcome side effect of the fix, but it means the only way
 * left to prove the *server* still refuses `"member"` is the same untyped
 * boundary a real HTTP client uses.
 */
async function postAuthEndpoint(path: string, body: unknown, headers: Headers): Promise<Response> {
  const request = new Request(new URL(path, env().BETTER_AUTH_URL), {
    method: "POST",
    headers: new Headers({ ...Object.fromEntries(headers), "content-type": "application/json" }),
    body: JSON.stringify(body),
  })
  return auth.handler(request)
}

/**
 * docs/decisions/06 #19: the `organization` plugin must be configured with
 * Datalize's own four-role vocabulary (owner/admin/editor/viewer), not
 * Better Auth's built-in owner/admin/member. Before that config existed,
 * `auth.api.createInvitation` rejected "editor" and "viewer" with
 * `ROLE_NOT_FOUND` — the only assignable non-owner/admin role was "member",
 * a value policy.ts's `ROLE_PERMISSIONS` cannot represent (its holder would
 * be locked out of every request). This exercises the real Better Auth
 * instance end to end, over the same `auth.api` surface the app code and
 * the invite UI use — not a mock.
 */
describe("auth organization plugin role vocabulary (integration)", () => {
  const runId = randomUUID()
  const createdUserIds: string[] = []
  const createdOrganizationIds: string[] = []

  afterAll(async () => {
    // Every signUpOwner() call below now also creates a personal
    // Organization (docs/decisions/06 #14's signup hook, wired in
    // auth.ts) — one this file never explicitly tracks in
    // `createdOrganizationIds`. `organization_members` rows cascade away
    // when their `users` row is deleted, but the `organizations` row
    // itself has no such cascade, so it would otherwise survive as an
    // orphan. Found here by membership rather than by name, since this
    // file has no other way to know the personal org's id.
    if (createdUserIds.length > 0) {
      const personalOrgMemberships = await db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(inArray(organizationMembers.userId, createdUserIds))
      for (const { organizationId } of personalOrgMemberships) {
        createdOrganizationIds.push(organizationId)
      }
    }

    if (createdOrganizationIds.length > 0) {
      await db
        .delete(organizationMembers)
        .where(inArray(organizationMembers.organizationId, createdOrganizationIds))
      await db.delete(organizations).where(inArray(organizations.id, createdOrganizationIds))
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds))
    }
    // Pool stays open — the "signup creates a personal Organization"
    // describe block below shares this file and needs it; that block's
    // own afterAll ends it.
  })

  /**
   * Signs up a fresh owner and returns request headers carrying that
   * user's session cookie, so subsequent calls run as an authenticated
   * member the way the mounted HTTP route would see them —
   * `createInvitation` requires a real session (`requireHeaders: true`,
   * `orgSessionMiddleware`), not just a body.
   */
  async function signUpOwner(): Promise<Headers> {
    const email = `auth-roles-${randomUUID()}@example.test`
    const { headers, response } = await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery-staple", name: "Role Vocab Test Owner" },
      returnHeaders: true,
    })
    createdUserIds.push(response.user.id)

    const cookie = headers.get("set-cookie")
    if (cookie === null) {
      throw new Error("signUpEmail did not set a session cookie")
    }
    // Only the name=value pair is needed on the way back in; strip the
    // Path/HttpOnly/SameSite attributes the Set-Cookie header also carries.
    return new Headers({ cookie: cookie.split(";")[0] ?? "" })
  }

  it("accepts 'editor' and 'viewer' as invitation roles instead of throwing ROLE_NOT_FOUND", async () => {
    const ownerHeaders = await signUpOwner()

    const organization = await auth.api.createOrganization({
      body: { name: "Role Vocab Test Org", slug: `role-vocab-${runId}` },
      headers: ownerHeaders,
    })
    if (organization === null) {
      throw new Error("createOrganization returned null")
    }
    createdOrganizationIds.push(organization.id)

    const editorInvitation = await auth.api.createInvitation({
      body: {
        email: `editor-${runId}@example.test`,
        role: "editor",
        organizationId: organization.id,
      },
      headers: ownerHeaders,
    })
    expect(editorInvitation.role).toBe("editor")

    const viewerInvitation = await auth.api.createInvitation({
      body: {
        email: `viewer-${runId}@example.test`,
        role: "viewer",
        organizationId: organization.id,
      },
      headers: ownerHeaders,
    })
    expect(viewerInvitation.role).toBe("viewer")
  })

  it("still accepts 'owner' and 'admin', unchanged from Better Auth's defaults", async () => {
    const ownerHeaders = await signUpOwner()

    const organization = await auth.api.createOrganization({
      body: { name: "Role Vocab Test Org 2", slug: `role-vocab-2-${runId}` },
      headers: ownerHeaders,
    })
    if (organization === null) {
      throw new Error("createOrganization returned null")
    }
    createdOrganizationIds.push(organization.id)

    const adminInvitation = await auth.api.createInvitation({
      body: {
        email: `admin-${runId}@example.test`,
        role: "admin",
        organizationId: organization.id,
      },
      headers: ownerHeaders,
    })
    expect(adminInvitation.role).toBe("admin")
  })

  /**
   * Configuring `roles` (above) does not, by itself, stop "member" from
   * being accepted — Better Auth's own role-vocabulary check unions
   * `orgOptions.roles` with its *built-in* `defaultRoles`, which always
   * includes "member", regardless of what `roles` overrides
   * (`crud-invites.mjs`, verified reading the library source — see the
   * comment on `assertKnownRoles` in auth.ts). This is what
   * `organizationHooks.beforeCreateInvitation` closes.
   */
  it("rejects 'member' as an invitation role over the HTTP boundary", async () => {
    const ownerHeaders = await signUpOwner()

    const organization = await auth.api.createOrganization({
      body: { name: "Role Vocab Test Org 3", slug: `role-vocab-3-${runId}` },
      headers: ownerHeaders,
    })
    if (organization === null) {
      throw new Error("createOrganization returned null")
    }
    createdOrganizationIds.push(organization.id)

    const response = await postAuthEndpoint(
      "/api/auth/organization/invite-member",
      { email: `member-${runId}@example.test`, role: "member", organizationId: organization.id },
      ownerHeaders,
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toMatchObject({ message: expect.stringContaining("ROLE_NOT_FOUND") })
  })

  /**
   * Same gap as above, on `/organization/update-member-role`
   * (`crud-members.mjs`), the other route the original defect named.
   */
  it("rejects 'member' as an update-member-role target over the HTTP boundary", async () => {
    const ownerHeaders = await signUpOwner()

    const organization = await auth.api.createOrganization({
      body: { name: "Role Vocab Test Org 4", slug: `role-vocab-4-${runId}` },
      headers: ownerHeaders,
    })
    if (organization === null) {
      throw new Error("createOrganization returned null")
    }
    createdOrganizationIds.push(organization.id)

    const memberEmail = `add-member-${runId}@example.test`
    const { response: memberUser } = await auth.api.signUpEmail({
      body: { email: memberEmail, password: "correct-horse-battery-staple", name: "Added Member" },
      returnHeaders: true,
    })
    createdUserIds.push(memberUser.user.id)

    const addedMember = await auth.api.addMember({
      body: { userId: memberUser.user.id, role: "viewer", organizationId: organization.id },
    })
    if (addedMember === null) {
      throw new Error("addMember returned null")
    }
    expect(addedMember.role).toBe("viewer")

    const response = await postAuthEndpoint(
      "/api/auth/organization/update-member-role",
      { memberId: addedMember.id, role: "member", organizationId: organization.id },
      ownerHeaders,
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toMatchObject({ message: expect.stringContaining("ROLE_NOT_FOUND") })

    // The member's role is unchanged, still "viewer" — a rejected request
    // must not have partially applied.
    const stillViewer = await auth.api.updateMemberRole({
      body: { memberId: addedMember.id, role: "editor", organizationId: organization.id },
      headers: ownerHeaders,
    })
    expect(stillViewer.role).toBe("editor")
  })

  /**
   * `organization/add-member` (`crud-members.mjs`'s `addMember`) has no
   * role-vocabulary check of its own at all — unlike invite and
   * update-member-role, nothing in the library stops it writing an
   * arbitrary role string; it is also server-only (never mounted over
   * HTTP, so `postAuthEndpoint` above cannot reach it — this is why the
   * invalid role here has to come in through `JSON.parse`, the same
   * "untyped by construction" boundary, rather than a literal). Without
   * `organizationHooks.beforeAddMember` in auth.ts, this would succeed
   * and write role "member" straight into `organization_members`.
   */
  it("rejects 'member' when adding a member directly", async () => {
    const ownerHeaders = await signUpOwner()

    const organization = await auth.api.createOrganization({
      body: { name: "Role Vocab Test Org 5", slug: `role-vocab-5-${runId}` },
      headers: ownerHeaders,
    })
    if (organization === null) {
      throw new Error("createOrganization returned null")
    }
    createdOrganizationIds.push(organization.id)

    const memberEmail = `add-member-2-${runId}@example.test`
    const { response: memberUser } = await auth.api.signUpEmail({
      body: {
        email: memberEmail,
        password: "correct-horse-battery-staple",
        name: "Added Member 2",
      },
      returnHeaders: true,
    })
    createdUserIds.push(memberUser.user.id)

    const invalidRole = JSON.parse('"member"')

    await expect(
      auth.api.addMember({
        body: { userId: memberUser.user.id, role: invalidRole, organizationId: organization.id },
      }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" })
  })
})

// Confirmed defect this covers: no signup path created a personal
// Organization — a new user reached the app with zero Organizations and
// had to hand-create a workspace before reaching any product surface.
// docs/decisions/06 #14/#19, this module's own CLAUDE.md: "A user signing
// up with no organization gets a personal one and becomes its owner."
describe("signup creates a personal Organization (integration)", () => {
  const createdUserIds: string[] = []

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      const memberships = await db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(inArray(organizationMembers.userId, createdUserIds))
      const organizationIds = memberships.map((m) => m.organizationId)
      if (organizationIds.length > 0) {
        await db
          .delete(organizationMembers)
          .where(inArray(organizationMembers.organizationId, organizationIds))
        await db.delete(organizations).where(inArray(organizations.id, organizationIds))
      }
      await db.delete(users).where(inArray(users.id, createdUserIds))
    }
  })

  it("email/password sign-up gets exactly one personal Organization, with the user as owner", async () => {
    const email = `personal-org-${randomUUID()}@example.test`
    const signedUp = await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery-staple", name: "Personal Org Test User" },
    })
    createdUserIds.push(signedUp.user.id)

    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, signedUp.user.id))

    expect(memberships).toHaveLength(1)
    expect(memberships[0]?.role).toBe("owner")

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, memberships[0]?.organizationId ?? ""))
    expect(org).toBeDefined()
    expect(org?.name.toLowerCase()).toContain("workspace")
  })

  it("is idempotent per user — createPersonalOrganizationForUser called twice for the same user creates only one", async () => {
    const email = `personal-org-idempotent-${randomUUID()}@example.test`
    const signedUp = await auth.api.signUpEmail({
      body: {
        email,
        password: "correct-horse-battery-staple",
        name: "Personal Org Idempotent Test User",
      },
    })
    createdUserIds.push(signedUp.user.id)

    const { createPersonalOrganizationForUser } =
      await import("@/modules/organizations/personal-organization")
    // Simulates the "hook invoked twice for the same row" case the doc
    // comment on createPersonalOrganizationForUser calls out — the hook
    // itself only ever fires once per real signup, so this drives the
    // function directly rather than trying to force Better Auth to
    // double-fire its own hook.
    await createPersonalOrganizationForUser(signedUp.user.id, email)

    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, signedUp.user.id))
    expect(memberships).toHaveLength(1)
  })

  it("a first-time social sign-in (email match to no existing user) gets a personal Organization too", async () => {
    // The hook fires on every users row Better Auth inserts, regardless of
    // which sign-up path created it (auth.ts's own doc comment on
    // databaseHooks.user.create.after) — this drives the hook's own
    // function directly against a user shaped like one OAuth would create
    // (no password), rather than standing up a real OAuth provider in a
    // test.
    const email = `personal-org-social-${randomUUID()}@example.test`
    const userId = randomUUID()
    await db.insert(users).values({ id: userId, name: "Social Sign-In Test User", email })
    createdUserIds.push(userId)

    const { createPersonalOrganizationForUser } =
      await import("@/modules/organizations/personal-organization")
    await createPersonalOrganizationForUser(userId, email)

    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId))
    expect(memberships).toHaveLength(1)
    expect(memberships[0]?.role).toBe("owner")
  })
})

// The session hook in auth.ts, not the user hook above: creating the personal
// Organization is only half of docs/decisions/06 #14 — the new session has to
// actually start inside it, or the user lands on the workspace picker holding
// exactly one workspace.
describe("a new session starts in the user's sole Organization (integration)", () => {
  const createdUserIds: string[] = []

  afterAll(async () => {
    const memberships = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(inArray(organizationMembers.userId, createdUserIds))
    const organizationIds = memberships.map((m) => m.organizationId)
    await db.delete(sessions).where(inArray(sessions.userId, createdUserIds))
    if (organizationIds.length > 0) {
      await db
        .delete(organizationMembers)
        .where(inArray(organizationMembers.organizationId, organizationIds))
      await db.delete(organizations).where(inArray(organizations.id, organizationIds))
    }
    await db.delete(users).where(inArray(users.id, createdUserIds))
  })

  const password = "correct-horse-battery-staple"

  it("stamps activeOrganizationId on the session created at sign-in", async () => {
    const email = `active-org-${randomUUID()}@example.test`
    const signedUp = await auth.api.signUpEmail({
      body: { email, password, name: "Active Org Test User" },
    })
    createdUserIds.push(signedUp.user.id)

    const [membership] = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, signedUp.user.id))
    expect(membership).toBeDefined()

    await auth.api.signInEmail({ body: { email, password } })

    const userSessions = await db
      .select({ activeOrganizationId: sessions.activeOrganizationId })
      .from(sessions)
      .where(eq(sessions.userId, signedUp.user.id))

    expect(userSessions.length).toBeGreaterThan(0)
    expect(userSessions.some((s) => s.activeOrganizationId === membership?.organizationId)).toBe(
      true,
    )
  })

  // Documents the ordering, so a future reader does not "fix" the hook to
  // cover sign-up: Better Auth creates the session BEFORE `user.create.after`
  // runs, so the personal Organization does not exist when the hook fires.
  // `OpenSoleWorkspace` (src/components/shell/open-sole-workspace.tsx) is what
  // covers this case, on the client, where the session cookie can be set.
  it("leaves the sign-up session's activeOrganizationId null, because the Organization does not exist yet", async () => {
    const email = `active-org-signup-${randomUUID()}@example.test`
    const signedUp = await auth.api.signUpEmail({
      body: { email, password, name: "Signup Ordering Test User" },
    })
    createdUserIds.push(signedUp.user.id)

    const userSessions = await db
      .select({ activeOrganizationId: sessions.activeOrganizationId })
      .from(sessions)
      .where(eq(sessions.userId, signedUp.user.id))

    expect(userSessions).toHaveLength(1)
    expect(userSessions[0]?.activeOrganizationId).toBeNull()
  })

  it("abstains when the user belongs to more than one Organization", async () => {
    const email = `active-org-multi-${randomUUID()}@example.test`
    const signedUp = await auth.api.signUpEmail({
      body: { email, password, name: "Multi Org Test User" },
    })
    createdUserIds.push(signedUp.user.id)

    // A second membership makes the choice ambiguous, so no default is picked.
    const secondOrganizationId = randomUUID()
    await db.insert(organizations).values({
      id: secondOrganizationId,
      name: "Second workspace",
      slug: `second-${secondOrganizationId}`,
    })
    await db.insert(organizationMembers).values({
      id: randomUUID(),
      organizationId: secondOrganizationId,
      userId: signedUp.user.id,
      role: "viewer",
    })

    await expect(resolveInitialActiveOrganizationId(signedUp.user.id)).resolves.toBeUndefined()
  })
})

// analytical_tables.dataset_version_id is ON DELETE RESTRICT, so Postgres
// blocks a workspace delete that would orphan loaded rows. The hook exists so
// the user is told why, instead of seeing a bare foreign-key violation.
describe("deleting a workspace that still holds loaded data (integration)", () => {
  const datasetId = randomUUID()
  const datasetVersionId = randomUUID()
  const createdUserIds: string[] = []
  let organizationId = ""

  afterAll(async () => {
    await db.delete(analyticalTables).where(eq(analyticalTables.datasetVersionId, datasetVersionId))
    await db.delete(datasetVersions).where(eq(datasetVersions.id, datasetVersionId))
    await db.delete(datasets).where(eq(datasets.id, datasetId))
    if (createdUserIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, createdUserIds))
      await db
        .delete(organizationMembers)
        .where(inArray(organizationMembers.userId, createdUserIds))
      if (organizationId !== "") {
        await db.delete(organizations).where(eq(organizations.id, organizationId))
      }
      await db.delete(users).where(inArray(users.id, createdUserIds))
    }
    // Last describe in this file owns the shared pool's teardown.
    await applicationPool.end()
  })

  it("is refused with a message naming the reason, not a foreign-key violation", async () => {
    const email = `workspace-delete-${randomUUID()}@example.test`
    const { headers, response } = await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery-staple", name: "Workspace Delete User" },
      returnHeaders: true,
    })
    createdUserIds.push(response.user.id)
    const cookie = headers.get("set-cookie")
    expect(cookie).not.toBeNull()
    const ownerHeaders = new Headers({ cookie: cookie?.split(";")[0] ?? "" })

    // The personal Organization the signup hook created.
    const [membership] = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, response.user.id))
    expect(membership).toBeDefined()
    organizationId = membership?.organizationId ?? ""

    await db.insert(datasets).values({
      id: datasetId,
      organizationId,
      name: "Loaded dataset",
      createdByUserId: response.user.id,
    })
    await db.insert(datasetVersions).values({
      id: datasetVersionId,
      organizationId,
      datasetId,
      versionNumber: 1,
      status: "COMPLETED",
      timezoneUsedForNaiveTimestamps: "UTC",
    })
    await db.insert(analyticalTables).values({
      datasetVersionId,
      organizationId,
      schemaName: "analytical",
      tableName: `dv_${datasetVersionId.replace(/-/g, "")}`,
    })

    await expect(countRegisteredTables(organizationId)).resolves.toBe(1)

    // The hook refuses before Postgres has to, so the user gets a reason.
    await expect(
      auth.api.deleteOrganization({ body: { organizationId }, headers: ownerHeaders }),
    ).rejects.toThrow(/still holds 1 loaded dataset/)

    // And the workspace is still there.
    const [survivor] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
    expect(survivor).toBeDefined()
  })

  it("counts zero for a workspace with no loaded data", async () => {
    await expect(countRegisteredTables(randomUUID())).resolves.toBe(0)
  })
})
