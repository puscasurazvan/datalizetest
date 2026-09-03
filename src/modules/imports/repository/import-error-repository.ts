/**
 * `import_errors` writes (docs/decisions/06 #4-6). Never a `value`/`raw`
 * column here or anywhere in this module — `message` is a fixed template
 * naming the column and error code only, never the offending cell
 * (docs/decisions/06 #5, enforced at the type level: `NewImportError`
 * below has no field a cell value could be assigned to).
 */
import { eq } from "drizzle-orm"

import { db } from "@/db/client"
import { importErrors } from "@/db/schema"
import type { importRowErrorCodeEnum } from "@/db/schema"
import type { RequestContext } from "@/shared/context/request-context"
import { scopedWhere, withOrganizationId } from "@/shared/repository"

export type ImportErrorCode = (typeof importRowErrorCodeEnum.enumValues)[number]

export type NewImportError = {
  readonly rowNumber: number
  /** `null` for a row/file-level error (`FIELD_COUNT_MISMATCH`, `ENCODING`) with no single offending column. */
  readonly columnName: string | null
  readonly errorCode: ImportErrorCode
  readonly message: string
}

/**
 * Retry convergence (docs/decisions/06 #16): `createVersionTable` truncates
 * the physical table's rows on a retry, but nothing truncates
 * `import_errors` on its own — this is that step, called once at the start
 * of `import.load` before any row is re-processed, so a second attempt
 * never doubles up the first attempt's error rows.
 */
export async function deleteImportErrors(context: RequestContext, importId: string): Promise<void> {
  await db
    .delete(importErrors)
    .where(scopedWhere(context, importErrors, eq(importErrors.importId, importId)))
}

/**
 * Batched insert. `pg`'s bind-parameter limit (65535) is the real ceiling,
 * but a smaller, round batch size keeps any single `INSERT` statement's
 * text small and avoids that ceiling by a wide margin even for `import_errors`'
 * four bound columns per row (a 1,000,000-row dirty file could carry a
 * comparable number of error rows).
 *
 * `errors` is expected to already be batch-sized by the caller
 * (`../internal/error-recorder.ts` flushes at this same 1,000-row size), so
 * this almost always inserts in one pass — but still chunks defensively for
 * any caller that hands it more.
 */
const BATCH_SIZE = 1_000

export async function insertImportErrors(
  context: RequestContext,
  importId: string,
  errors: readonly NewImportError[],
): Promise<void> {
  const batches: (readonly NewImportError[])[] = []
  for (let start = 0; start < errors.length; start += BATCH_SIZE) {
    batches.push(errors.slice(start, start + BATCH_SIZE))
  }

  // Sequential, not `Promise.all`: this was a confirmed defect — a caller
  // that (as this one used to) handed over the whole load's error rows in
  // one call could fire up to 1,000 fully-built multi-row INSERT statements
  // at once, all queued against the application pool's 10 connections at
  // the same moment. `../internal/error-recorder.ts` now keeps `errors`
  // small in the ordinary case, but this function's own concurrency must
  // not depend on that — it stays bounded (one statement in flight at a
  // time) regardless of what a caller passes.
  for (const batch of batches) {
    // oxlint-disable-next-line no-await-in-loop -- deliberately sequential; see above.
    await db.insert(importErrors).values(
      batch.map((error) =>
        withOrganizationId(context, {
          id: crypto.randomUUID(),
          importId,
          rowNumber: error.rowNumber,
          columnName: error.columnName,
          errorCode: error.errorCode,
          message: error.message,
        }),
      ),
    )
  }
}
