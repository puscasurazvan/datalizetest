/**
 * Reads for the Dataset list and detail screens.
 *
 * Every query is organization-scoped through `scopedWhere`, and nothing
 * here returns a physical table or column name — a Dataset's columns are
 * named by Column ID and their human name only (docs/adr/0002). Rows for
 * the preview come from `AnalyticalStore.readRows`, not from a join
 * against the analytical schema, so this module never learns a physical
 * name to leak in the first place.
 */
import { desc, eq } from "drizzle-orm"

import { db } from "@/db/client"
import { datasetColumns, datasets, datasetVersions } from "@/db/schema"
import type { RequestContext } from "@/shared/context/request-context"
import { scopedWhere } from "@/shared/repository"

export interface DatasetVersionSummary {
  readonly id: string
  readonly versionNumber: number
  readonly status: string
  readonly rowCount: number | null
  readonly columnCount: number | null
  readonly timezoneUsedForNaiveTimestamps: string
  readonly createdAt: Date
}

export interface DatasetSummary {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly createdAt: Date
  readonly currentVersion: DatasetVersionSummary | null
}

export interface DatasetColumnSummary {
  readonly columnId: string
  readonly name: string
  readonly type: string
  readonly nullable: boolean
  readonly position: number
}

export async function listDatasets(context: RequestContext): Promise<readonly DatasetSummary[]> {
  const rows = await db
    .select({
      id: datasets.id,
      name: datasets.name,
      description: datasets.description,
      createdAt: datasets.createdAt,
      versionId: datasetVersions.id,
      versionNumber: datasetVersions.versionNumber,
      status: datasetVersions.status,
      rowCount: datasetVersions.rowCount,
      columnCount: datasetVersions.columnCount,
      timezone: datasetVersions.timezoneUsedForNaiveTimestamps,
      versionCreatedAt: datasetVersions.createdAt,
    })
    .from(datasets)
    .leftJoin(datasetVersions, eq(datasetVersions.id, datasets.currentVersionId))
    .where(scopedWhere(context, datasets))
    .orderBy(desc(datasets.createdAt))

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    currentVersion:
      row.versionId === null ||
      row.versionNumber === null ||
      row.status === null ||
      row.timezone === null ||
      row.versionCreatedAt === null
        ? null
        : {
            id: row.versionId,
            versionNumber: row.versionNumber,
            status: row.status,
            rowCount: row.rowCount,
            columnCount: row.columnCount,
            timezoneUsedForNaiveTimestamps: row.timezone,
            createdAt: row.versionCreatedAt,
          },
  }))
}

export async function findDatasetSummary(
  context: RequestContext,
  datasetId: string,
): Promise<DatasetSummary | undefined> {
  const all = await listDatasets(context)
  return all.find((dataset) => dataset.id === datasetId)
}

/**
 * Every Dataset Version this Dataset has had, newest first — not just the
 * current one. Versions are immutable and a superseded one is never
 * deleted (docs/decisions/02), so this is the read behind the version
 * history: the list is the Dataset's whole recorded past, and the caller
 * marks which entry is current rather than this filtering the rest away.
 */
export async function listDatasetVersions(
  context: RequestContext,
  datasetId: string,
): Promise<readonly DatasetVersionSummary[]> {
  return db
    .select({
      id: datasetVersions.id,
      versionNumber: datasetVersions.versionNumber,
      status: datasetVersions.status,
      rowCount: datasetVersions.rowCount,
      columnCount: datasetVersions.columnCount,
      timezoneUsedForNaiveTimestamps: datasetVersions.timezoneUsedForNaiveTimestamps,
      createdAt: datasetVersions.createdAt,
    })
    .from(datasetVersions)
    .where(scopedWhere(context, datasetVersions, eq(datasetVersions.datasetId, datasetId)))
    .orderBy(desc(datasetVersions.versionNumber))
}

export async function listVersionColumns(
  context: RequestContext,
  datasetVersionId: string,
): Promise<readonly DatasetColumnSummary[]> {
  return db
    .select({
      columnId: datasetColumns.columnId,
      name: datasetColumns.name,
      type: datasetColumns.type,
      nullable: datasetColumns.nullable,
      position: datasetColumns.position,
    })
    .from(datasetColumns)
    .where(
      scopedWhere(context, datasetColumns, eq(datasetColumns.datasetVersionId, datasetVersionId)),
    )
    .orderBy(datasetColumns.position)
}
