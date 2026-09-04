/**
 * `imports` table access (docs/decisions/06 #1, #7, #17). Every function
 * except `findImportOwnerById` takes a `RequestContext` and is scoped
 * through `@/shared/repository`'s helpers — never a bare `db.select`
 * against `imports`.
 */
import { desc, eq } from "drizzle-orm"

import { db } from "@/db/client"
import { imports } from "@/db/schema"
import type { datasetVersionStatusEnum } from "@/db/schema"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"
import { scopedWhere } from "@/shared/repository"

export type ImportStatus = (typeof datasetVersionStatusEnum.enumValues)[number]
export type ImportRow = typeof imports.$inferSelect

/**
 * The one context-free query in this module. A job payload carries only
 * `{ importId }` (jobs/CLAUDE.md) — there is no organization to scope this
 * lookup by until the row itself names one. This is exactly, and only,
 * how a worker learns which organization/user to build its
 * `RequestContext` for (../internal/job-context.ts); nothing past this
 * point in any caller runs unscoped.
 */
export async function findImportOwnerById(
  importId: string,
): Promise<{ organizationId: string; createdByUserId: string } | undefined> {
  const [row] = await db
    .select({ organizationId: imports.organizationId, createdByUserId: imports.createdByUserId })
    .from(imports)
    .where(eq(imports.id, importId))
    .limit(1)
  return row
}

export async function findImportByIdempotencyKey(
  context: RequestContext,
  idempotencyKey: string,
): Promise<ImportRow | undefined> {
  const [row] = await db
    .select()
    .from(imports)
    .where(scopedWhere(context, imports, eq(imports.idempotencyKey, idempotencyKey)))
    .limit(1)
  return row
}

export async function getImportForContext(
  context: RequestContext,
  importId: string,
): Promise<ImportRow> {
  const [row] = await db
    .select()
    .from(imports)
    .where(scopedWhere(context, imports, eq(imports.id, importId)))
    .limit(1)

  if (!row) {
    throw new AppError("NOT_FOUND", "Import not found.")
  }
  return row
}

/**
 * The Dataset detail page's open-import banner (H4, H5, H7 — plan section
 * 4): the most recent import for `datasetId`, whatever its status —
 * deliberately NOT filtered to non-terminal statuses here. H5 depends on a
 * FAILED profile (one that never reached a confirm screen, so the user was
 * never navigated to `/imports/[id]` at all under `InlineDispatcher`)
 * being reachable through this same query; a status filter that excluded
 * FAILED would defeat exactly the case this exists for. `../internal/read.ts`'s
 * `findOpenImportForDataset` is what decides "open" from the result
 * (COMPLETED/CANCELLED -> not open, everything else -> open), not this
 * function — deciding it here would make "latest, no filter" and "latest
 * open" impossible to tell apart from one query.
 */
export async function findOpenImportByDatasetId(
  context: RequestContext,
  datasetId: string,
): Promise<ImportRow | undefined> {
  const [row] = await db
    .select()
    .from(imports)
    .where(scopedWhere(context, imports, eq(imports.datasetId, datasetId)))
    .orderBy(desc(imports.createdAt))
    .limit(1)
  return row
}

export async function markImportStatus(
  context: RequestContext,
  importId: string,
  status: ImportStatus,
): Promise<void> {
  await db
    .update(imports)
    .set({ status, updatedAt: new Date() })
    .where(scopedWhere(context, imports, eq(imports.id, importId)))
}

export async function recordJobRunId(
  context: RequestContext,
  importId: string,
  jobRunId: string,
): Promise<void> {
  await db
    .update(imports)
    .set({ jobRunId, updatedAt: new Date() })
    .where(scopedWhere(context, imports, eq(imports.id, importId)))
}

export async function recordProposedSchema(
  context: RequestContext,
  importId: string,
  proposedSchema: unknown,
  rowsRead: number,
): Promise<void> {
  await db
    .update(imports)
    .set({
      proposedSchema,
      rowsRead,
      status: "AWAITING_CONFIRMATION",
      updatedAt: new Date(),
    })
    .where(scopedWhere(context, imports, eq(imports.id, importId)))
}

/**
 * Confirmed defect (plan H1): a plain `id`-only WHERE let two concurrent
 * confirms of the same import both pass `confirmImport`'s pre-read status
 * check, both write here, and both dispatch `IMPORT_LOAD` — `InlineDispatcher`
 * doesn't dedupe on `idempotencyKey` in development, so both ran, and
 * `createRunningVersion`'s `isNull` guard only protects the `imports`
 * UPDATE, not the `dataset_versions` INSERT: two RUNNING versions, one
 * orphaned forever. Adding the status predicate here — the single write
 * site every caller goes through — makes this a compare-and-set: only the
 * update that still finds `AWAITING_CONFIRMATION` at the moment it runs
 * commits, and the returned row count tells the caller which one it was.
 * `confirmImport`'s existing pre-read check stays as the fast path; this
 * is what makes it correct under concurrency, not just informative.
 */
export async function recordConfirmedSchema(
  context: RequestContext,
  importId: string,
  confirmedSchema: unknown,
): Promise<number> {
  const updated = await db
    .update(imports)
    .set({ confirmedSchema, status: "QUEUED", updatedAt: new Date() })
    .where(
      scopedWhere(
        context,
        imports,
        eq(imports.id, importId),
        eq(imports.status, "AWAITING_CONFIRMATION"),
      ),
    )
    .returning({ id: imports.id })
  return updated.length
}

export async function markImportFailed(
  context: RequestContext,
  importId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(imports)
    .set({ status: "FAILED", errorCode, errorMessage, updatedAt: new Date() })
    .where(scopedWhere(context, imports, eq(imports.id, importId)))
}

export async function markImportCompleted(
  context: RequestContext,
  importId: string,
  counts: { rowsImported: number; rowsRejected: number },
): Promise<void> {
  await db
    .update(imports)
    .set({
      status: "COMPLETED",
      rowsImported: counts.rowsImported,
      rowsRejected: counts.rowsRejected,
      updatedAt: new Date(),
    })
    .where(scopedWhere(context, imports, eq(imports.id, importId)))
}
