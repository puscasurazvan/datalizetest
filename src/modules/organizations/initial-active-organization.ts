/**
 * Which Organization a brand-new session starts in.
 *
 * `createPersonalOrganizationForUser` (./personal-organization.ts) gives every
 * new user an Organization, but Better Auth creates the session *after* that
 * hook and leaves `activeOrganizationId` null — so without this, a user who
 * just signed up lands on the workspace picker instead of inside the workspace
 * that was created for them one moment earlier. docs/decisions/06 #14 asks for
 * the latter.
 *
 * The rule is deliberately narrow: resolve an active Organization only when
 * the user belongs to exactly one. A user with several has no obviously
 * correct default — guessing one would silently decide, on their behalf,
 * which tenant's data they are looking at — so they keep the null and get
 * the picker (`SelectWorkspacePrompt`).
 *
 * This chooses a *starting* scope; it grants nothing. Every read and write
 * still goes through `createRequestContext`, which re-verifies the membership
 * row on each request and ignores whatever the session claims
 * (src/shared/context/request-context.ts).
 */
import { eq } from "drizzle-orm"

import { db } from "@/db/client"
import { organizationMembers } from "@/db/schema"

export async function resolveInitialActiveOrganizationId(
  userId: string,
): Promise<string | undefined> {
  const memberships = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .limit(2)

  if (memberships.length !== 1) {
    return undefined
  }
  return memberships[0]?.organizationId
}
