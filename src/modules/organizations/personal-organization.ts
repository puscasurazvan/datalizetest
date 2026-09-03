/**
 * Creates a personal Organization for a newly created user, exactly once
 * (docs/decisions/06 #14, #19's "A signup creates a personal Organization
 * exactly once — this step is Datalize's own signup hook, not something
 * Better Auth does automatically"; docs/decisions/07). Called from
 * `src/modules/auth/auth.ts`'s `databaseHooks.user.create.after` hook,
 * which fires once per `users` row actually inserted — not once per
 * signup HTTP request — so a retried or duplicated signup call cannot
 * reach this twice for the same user through that path alone. The
 * membership check below is a second, independent guard against the same
 * outcome (a future direct caller, or a Better Auth version that invokes
 * the hook more than once for one row), keyed on "does this user already
 * have any Organization", not on anything from the signup request itself.
 *
 * `slugify` comes from `./slug`, not `./service` — `./service.ts` itself
 * imports `@/modules/auth`, and `auth.ts` imports this module to wire the
 * signup hook, so importing `./service.ts` from here would reopen the
 * exact cycle the dynamic import below exists to avoid. See `./slug.ts`'s
 * own doc comment.
 *
 * `auth` is imported dynamically, inside `createPersonalOrganizationForUser`,
 * rather than with a top-level `import` — `auth.ts` imports this module
 * to wire the hook, so a top-level `import { auth } from "@/modules/auth"`
 * here would make the two modules' import graphs circular. The dynamic
 * import defers resolving `auth` until this function actually runs (after
 * `auth.ts` has finished constructing and exporting it), which is also
 * what keeps `auth.ts`'s own `export const auth = betterAuth({...})` from
 * referencing itself through this hook and tripping TS7022 ("used before
 * its own declaration is fully typed").
 */
import { eq } from "drizzle-orm"

import { db } from "@/db/client"
import { organizationMembers } from "@/db/schema"

import { slugify } from "./slug"

/**
 * `auth.api.createOrganization`'s own "system action" path
 * (`node_modules/better-auth/.../organization/routes/crud-org.mjs`:
 * `isSystemAction = !session && ctx.body.userId`): called with NO
 * `headers` at all (this hook runs before any session/cookie exists for a
 * brand-new user) and an explicit `userId` in the body, it looks the user
 * up server-side via `internalAdapter.findUserById` instead of requiring
 * a session, and skips the `allowUserToCreateOrganization` gate a normal
 * user-initiated create would need to pass. This is the one place in the
 * codebase that call shape is intentional — every other caller of
 * organization creation goes through `./service.ts`'s
 * `createOrganizationForUser`, which requires real request headers.
 */
export async function createPersonalOrganizationForUser(
  userId: string,
  userEmail: string,
): Promise<void> {
  const [existingMembership] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .limit(1)
  if (existingMembership) {
    return
  }

  const { auth } = await import("@/modules/auth")
  const name = personalOrganizationName(userEmail)
  await auth.api.createOrganization({
    body: { name, slug: slugify(name), userId },
  })
}

/**
 * "ana" from "ana@acme.com" — the email's local part, title-cased, is a
 * reasonable default a user can rename later (docs/decisions/06 #14 says
 * only "a personal one", not a specific name). Falls back to a fixed
 * string for a local part that produces nothing usable (an address like
 * "+1@acme.com").
 */
function personalOrganizationName(email: string): string {
  const localPart = email.split("@")[0] ?? ""
  const cleaned = localPart.replace(/[^a-zA-Z0-9]+/g, " ").trim()
  if (cleaned === "") {
    return "My workspace"
  }
  const titleCased = cleaned
    .split(" ")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ")
  return `${titleCased}'s workspace`
}
