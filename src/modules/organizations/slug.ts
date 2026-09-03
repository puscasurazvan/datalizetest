/**
 * Slug derivation, split out from `./service.ts` into its own
 * dependency-free module: `./personal-organization.ts` needs this without
 * pulling in `./service.ts`'s own `import { auth } from "@/modules/auth"`
 * — that import would make `auth.ts` (which imports
 * `./personal-organization.ts` to wire its signup hook) and this module's
 * dependency chain circular. This file imports nothing from
 * `@/modules/auth` or `@/modules/organizations` itself, and must stay
 * that way.
 */

/**
 * Derives a URL-safe slug from a workspace name and appends a short random
 * suffix so two workspaces named "Acme" never collide — the user is never
 * asked to pick a slug (CONTEXT.md: there is no user-facing "slug", only
 * "workspace name").
 */
export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8)
  return `${base === "" ? "workspace" : base}-${suffix}`
}
