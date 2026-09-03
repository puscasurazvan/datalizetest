import Link from "next/link"
import { notFound } from "next/navigation"

import { DatasetPreviewTable } from "@/components/data/dataset-preview-table"
import { DatasetSchemaTable } from "@/components/data/dataset-schema-table"
import { Sheet } from "@/components/drawing/sheet"
import { getDatasetDetail, PREVIEW_ROW_LIMIT } from "@/modules/datasets"
import { resolveActiveContext } from "../../active-context"
import { type RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

export default async function DatasetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await resolveActiveContext()
  if (context === "no-active-organization") {
    return null
  }

  const detail = await loadDetail(context, id)
  if (detail === "not-found") {
    notFound()
  }

  const { dataset, columns, previewRows, previewUnavailable } = detail
  const version = dataset.currentVersion

  return (
    <div>
      <p className="mb-1 font-mono text-[9.5px] font-semibold tracking-[0.16em] text-muted-foreground">
        <Link href="/datasets" className="hover:text-foreground">
          DATASETS
        </Link>
      </p>
      <h1 className="font-display mb-7 max-w-[24ch] text-[30px] leading-[1.05] tracking-[-0.02em]">
        {dataset.name}
      </h1>

      {version === null ? (
        <Sheet
          title="No version yet"
          lineageHeading="STATE"
          lineage={[{ label: "awaiting import" }]}
          titleBlock={[{ label: "STATUS", value: "No Dataset Version" }]}
        >
          <p className="text-[13px] text-muted-foreground">
            This Dataset has no current version. An import that never completed leaves it here.
          </p>
        </Sheet>
      ) : (
        <div className="flex flex-col gap-6">
          <Sheet
            title={`Schema · version ${version.versionNumber}`}
            note="Column IDs are stable across versions, so a saved query survives a re-upload that only adds columns."
            lineageHeading="PROVENANCE"
            lineage={[
              { label: `v${version.versionNumber}` },
              { label: `${columns.length} columns` },
              { label: version.timezoneUsedForNaiveTimestamps },
            ]}
            titleBlock={[
              { label: "VERSION", value: `v${version.versionNumber}` },
              { label: "ROWS", value: (version.rowCount ?? 0).toLocaleString() },
              { label: "COLUMNS", value: String(version.columnCount ?? columns.length) },
              { label: "NAIVE TIMESTAMPS READ IN", value: version.timezoneUsedForNaiveTimestamps },
              { label: "STATUS", value: version.status, tone: "checked" },
            ]}
          >
            <DatasetSchemaTable columns={columns} />
          </Sheet>

          <Sheet
            title="Rows"
            note={`The first ${PREVIEW_ROW_LIMIT} rows as stored. Ordering is physical, not a query — sorting and filtering arrive with the query builder.`}
            lineageHeading="PREVIEW"
            lineage={[
              { label: `${previewRows.length} of ${(version.rowCount ?? 0).toLocaleString()}` },
            ]}
            titleBlock={[
              { label: "SHOWING", value: `${previewRows.length} rows` },
              { label: "OF", value: (version.rowCount ?? 0).toLocaleString() },
            ]}
          >
            {previewUnavailable !== null ? (
              <p className="text-[13px] text-muted-foreground">{previewUnavailable}</p>
            ) : (
              <DatasetPreviewTable columns={columns} rows={previewRows} />
            )}
          </Sheet>
        </div>
      )}
    </div>
  )
}

async function loadDetail(
  context: RequestContext,
  id: string,
): Promise<Awaited<ReturnType<typeof getDatasetDetail>> | "not-found"> {
  try {
    return await getDatasetDetail(context, id)
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") {
      return "not-found"
    }
    throw error
  }
}
