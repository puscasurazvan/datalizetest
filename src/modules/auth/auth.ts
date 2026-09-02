import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"

import { db } from "@/db/client"
import * as authSchema from "@/db/schema/auth"
import { env } from "@/shared/env"

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
