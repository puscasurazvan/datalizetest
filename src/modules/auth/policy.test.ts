import { describe, expect, it } from "vitest"

import { AppError } from "@/shared/errors"

import {
  type Permission,
  PERMISSIONS,
  type PolicyContext,
  type Role,
  ROLES,
  assertCan,
  can,
} from "./policy"

const ORG_A = "org_a"
const ORG_B = "org_b"

/**
 * Transcribed BY HAND from
 * docs/decisions/06-slice-1-implementation-defaults.md #13 — independently
 * of policy.ts, so this table catches drift in the implementation rather
 * than restating it. The `Record<Role, Record<Permission, boolean>>`
 * annotation forces every cell to be filled: adding a Role or Permission to
 * policy.ts without updating this table fails typecheck here.
 */
const EXPECTED: Record<Role, Record<Permission, boolean>> = {
  owner: {
    "dataset:read": true,
    "query:execute": true,
    "dataset:create": true,
    "dataset:manage": true,
    "query:save": true,
    "organization:update": true,
    "member:manage": true,
    "organization:delete": true,
  },
  admin: {
    "dataset:read": true,
    "query:execute": true,
    "dataset:create": true,
    "dataset:manage": true,
    "query:save": true,
    "organization:update": true,
    "member:manage": true,
    "organization:delete": false,
  },
  editor: {
    "dataset:read": true,
    "query:execute": true,
    "dataset:create": true,
    "dataset:manage": true,
    "query:save": true,
    "organization:update": false,
    "member:manage": false,
    "organization:delete": false,
  },
  viewer: {
    "dataset:read": true,
    "query:execute": true,
    "dataset:create": false,
    "dataset:manage": false,
    "query:save": false,
    "organization:update": false,
    "member:manage": false,
    "organization:delete": false,
  },
}

/** Every (role, permission) cell in the matrix, with its expected verdict. */
const cells = ROLES.flatMap((role) =>
  PERMISSIONS.map((permission) => ({
    role,
    permission,
    expected: EXPECTED[role][permission],
  })),
)

function contextFor(role: Role): PolicyContext {
  return { organizationId: ORG_A, role }
}

/** Runs `fn` and returns the thrown value, or `undefined` if it didn't throw. */
function captureThrown(fn: () => void): unknown {
  try {
    fn()
    return undefined
  } catch (error) {
    return error
  }
}

describe("can", () => {
  it.each(cells)("$role x $permission -> allowed: $expected", ({ role, permission, expected }) => {
    expect(can(contextFor(role), permission)).toBe(expected)
  })
})

const allowedCells = cells.filter((cell) => cell.expected)
const deniedCells = cells.filter((cell) => !cell.expected)

describe("assertCan", () => {
  it.each(allowedCells)("$role x $permission -> does not throw", ({ role, permission }) => {
    expect(captureThrown(() => assertCan(contextFor(role), permission))).toBeUndefined()
  })

  it.each(deniedCells)("$role x $permission -> throws FORBIDDEN", ({ role, permission }) => {
    const thrown = captureThrown(() => assertCan(contextFor(role), permission))

    expect(thrown).toBeInstanceOf(AppError)
    expect(thrown).toMatchObject({ code: "FORBIDDEN" })
  })
})

describe("assertCan with a resource", () => {
  it("allows a same-tenant resource when the role holds the permission", () => {
    const resource = { organizationId: ORG_A }

    expect(
      captureThrown(() => assertCan(contextFor("editor"), "dataset:manage", resource)),
    ).toBeUndefined()
  })

  it("throws FORBIDDEN for a same-tenant resource when the role lacks the permission", () => {
    const resource = { organizationId: ORG_A }

    const thrown = captureThrown(() => assertCan(contextFor("viewer"), "dataset:manage", resource))

    expect(thrown).toBeInstanceOf(AppError)
    expect(thrown).toMatchObject({ code: "FORBIDDEN" })
  })

  it("throws NOT_FOUND for a cross-tenant resource even when the role holds the permission", () => {
    const resource = { organizationId: ORG_B }

    const thrown = captureThrown(() => assertCan(contextFor("owner"), "dataset:manage", resource))

    expect(thrown).toBeInstanceOf(AppError)
    expect(thrown).toMatchObject({ code: "NOT_FOUND" })
  })

  it("throws NOT_FOUND, not FORBIDDEN, for a cross-tenant resource when the role also lacks the permission", () => {
    // Proves the check order: tenant ownership is decided before
    // permission, so a cross-tenant resource never leaks whether the
    // caller's role would have been allowed to see it.
    const resource = { organizationId: ORG_B }

    const thrown = captureThrown(() => assertCan(contextFor("viewer"), "dataset:manage", resource))

    expect(thrown).toBeInstanceOf(AppError)
    expect(thrown).toMatchObject({ code: "NOT_FOUND" })
  })
})
