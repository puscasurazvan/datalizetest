import { APIError, betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"
import { adminAc, defaultAc, ownerAc } from "better-auth/plugins/organization/access"

import { db } from "@/db/client"
import * as authSchema from "@/db/schema/auth"
import { env } from "@/shared/env"

import { ROLES } from "./policy"

/**
 * Better Auth's own access-control layer, which gates its built-in
 * organization endpoints (invite, remove-member, update-member-role, ...).
 * This is a *different* layer than src/modules/auth/policy.ts, which gates
 * Datalize's own resources (datasets, queries, ...) — see the `roles`
 * option below for how the two line up.
 *
 * `editor` and `viewer` get no grants here (an empty statement set), which
 * matches policy.ts: neither role holds `member:manage` or
 * `organization:update` in the ROLE_PERMISSIONS matrix (docs/decisions/06
 * #13), so neither should be able to invite, remove, or re-role a member,
 * or update the organization, through Better Auth's own endpoints either.
 */
const editorAc = defaultAc.newRole({})
const viewerAc = defaultAc.newRole({})

/**
 * `roles` (below) closes the gap the docs/decisions/06 #19 verifier found
 * for "editor"/"viewer", but it does not close the other half: Better
 * Auth's own role-vocabulary check
 * (`validStaticRoles = new Set([...Object.keys(defaultRoles), ...])`,
 * `crud-invites.mjs`/`crud-members.mjs`) always allows its *built-in*
 * `defaultRoles` keys too — `owner`, `admin`, and `member` — regardless of
 * what `roles` overrides, because that Set is unioned from both, never
 * replaced. So "member" stays invitable/assignable after configuring
 * `roles` alone, and `organization/add-member` (`crud-members.mjs`
 * `addMember`) has no role-vocabulary check at all. A member stuck with
 * role "member" is a value `policy.ts`'s `ROLE_PERMISSIONS` cannot
 * represent, so it is rejected here instead, at the one place all three
 * mutation routes already call out to: `organizationHooks`. Each hook
 * fires after Better Auth's own (insufficient) check has passed, so this
 * only ever has to catch "member" and any dynamic-access-control role name
 * (unreachable — `dynamicAccessControl` is not enabled below).
 */
function assertKnownRoles(roleField: string): void {
  const unknownRoles = roleField
    .split(",")
    .map((role) => role.trim())
    .filter((role) => ROLES.find((known) => known === role) === undefined)

  if (unknownRoles.length > 0) {
    throw new APIError("BAD_REQUEST", {
      message: `ROLE_NOT_FOUND: ${unknownRoles.join(", ")}`,
    })
  }
}

/**
 * Better Auth instance. Owns identity and membership (users, sessions,
 * accounts, verifications, organizations, organization_members,
 * invitations) — src/modules/auth/CLAUDE.md. Datalize services own all
 * resource-level authorization on top of it.
 *
 * Table naming: `usePlural: true` pluralizes each model's *default* name
 * (organization -> organizations, invitation -> invitations). A plugin
 * modelName override is pluralized again on top of itself, so `organization`
 * and `invitation` are left at their defaults here and only `member` is
 * overridden — to the singular "organization_member" — so the single
 * pluralization lands on "organization_members". See the comment in
 * src/db/schema/auth.ts for how this was verified.
 */
export const auth = betterAuth({
  secret: env().BETTER_AUTH_SECRET,
  baseURL: env().BETTER_AUTH_URL,

  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
    schema: {
      users: authSchema.users,
      sessions: authSchema.sessions,
      accounts: authSchema.accounts,
      verifications: authSchema.verifications,
      organizations: authSchema.organizations,
      organization_members: authSchema.organizationMembers,
      invitations: authSchema.invitations,
    },
  }),

  emailAndPassword: {
    enabled: true,
  },

  plugins: [
    organization({
      // Datalize's four-role vocabulary (docs/decisions/06 #13, #19) —
      // without this, Better Auth falls back to its built-in owner/admin/
      // member roles and rejects "editor" and "viewer" as ROLE_NOT_FOUND on
      // every membership endpoint. `owner` and `admin` reuse Better Auth's
      // own full-permission roles unchanged; only `editor` and `viewer` are
      // new. `creatorRole` is left unset — it already defaults to "owner",
      // which is in this set. This alone does not stop "member" from still
      // being accepted (see `assertKnownRoles` above) — `organizationHooks`
      // below is what closes that.
      roles: {
        owner: ownerAc,
        admin: adminAc,
        editor: editorAc,
        viewer: viewerAc,
      },
      organizationHooks: {
        beforeCreateInvitation: async ({ invitation }) => {
          assertKnownRoles(invitation.role)
        },
        beforeAddMember: async ({ member }) => {
          assertKnownRoles(member.role)
        },
        beforeUpdateMemberRole: async ({ newRole }) => {
          assertKnownRoles(newRole)
        },
      },
      schema: {
        member: {
          modelName: "organization_member",
        },
        organization: {
          additionalFields: {
            // Every Organization owns one IANA timezone applied to all date
            // grouping in queries (docs/decisions/03,
            // src/modules/organizations/CLAUDE.md). Better Auth owns the
            // organizations table, so this column cannot come from a
            // Datalize migration — it ships as a Better Auth additional
            // field instead. The NOT NULL DEFAULT 'UTC' is enforced at the
            // database level in src/db/schema/auth.ts.
            timezone: {
              type: "string",
              required: true,
              defaultValue: "UTC",
              input: false,
            },
          },
        },
      },
    }),
  ],
})
