import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"

import { db } from "@/db/client"
import { organizationMembers, organizations } from "@/db/schema"
import { auth } from "@/modules/auth"
import { AppError } from "@/shared/errors"

// Module-private: only this file can produce a value that satisfies the
// `[REQUEST_CONTEXT_BRAND]` key below, because only this file has the
// symbol. Not exported, so no other module — production or test — can
// construct a RequestContext by writing the matching object literal
// itself; the test-only path in ./testing.ts instead uses a type
// assertion, isolated to that one file. See the interface doc below.
const REQUEST_CONTEXT_BRAND = Symbol("RequestContext")

/**
 * A verified tenant scope: a session's user, re-confirmed as a member of
 * `organizationId`, plus that organization's role for the user and its
 * timezone.
 *
 * There is deliberately no exported function anywhere in this module that
 * builds one from a caller-supplied `organizationId` — `createRequestContext`
 * below is the only production constructor, and it takes no arguments at
 * all: its only input is the ambient request's headers
 * (src/shared/CLAUDE.md, AGENTS.md: "tenant context comes from a
 * server-created request context, never an argument a caller/model
 * supplies"). The branded key also makes this a nominal type: a plain
 * object literal with the same fields, written outside this file, is not a
 * `RequestContext` — TypeScript has no way to name the private symbol
 * below, so it cannot satisfy this shape by accident.
 */
export interface RequestContext {
  readonly [REQUEST_CONTEXT_BRAND]: true
  readonly userId: string
  readonly organizationId: string
  readonly role: string
  readonly organizationTimezone: string
}

/**
 * The only way to obtain a `RequestContext` in production code. Follows the
 * Security Baseline order (docs/reference/Datalize-improved-architecture.md):
 * authenticate, then resolve and re-verify the active organization before
 * anything downstream can use it.
 *
 * - No session at all -> UNAUTHENTICATED.
 * - Session present but no active organization selected, or one the caller
 *   is not (or no longer) a member of -> FORBIDDEN. `sessions.activeOrganizationId`
 *   is client-influenced (Better Auth lets a client call
 *   `setActiveOrganization`), so it is never trusted on its own — membership
 *   is re-verified against `organization_members` on every call, and a
 *   stale/revoked membership is refused rather than silently switched to
 *   some other organization (docs/decisions/06 #14).
 */
export async function createRequestContext(): Promise<RequestContext> {
  const requestHeaders = await headers()
  const authSession = await auth.api.getSession({ headers: requestHeaders })

  if (!authSession) {
    throw new AppError("UNAUTHENTICATED", "You must be signed in.")
  }

  const organizationId = authSession.session.activeOrganizationId
  if (organizationId === null || organizationId === undefined) {
    throw new AppError("FORBIDDEN", "No active organization is selected for this session.")
  }

  const [membership] = await db
    .select({
      role: organizationMembers.role,
      organizationTimezone: organizations.timezone,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, authSession.user.id),
        eq(organizationMembers.organizationId, organizationId),
      ),
    )
    .limit(1)

  if (!membership) {
    throw new AppError("FORBIDDEN", "You are not a member of this organization.")
  }

  return {
    userId: authSession.user.id,
    organizationId,
    role: membership.role,
    organizationTimezone: membership.organizationTimezone,
    [REQUEST_CONTEXT_BRAND]: true,
  }
}
