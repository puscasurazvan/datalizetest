/**
 * The seam between a job payload (`{ importId }` only — jobs/CLAUDE.md
 * "Payloads and re-checks") and a verified `RequestContext`.
 *
 * Every caller of import task logic depends on the narrow `CreateContextForImport`
 * function type below instead of on a concrete constructor directly, so:
 * - production wiring (`./register-production-tasks.ts`, used by both the
 *   Next.js server process and `trigger/**`) supplies `createContextForImportJob`;
 * - integration tests supply `createTestRequestContext`
 *   (src/shared/context/testing.ts) directly — the one path that IS a
 *   real, if test-only, `RequestContext` constructor today.
 */
import { createRequestContextForJob } from "@/shared/context/request-context"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

import { findImportOwnerById } from "../repository/import-repository"

/**
 * Resolves the verified `RequestContext` a job should run under, given only
 * the import id its payload carries. Implementations look up the import
 * row (unscoped — see `findImportOwnerById` in
 * `../repository/import-repository.ts` for why that lookup is the one
 * legitimate context-free query in this module) to learn which
 * organization and user it belongs to, then re-verify membership exactly
 * as `createRequestContext` does for a real request.
 */
export type CreateContextForImport = (importId: string) => Promise<RequestContext>

/**
 * The one production implementation of `CreateContextForImport`, and the
 * one caller `createRequestContextForJob`
 * (src/shared/context/request-context.ts) allows — enforced by
 * `.oxlintrc.json`'s `no-restricted-imports`, not just this doc comment.
 */
export const createContextForImportJob: CreateContextForImport = async (importId) => {
  const owner = await findImportOwnerById(importId)
  if (owner === undefined) {
    throw new AppError("NOT_FOUND", "Import not found.")
  }

  return createRequestContextForJob({
    userId: owner.createdByUserId,
    organizationId: owner.organizationId,
  })
}
