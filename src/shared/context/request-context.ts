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
 * Two production constructors build this, both below: `createRequestContext`
 * (no arguments — the ambient request's headers are its only input) for
 * everything that runs inside a real request, and
 * `createRequestContextForJob` (takes `{ userId, organizationId }`) for the
 * one case that structurally cannot have headers at all — a Trigger.dev
 * worker run, and `InlineDispatcher`'s in-process equivalent
 * (src/modules/jobs/CLAUDE.md). See that function's own doc for why taking
 * an explicit `organizationId` there does not reopen
 * src/shared/CLAUDE.md's "must never accept an organizationId argument"
 * rule the way a general-purpose scope-selection function would. The
 * branded key makes this a nominal type either way: a plain object literal
 * with the same fields, written outside this file, is not a
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
 * Re-verifies `userId` is still a member of `organizationId` and returns
 * that membership's role and the organization's timezone, or `undefined`.
 * Shared by both constructors below so their membership check can never
 * drift apart into two different queries.
 */
async function loadMembership(
  userId: string,
  organizationId: string,
): Promise<{ role: string; organizationTimezone: string } | undefined> {
  const [membership] = await db
    .select({
      role: organizationMembers.role,
      organizationTimezone: organizations.timezone,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId),
      ),
    )
    .limit(1)

  return membership
}

/**
 * The primary way to obtain a `RequestContext` in production code — every
 * Server Action, Route Handler, and Server Component uses this one. Follows
 * the Security Baseline order (docs/reference/Datalize-improved-architecture.md):
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

  const membership = await loadMembership(authSession.user.id, organizationId)
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

/**
 * The one alternate production constructor, for a job worker
 * (src/modules/imports/internal/job-context.ts's `createContextForImportJob`
 * is its only caller — enforced by `.oxlintrc.json`'s `no-restricted-imports`,
 * not just convention). A Trigger.dev run (and `InlineDispatcher`'s
 * in-process equivalent) is not a request and has no `headers()` to read,
 * so `createRequestContext` above cannot be called from one at all —
 * without this, the import pipeline cannot run in any environment
 * (src/modules/imports/CLAUDE.md's two-phase pipeline has no other way to
 * get a `RequestContext` for `import.profile`/`import.load` to run under).
 *
 * This does not reopen src/shared/CLAUDE.md's "must never accept an
 * organizationId argument" the way a general-purpose scope-selection
 * function would: `owner.organizationId` is never a value this function's
 * caller chooses. It is read off the `imports` row itself
 * (`findImportOwnerById` — src/modules/imports/repository/import-repository.ts's
 * own doc calls this "the one legitimate context-free query" for exactly
 * this reason), a row a real, fully-authorized request already wrote under
 * `scopedWhere` (`startImport`, going through `assertCan`). This function's
 * only job, like `createRequestContext`'s, is to re-verify — at the moment
 * the job actually runs, not at enqueue time — that the user is still a
 * member of that organization; it can widen no caller's access, only
 * confirm or refuse the access a prior request already established.
 *
 * Runtime consequence worth knowing: membership revoked between enqueue and
 * run makes this throw FORBIDDEN before `profileImport`/`loadImport` ever
 * starts — the job registry's wrapper (src/modules/jobs/registry.ts) has no
 * catch of its own, so that throw propagates out of `enqueue`, and the
 * import is left stranded at whatever status it was already in (QUEUED, or
 * RUNNING mid-retry) rather than being marked FAILED. This is a known gap,
 * not a silent swallow — nothing here hides it.
 */
export async function createRequestContextForJob(owner: {
  userId: string
  organizationId: string
}): Promise<RequestContext> {
  const membership = await loadMembership(owner.userId, owner.organizationId)
  if (!membership) {
    throw new AppError("FORBIDDEN", "You are not a member of this organization.")
  }

  return {
    userId: owner.userId,
    organizationId: owner.organizationId,
    role: membership.role,
    organizationTimezone: membership.organizationTimezone,
    [REQUEST_CONTEXT_BRAND]: true,
  }
}
