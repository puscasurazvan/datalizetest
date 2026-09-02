/**
 * Authorization policy. `assertCan` is the sole authorization gate
 * (src/modules/auth/CLAUDE.md) — feature code must never branch on a role
 * string (`if (role === "admin")`); it calls `assertCan`/`can` with a
 * `Permission` instead.
 */
import { AppError } from "@/shared/errors"

/** Roles a member of an Organization can hold (docs/decisions/06 #13). */
export const ROLES = ["owner", "admin", "editor", "viewer"] as const
export type Role = (typeof ROLES)[number]

/**
 * The closed set of permissions feature code may check. Adding a
 * permission here is the only way to introduce a new one — nothing may
 * check an ad hoc string.
 */
export const PERMISSIONS = [
  "dataset:read",
  "query:execute",
  "dataset:create",
  "dataset:manage",
  "query:save",
  "organization:update",
  "member:manage",
  "organization:delete",
] as const
export type Permission = (typeof PERMISSIONS)[number]

/**
 * What a caller needs to evaluate a permission: the Organization the
 * request is scoped to, and the caller's role within it. Produced by the
 * server-created request context (src/shared/CLAUDE.md) — this module
 * never derives or trusts a role/organizationId from anywhere else, and in
 * particular never reads a client-supplied `activeOrganizationId` without
 * that context having already re-verified membership.
 */
export interface PolicyContext {
  readonly organizationId: string
  readonly role: Role
}

/** Any tenant-owned row a resource-level check can be asserted against. */
export interface TenantResource {
  readonly organizationId: string
}

/**
 * Role -> permission matrix, transcribed exactly from
 * docs/decisions/06-slice-1-implementation-defaults.md #13. Change the
 * membership of these sets to change the matrix; do not change the shape
 * around them.
 */
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set([
    "dataset:read",
    "query:execute",
    "dataset:create",
    "dataset:manage",
    "query:save",
    "organization:update",
    "member:manage",
  ]),
  editor: new Set([
    "dataset:read",
    "query:execute",
    "dataset:create",
    "dataset:manage",
    "query:save",
  ]),
  viewer: new Set(["dataset:read", "query:execute"]),
}

/**
 * Boolean check for UI affordances (e.g. hiding a "Delete organization"
 * button). Never throws, and never checks a resource — a resource-level
 * decision belongs to `assertCan`, which can distinguish "not allowed"
 * from "not yours to see".
 */
export function can(context: PolicyContext, permission: Permission): boolean {
  return ROLE_PERMISSIONS[context.role].has(permission)
}

/**
 * Throws unless `context.role` holds `permission`. When `resource` is
 * given, tenant ownership is checked FIRST: a resource belonging to a
 * different Organization throws NOT_FOUND — never FORBIDDEN — regardless
 * of whether the caller's role would otherwise hold the permission. That
 * ordering is deliberate: a FORBIDDEN response confirms the resource
 * exists, so a cross-tenant resource must never produce one
 * (src/shared/CLAUDE.md "Error DTOs").
 */
export function assertCan(
  context: PolicyContext,
  permission: Permission,
  resource?: TenantResource,
): void {
  if (resource !== undefined && resource.organizationId !== context.organizationId) {
    throw notFound()
  }

  if (!can(context, permission)) {
    throw forbidden(permission)
  }
}

// The two throws below are isolated behind local helpers so that when
// src/shared/errors/index.ts lands, only this pair of call sites need to
// change to match its actual AppError constructor shape.

function forbidden(permission: Permission): AppError {
  return new AppError("FORBIDDEN", `Missing permission: ${permission}`)
}

function notFound(): AppError {
  return new AppError("NOT_FOUND", "Not found")
}
