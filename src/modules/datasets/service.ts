/**
 * Dataset reads for the route layer. Authorization happens here, once, so
 * a Server Component cannot forget it (src/app/CLAUDE.md's chain).
 */
import { PostgresAnalyticalStore } from "@/modules/analytical-store"
import type { AnalyticalRow } from "@/modules/analytical-store"
import { assertCan } from "@/modules/auth/policy"
import { toPolicyContext } from "@/modules/organizations"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

import { findDatasetSummary, listDatasets, listVersionColumns } from "./repository"
import type { DatasetColumnSummary, DatasetSummary } from "./repository"

/** A screenful. The store caps this independently at 200. */
export const PREVIEW_ROW_LIMIT = 50

export interface DatasetDetail {
  readonly dataset: DatasetSummary
  readonly columns: readonly DatasetColumnSummary[]
  readonly previewRows: readonly AnalyticalRow[]
  /** Set when the version exists but its rows could not be read. */
  readonly previewUnavailable: string | null
}

export async function listDatasetsForContext(
  context: RequestContext,
): Promise<readonly DatasetSummary[]> {
  assertCan(toPolicyContext(context), "dataset:read")
  return listDatasets(context)
}

export async function getDatasetDetail(
  context: RequestContext,
  datasetId: string,
): Promise<DatasetDetail> {
  assertCan(toPolicyContext(context), "dataset:read")

  const dataset = await findDatasetSummary(context, datasetId)
  if (dataset === undefined) {
    throw new AppError("NOT_FOUND", "Dataset not found.")
  }

  if (dataset.currentVersion === null) {
    return { dataset, columns: [], previewRows: [], previewUnavailable: null }
  }

  const columns = await listVersionColumns(context, dataset.currentVersion.id)

  // A version that exists but has no loaded rows yet — still importing, or
  // a load that failed — is an ordinary state, not an error worth failing
  // the whole page over. Report it and render the schema regardless.
  try {
    const preview = await new PostgresAnalyticalStore().readRows(
      context,
      dataset.currentVersion.id,
      PREVIEW_ROW_LIMIT,
    )
    return { dataset, columns, previewRows: preview.rows, previewUnavailable: null }
  } catch (error) {
    const reason =
      error instanceof AppError && error.code === "NOT_FOUND"
        ? "This version has no loaded rows yet."
        : "The rows for this version could not be read."
    return { dataset, columns, previewRows: [], previewUnavailable: reason }
  }
}
