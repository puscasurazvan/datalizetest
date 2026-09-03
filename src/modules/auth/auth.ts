import { APIError, betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"
import { adminAc, defaultAc, ownerAc } from "better-auth/plugins/organization/access"

import { db } from "@/db/client"
import * as authSchema from "@/db/schema/auth"
// Imported from this exact file, not the `@/modules/organizations` barrel
// (`./index.ts`) — that barrel also re-exports `./service.ts`, which
// itself imports `@/modules/auth`, so going through it here would make
// `@/modules/auth` and `@/modules/organizations` statically circular.
// `personal-organization.ts` itself has no such import (see its own doc
// comment for why), so importing it directly is cycle-free.
import { countRegisteredTables } from "@/modules/analytical-store/registered-tables"
import { createPersonalOrganizationForUser } from "@/modules/organizations/personal-organization"
import { resolveInitialActiveOrganizationId } from "@/modules/organizations/initial-active-organization"
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
 * `google`/`github` are added to `socialProviders` only when both halves of
 * their credential pair are present. `env()`'s own schema (src/shared/env.ts)
 * already guarantees a provider is never configured with exactly one of the
 * two — that fails at boot — so checking `clientId !== undefined` here is
 * enough to also guarantee `clientSecret` is defined. Read into a local
 * `environment` binding first: TypeScript can narrow a property read on a
 * stable local variable, but not the same property read on two separate
 * calls to `env()`, even though `env()` is memoized and returns the same
 * object every time.
 */
const environment = env()

const googleCredentials =
  environment.GOOGLE_CLIENT_ID !== undefined && environment.GOOGLE_CLIENT_SECRET !== undefined
    ? { clientId: environment.GOOGLE_CLIENT_ID, clientSecret: environment.GOOGLE_CLIENT_SECRET }
    : undefined

const githubCredentials =
  environment.GITHUB_CLIENT_ID !== undefined && environment.GITHUB_CLIENT_SECRET !== undefined
    ? { clientId: environment.GITHUB_CLIENT_ID, clientSecret: environment.GITHUB_CLIENT_SECRET }
    : undefined

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

  /**
   * docs/decisions/06 #14 / #19, this module's own CLAUDE.md: "A user
   * signing up with no organization gets a personal one and becomes its
   * owner." `user.create.after` fires once per `users` row Better Auth
   * actually inserts — the same hook backs email/password sign-up and a
   * first-time social sign-in identically, since both create a `users` row
   * exactly the same way.
   *
   * Deliberately NOT `user.create.before`: `createPersonalOrganizationForUser`
   * inserts a real `organization_members` row keyed on this user's id, so
   * it must run after the `users` row is actually committed, not before —
   * a `before` hook's user does not exist in the database yet.
   *
   * `context` (Better Auth's `GenericEndpointContext | null`) is unused:
   * `createPersonalOrganizationForUser` calls Better Auth's own
   * `createOrganization` endpoint through its "system action" path
   * (`userId` in the body, no headers — see that function's doc comment),
   * which does not need the triggering request's context at all.
   */
  databaseHooks: {
    user: {
      create: {
        after: async (user): Promise<void> => {
          await createPersonalOrganizationForUser(user.id, user.email)
        },
      },
    },
    // Better Auth creates the session after `user.create.after` above has
    // already made the personal Organization, but leaves the new session's
    // `activeOrganizationId` null — so a user who just signed up would land
    // on the workspace picker rather than in the workspace created for them
    // (docs/decisions/06 #14). Only a sole membership is resolved; see
    // `resolveInitialActiveOrganizationId` for why a multi-workspace user
    // deliberately keeps the null.
    session: {
      create: {
        before: async (session) => {
          if (session.activeOrganizationId) {
            return { data: session }
          }
          const activeOrganizationId = await resolveInitialActiveOrganizationId(session.userId)
          if (activeOrganizationId === undefined) {
            return { data: session }
          }
          return { data: { ...session, activeOrganizationId } }
        },
      },
    },
  },

  // Google and GitHub sign-in (docs/decisions/07). A provider missing from
  // this object is a provider Better Auth's OAuth routes reject outright —
  // the UI (src/app/(auth)) independently hides its button by reading the
  // same paired `env()` fields (via `configuredSocialProviders`), so the
  // two can never disagree about which providers are live.
  socialProviders: {
    ...(googleCredentials ? { google: googleCredentials } : {}),
    ...(githubCredentials ? { github: githubCredentials } : {}),
  },

  /**
   * Account linking — the security decision in docs/decisions/07. A social
   * identity is linked onto an existing user on a matching email ONLY when
   * the provider itself asserts that address is verified: Google's
   * `email_verified` claim, or GitHub's primary-email `verified` flag (both
   * mapped to `userInfo.emailVerified` by Better Auth's provider adapters).
   * Automatic linking on an unverified email is an account-takeover vector —
   * anyone able to register at the provider claiming `ana@acme.com` would
   * inherit Ana's workspace, her datasets, and her role in them.
   *
   * That is one of two gates, both required (Better Auth's
   * `requireLocalEmailVerified`, left at its default `true`, is the other):
   * the LOCAL user row must also already have `emailVerified: true` before
   * an implicit link is allowed — this blocks the mirror-image attack,
   * where someone pre-registers an unverified password account at Ana's
   * email hoping her later "Continue with Google" click links her real
   * identity into their attacker-owned row. Consequence: `emailAndPassword`
   * below has no `requireEmailVerification`/verification-mail flow, so
   * every password sign-up's `emailVerified` stays `false` — no existing
   * password user can link a social identity until decisions/07's "Email
   * verification" section (sending that mail) is implemented. Until then a
   * real Ana clicking "Continue with Google" lands on the sign-in error
   * banner and must use her password instead, which is safe, just not yet
   * the smooth path the decision describes.
   *
   * DO NOT add "google"/"github" to `trustedProviders`. Better Auth links
   * implicitly when EITHER the provider is in `trustedProviders` OR the
   * provider's own assertion says the email is verified — naming a provider
   * here would skip the emailVerified check entirely and link on an
   * unverified claim, exactly the takeover this comment exists to prevent.
   * Leave it empty.
   *
   * DO NOT set `allowDifferentEmails: true`. Linking only ever applies to a
   * matching email — never a different address the user merely asserts is
   * theirs.
   *
   * A social sign-in whose email matches no existing user isn't a link at
   * all: Better Auth creates a new user, exactly as it would for a fresh
   * email/password sign-up — both paths go through `databaseHooks.user.create.after`
   * below, so both get the same personal Organization, the same way
   * (docs/decisions/06 #14).
   */
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: [],
      allowDifferentEmails: false,
    },
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
        // `analytical_tables.dataset_version_id` is ON DELETE RESTRICT, so
        // Postgres already refuses to delete a workspace holding loaded data
        // — but it refuses with a bare foreign-key violation. Refuse here
        // first, so the user is told why instead of seeing a database error.
        // Dropping the data deliberately (an explicit "delete every dataset,
        // then the workspace" flow) does not exist yet; until it does, this
        // is the fail-closed answer, and it is the right one: a workspace
        // delete must never silently orphan a customer's rows.
        beforeDeleteOrganization: async ({ organization: target }) => {
          const registeredTables = await countRegisteredTables(target.id)
          if (registeredTables > 0) {
            throw new APIError("BAD_REQUEST", {
              message:
                `This workspace still holds ${registeredTables} loaded ` +
                `${registeredTables === 1 ? "dataset" : "datasets"}. Delete them first, ` +
                `then delete the workspace.`,
            })
          }
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
