import { eq, sql } from "drizzle-orm"

import { db } from "@/db/client"
import { organizations } from "@/db/schema"
import { auth } from "@/modules/auth"
import { ROLES, type PolicyContext } from "@/modules/auth/policy"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

import { CANONICAL_IANA_TIMEZONES } from "./canonical-timezones"
import { slugify } from "./slug"

export { slugify } from "./slug"

/**
 * The safe shape an Organization is ever returned to the UI as — never a
 * Drizzle/Better Auth row. Named `OrganizationSummary`, not `Workspace*`:
 * "workspace" is UI copy only, code and types say Organization
 * (CONTEXT.md, this module's CLAUDE.md — "there is no `Workspace` type").
 */
export interface OrganizationSummary {
  readonly id: string
  readonly name: string
}

/**
 * Narrows `RequestContext.role` (`string` — it comes back from a `text`
 * column with no database-level enum) to the closed `Role` union
 * `assertCan`/`can` require. An unrecognised value fails closed as
 * `FORBIDDEN` rather than being cast away.
 */
export function toPolicyContext(context: RequestContext): PolicyContext {
  const role = ROLES.find((candidate) => candidate === context.role)
  if (role === undefined) {
    throw new AppError("FORBIDDEN", "Your membership role is not recognized.")
  }
  return { organizationId: context.organizationId, role }
}

/**
 * Creates an Organization for the caller's session and makes it their
 * active organization. Delegates entirely to Better Auth's `organization`
 * plugin (docs/README.md decision #3: Better Auth owns organizations and
 * membership; Datalize adds no second membership system). The plugin sets
 * the creator's role to `owner` and, unless told otherwise, switches the
 * session's active organization to the new one in the same call — see
 * `createOrganization` in Better Auth's `organization` route.
 */
export async function createOrganizationForUser(
  name: string,
  requestHeaders: Headers,
): Promise<OrganizationSummary> {
  const organization = await auth.api.createOrganization({
    body: { name, slug: slugify(name) },
    headers: requestHeaders,
  })

  if (!organization) {
    throw new AppError("VALIDATION", "Could not create the workspace.")
  }

  return { id: organization.id, name: organization.name }
}

/**
 * The canonical names in `./canonical-timezones`, narrowed to the ones this
 * Postgres server's own `pg_timezone_names` also recognises — so a name
 * that passes this never fails at query-compile time when the compiler
 * applies `AT TIME ZONE '<name>'` (docs/decisions/03, #04). Neither list
 * alone is the right allowlist: `pg_timezone_names` is too broad (this
 * module's CLAUDE.md — it also lists fixed-offset abbreviations and
 * legacy aliases), and the canonical list alone could name a zone this
 * server's tzdata build doesn't ship.
 */
async function knownTimezones(): Promise<Set<string>> {
  const result = await db.execute<{ name: string }>(sql`select name from pg_timezone_names`)
  const postgresTimezones = new Set(result.rows.map((row) => row.name))
  return new Set([...CANONICAL_IANA_TIMEZONES].filter((name) => postgresTimezones.has(name)))
}

/** Every valid timezone name, for the timezone picker. */
export async function listAvailableTimezones(): Promise<string[]> {
  return [...(await knownTimezones())].toSorted()
}

/**
 * Throws unless `timezone` is in the allowlist above. This is the check
 * decisions/03 and decisions/04 require in place of string-interpolating a
 * client-influenced value into `AT TIME ZONE` — never call `db.update` on
 * `organizations.timezone` without going through this first.
 */
async function assertKnownTimezone(timezone: string): Promise<void> {
  const valid = await knownTimezones()
  if (!valid.has(timezone)) {
    throw new AppError("VALIDATION", `"${timezone}" is not a recognized timezone.`)
  }
}

/**
 * Updates the Organization's timezone directly on `organizations` via
 * Drizzle, not through Better Auth's `/organization/update` endpoint.
 * `auth.ts` deliberately declares the `timezone` additional field with
 * `input: false`, which closes Better Auth's own client-facing update
 * route to it (Better Auth's built-in roles have no `editor`/`viewer`
 * concept, so that route cannot be trusted to apply this app's
 * `organization:update` permission check). The caller must already have
 * run `assertCan(policyContext, "organization:update")` before this is
 * called — this function does not re-check authorization, only tenancy
 * (the `organizationId` it is given) and the timezone value itself.
 */
export async function updateOrganizationTimezone(
  organizationId: string,
  timezone: string,
): Promise<void> {
  await assertKnownTimezone(timezone)

  await db.update(organizations).set({ timezone }).where(eq(organizations.id, organizationId))
}
