/**
 * Drizzle table definitions for the tables Better Auth reads and writes
 * (src/modules/auth/auth.ts). Better Auth owns these tables' shape; this
 * file exists so drizzle-kit can diff/migrate them and so the rest of the
 * app can query them through `db` like any other application table.
 *
 * Field lists and requiredness were taken from Better Auth 1.7.2's runtime
 * `getAuthTables(options)` output for the exact plugin configuration used in
 * auth.ts (email/password + organization, with the `organization_member`
 * modelName override) — not guessed from the package's TypeScript types,
 * which describe a more general shape than any one configuration produces.
 *
 * Table naming: auth.ts configures `usePlural: true` on the Drizzle adapter.
 * Better Auth's adapter factory pluralizes the *default* model name by
 * appending "s" — including when a plugin has already overridden modelName,
 * which double-pluralizes it (verified: an explicit `modelName: "invitation"`
 * override combined with `usePlural: true` resolves to table name
 * "invitations", but a redundant override of `modelName: "invitations"`
 * resolves to "invitationss"). So `organizations` and `invitations` below
 * are reached by *not* overriding those two models' modelName and letting
 * usePlural do the single pluralization; `organization_members` is reached
 * by overriding member's modelName to the singular "organization_member" so
 * usePlural's appended "s" lands on the right word boundary.
 */
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
)

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    // Better Auth `additionalFields.timezone` (auth.ts). Better Auth owns this
    // table; this column cannot come from a Datalize-owned migration, but the
    // NOT NULL DEFAULT is still enforced at the database level here.
    timezone: text("timezone").notNull().default("UTC"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("organizations_slug_idx").on(table.slug)],
)

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Client-influenced (Better Auth lets a client call setActiveOrganization).
    // Never trust this for authorization — re-verify membership on every
    // request (src/modules/auth/CLAUDE.md). Set null, not FK-enforced by
    // Better Auth itself, but nulled here on org deletion for integrity.
    activeOrganizationId: text("active_organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("sessions_token_idx").on(table.token),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_active_organization_id_idx").on(table.activeOrganizationId),
  ],
)

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_issuer_account_id_idx").on(table.issuer, table.accountId),
    index("accounts_user_id_idx").on(table.userId),
  ],
)

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
)

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // docs/decisions/06 #19: must default to "viewer", not Better Auth's
    // built-in "member" — "member" is not a value `Role` (src/modules/auth/policy.ts)
    // can represent, and `ROLE_PERMISSIONS["member"]` is `undefined`. `viewer`
    // is the least-privileged role, the correct fail-closed default for a
    // row inserted with no explicit role (a future backfill/seed/direct SQL
    // fix, or a Better Auth route that stops passing one).
    role: text("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Better Auth's membership writes (crud-members.mjs) are check-then-insert
    // with no transaction: a double-clicked or double-tabbed accept-invitation
    // can otherwise create two rows for the same (organization_id, user_id).
    // This is the database-level backstop docs/decisions/06 #19 requires.
    uniqueIndex("organization_members_organization_user_idx").on(
      table.organizationId,
      table.userId,
    ),
    index("organization_members_organization_id_idx").on(table.organizationId),
    index("organization_members_user_id_idx").on(table.userId),
  ],
)

export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitations_organization_id_idx").on(table.organizationId),
    index("invitations_email_idx").on(table.email),
  ],
)
