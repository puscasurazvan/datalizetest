import { randomUUID } from "node:crypto"

import { inArray } from "drizzle-orm"
import { afterAll, describe, expect, it } from "vitest"

import { applicationPool, db } from "@/db/client"
import { organizationMembers, organizations, users } from "@/db/schema"
import { env } from "@/shared/env"

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
    if (createdOrganizationIds.length > 0) {
      await db
        .delete(organizationMembers)
        .where(inArray(organizationMembers.organizationId, createdOrganizationIds))
      await db.delete(organizations).where(inArray(organizations.id, createdOrganizationIds))
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds))
    }
    await applicationPool.end()
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
