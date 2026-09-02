# src/modules/organizations

## Tenant boundary (CONTEXT.md, docs/decisions/01 #3)

- Organization is the tenant boundary. Every dashboard, dataset, saved query,
  import, and member belongs to exactly one Organization.
- Code, schema, and types say **Organization** (`organizations`,
  `organization_members`, `organization_id`). UI copy says **workspace**
  ("Create workspace", "Switch workspace", "Workspace settings", "Invite to
  workspace"). There is no `Workspace` type — do not introduce one.

## Timezone ownership (docs/decisions/03)

- Organization owns one IANA timezone (`organizations.timezone`), default
  `UTC`, applied to all date grouping in queries.
- Validated against the canonical IANA allowlist on write — membership in
  `pg_timezone_names` alone is NOT sufficient, since that view also lists
  fixed-offset abbreviations (`EST`, `PST`) and legacy aliases
  (`Asia/Calcutta`) that are ambiguous and must be rejected.
- Re-checked at query compile time. A timezone not in the allowlist FAILS
  the query — it never falls back to a default.
- Changing it affects only future queries; historical `query_executions`
  rows keep the timezone they recorded at execution time.

## Schema ownership

`organizations.timezone` has three separate owners, for three separate jobs, and all three must
describe the same field or the drift is invisible until Better Auth reads or writes a column
drizzle-kit never created:

- **Better Auth declares it.** `organization({ schema: { organization: { additionalFields: {
timezone: {...} } } } })` in `src/modules/auth/auth.ts` is what makes Better Auth's own
  create/update-organization API and its generated types know the field exists, and what enforces
  `required: true` / `defaultValue: "UTC"` at the application layer.
- **Datalize's Drizzle schema creates it.** Better Auth's Drizzle adapter never issues DDL — against
  a Drizzle adapter, Better Auth only reads and writes rows through the Drizzle table object it is
  handed (`drizzleAdapter(db, { schema: { organizations: authSchema.organizations, ... } })`); it
  does not create tables or columns for any adapter, ever. The column exists because
  `src/db/schema/auth.ts` declares `timezone: text("timezone").notNull().default("UTC")` on the
  `organizations` `pgTable`. That declaration, not Better Auth's `additionalFields` entry, is what
  actually produces a column.
- **drizzle-kit applies it to a database.** It diffs `src/db/schema/index.ts` (which re-exports
  `./auth`) against the target database and generates the migration that creates `organizations` —
  `src/db/migrations/0000_fast_the_fallen.sql` contains `CREATE TABLE "organizations" (... "timezone"
text DEFAULT 'UTC' NOT NULL ...)`. Running that migration is the only thing that puts the column
  in a real database; nothing Better-Auth-specific runs separately.

This must be provable from an empty database in CI: `drizzle-kit migrate` alone against a fresh
database, with no separate Better-Auth setup step, must produce an `organizations` table whose
`timezone` column is `NOT NULL DEFAULT 'UTC'`. If it doesn't, the Drizzle table and the
`additionalFields` entry have drifted apart, and the two files above are where to reconcile them —
never by having Better Auth create the column at runtime.
