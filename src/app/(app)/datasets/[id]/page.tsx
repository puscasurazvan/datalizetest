import type { ReactNode } from "react"
import { notFound } from "next/navigation"

import { DatasetHeader } from "./dataset-header"
import { QueryPanel } from "./query-panel"
import { VersionHistory } from "./version-history"
import { DatasetPreviewTable } from "@/components/data/dataset-preview-table"
import { DatasetSchemaTable } from "@/components/data/dataset-schema-table"
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

  const { dataset, versions, columns, previewRows, previewUnavailable } = detail
  const version = dataset.currentVersion

  if (version === null) {
    return (
      <>
        <DatasetHeader name={dataset.name} version={null} />
        <div className="rounded-xl border border-hairline bg-surface-raised p-space-md text-body-sm text-ink-muted">
          This Dataset has no current version. An import that never completed leaves it here.
        </div>
        {versions.length > 0 ? (
          <DetailSection
            title="Version history"
            note="The versions this Dataset does have. None of them is current, so none is marked active."
          >
            <VersionHistory versions={versions} activeVersionId={null} />
          </DetailSection>
        ) : null}
      </>
    )
  }

  return (
    <>
      <DatasetHeader name={dataset.name} version={version} />

      <DetailSection
        title="Version history"
        note="Every version this Dataset has had. A re-upload adds a new one here — the versions it supersedes stay listed, struck through, never removed."
      >
        <VersionHistory versions={versions} activeVersionId={version.id} />
      </DetailSection>

      <DetailSection
        title={`Schema · ${columns.length} columns · v${version.versionNumber}`}
        note="Column IDs are stable across versions, so a saved query survives a re-upload that only adds columns."
      >
        <DatasetSchemaTable columns={columns} />
      </DetailSection>

      <DetailSection
        title="Query"
        note="One dimension, one measure, one filter — the flagship shape: a total grouped by month, pinned to a single currency."
      >
        <QueryPanel
          datasetId={dataset.id}
          columns={columns}
          organizationTimezone={context.organizationTimezone}
        />
      </DetailSection>

      <DetailSection
        title={`Rows · showing ${previewRows.length} of ${(version.rowCount ?? 0).toLocaleString()}`}
        note={`The first ${PREVIEW_ROW_LIMIT} rows as stored. Ordering is physical, not a query — sorting and filtering arrive with the query builder.`}
      >
        {previewUnavailable !== null ? (
          <p className="p-space-lg text-body-sm text-ink-muted">{previewUnavailable}</p>
        ) : (
          <DatasetPreviewTable columns={columns} rows={previewRows} />
        )}
      </DetailSection>
    </>
  )
}

/**
 * The glass-card enclosure every detail section shares — the same pattern
 * `DatasetList` uses on the Datasets index, copied rather than imported
 * because the rail now carries workspace provenance and each section here
 * needs its own heading and note instead of the index's dataset count.
 */
function DetailSection({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-hairline bg-surface/90 backdrop-blur-xl">
      <header className="flex flex-col justify-between gap-space-sm border-b border-hairline px-space-lg py-space-md lg:flex-row lg:items-center">
        <h2 className="text-headline-md text-ink">{title}</h2>
        <p className="max-w-[52ch] text-body-sm text-ink-muted lg:text-right">{note}</p>
      </header>
      {children}
    </section>
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
