/**
 * Writes to `datasets` / `dataset_versions` / `dataset_columns` made by the
 * import pipeline (docs/decisions/06 #1, #16; CONTEXT.md "Dataset
 * Version"). These three tables are the LOGICAL model that
 * `src/modules/datasets` (its own CLAUDE.md) will eventually own end to
 * end — nothing exists there yet, and `import.load` is the one caller that
 * needs to create a version and commit it, so those writes live here for
 * now. Keeping them in this one file, rather than spread across
 * `../internal/load.ts`, is what makes them liftable into
 * `src/modules/datasets` later without hunting for a second call site.
 *
 * Ordering (docs/decisions/06 #16 "no transaction across pools"): the
 * physical table (`AnalyticalStore`, a different pool entirely) is created
 * and loaded BEFORE `finalizeVersion` below ever runs — this file commits
 * metadata only, strictly last, on the application pool.
 */
import { desc, eq, isNull } from "drizzle-orm"

import { db } from "@/db/client"
import { datasetColumns, datasets, datasetVersions, imports } from "@/db/schema"
import type { RequestContext } from "@/shared/context/request-context"
import { scopedWhere, withOrganizationId } from "@/shared/repository"

import type { PreviousColumn, ResolvedColumn } from "../internal/column-continuity"

export async function findDatasetForContext(
  context: RequestContext,
  datasetId: string,
): Promise<{ id: string; currentVersionId: string | null } | undefined> {
  const [row] = await db
    .select({ id: datasets.id, currentVersionId: datasets.currentVersionId })
    .from(datasets)
    .where(scopedWhere(context, datasets, eq(datasets.id, datasetId)))
    .limit(1)
  return row
}

/**
 * The dataset's current version's columns, keyed for
 * `../internal/column-continuity.ts`'s name-based match. Empty for a
 * dataset with no current version yet — its first import.load run — which
 * `resolveColumnIds` already treats as "everything is a new column", the
 * correct behavior with no special-casing needed here.
 */
export async function findCurrentVersionColumns(
  context: RequestContext,
  datasetId: string,
): Promise<readonly PreviousColumn[]> {
  const dataset = await findDatasetForContext(context, datasetId)
  if (dataset?.currentVersionId === undefined || dataset.currentVersionId === null) {
    return []
  }

  return db
    .select({
      columnId: datasetColumns.columnId,
      name: datasetColumns.name,
      type: datasetColumns.type,
    })
    .from(datasetColumns)
    .where(
      scopedWhere(
        context,
        datasetColumns,
        eq(datasetColumns.datasetVersionId, dataset.currentVersionId),
      ),
    )
}

/**
 * Mints the `RUNNING` version this `import.load` attempt loads into, and
 * claims it onto the `imports` row in the same application-pool
 * transaction — docs/decisions/06 #16's retry convergence depends on this:
 * a crash between the two would otherwise let a retry mint a second,
 * orphaned version.
 *
 * Idempotent from the caller's side: `../internal/load.ts` calls this only
 * when the import row's own `dataset_version_id` is still unset, so a
 * retry that already claimed one never reaches this function at all.
 */
export async function createRunningVersion(
  context: RequestContext,
  input: { importId: string; datasetId: string; timezone: string },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ versionNumber: datasetVersions.versionNumber })
      .from(datasetVersions)
      .where(scopedWhere(context, datasetVersions, eq(datasetVersions.datasetId, input.datasetId)))
      .orderBy(desc(datasetVersions.versionNumber))
      .limit(1)
    const versionNumber = (latest?.versionNumber ?? 0) + 1

    const versionId = crypto.randomUUID()
    await tx.insert(datasetVersions).values(
      withOrganizationId(context, {
        id: versionId,
        datasetId: input.datasetId,
        versionNumber,
        status: "RUNNING",
        timezoneUsedForNaiveTimestamps: input.timezone,
      }),
    )

    // Claimed in the same transaction as the version insert above — a crash
    // between the two would otherwise let a retry mint a second, orphaned
    // version (docs/decisions/06 #16). `isNull` guards against a concurrent
    // attempt that already claimed a different version id; Slice 1 runs one
    // load per Organization at a time by product design (docs/decisions/06
    // #16), so this is a defensive guard, not the primary correctness
    // mechanism — `../internal/load.ts` only calls this function once it
    // has already confirmed the import row's `dataset_version_id` is unset.
    await tx
      .update(imports)
      .set({ datasetVersionId: versionId, status: "RUNNING", updatedAt: new Date() })
      .where(
        scopedWhere(
          context,
          imports,
          eq(imports.id, input.importId),
          isNull(imports.datasetVersionId),
        ),
      )

    return versionId
  })
}

export type FinalizeVersionInput = {
  readonly versionId: string
  readonly datasetId: string
  readonly columns: readonly ResolvedColumn[]
  readonly nullableByColumnId: ReadonlyMap<string, boolean>
  readonly rowCount: number
}

/**
 * The strictly-last metadata commit (docs/decisions/06 #16): runs only
 * after the physical table has been created and fully loaded on the
 * import pool. Retry-safe the same way `createVersionTable`
 * (analytical-store/postgres-store.ts) is — delete-then-reinsert
 * `dataset_columns` rather than assuming a first attempt never got this far.
 */
export async function finalizeVersion(
  context: RequestContext,
  input: FinalizeVersionInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(datasetColumns)
      .where(
        scopedWhere(context, datasetColumns, eq(datasetColumns.datasetVersionId, input.versionId)),
      )

    if (input.columns.length > 0) {
      await tx.insert(datasetColumns).values(
        input.columns.map((column) =>
          withOrganizationId(context, {
            id: crypto.randomUUID(),
            columnId: column.columnId,
            datasetVersionId: input.versionId,
            name: column.name,
            type: column.type,
            nullable: input.nullableByColumnId.get(column.columnId) ?? false,
            position: column.position,
          }),
        ),
      )
    }

    await tx
      .update(datasetVersions)
      .set({
        status: "COMPLETED",
        rowCount: input.rowCount,
        columnCount: input.columns.length,
        completedAt: new Date(),
      })
      .where(scopedWhere(context, datasetVersions, eq(datasetVersions.id, input.versionId)))

    await tx
      .update(datasets)
      .set({ currentVersionId: input.versionId, updatedAt: new Date() })
      .where(scopedWhere(context, datasets, eq(datasets.id, input.datasetId)))
  })
}

export async function markVersionFailed(context: RequestContext, versionId: string): Promise<void> {
  await db
    .update(datasetVersions)
    .set({ status: "FAILED" })
    .where(scopedWhere(context, datasetVersions, eq(datasetVersions.id, versionId)))
}
