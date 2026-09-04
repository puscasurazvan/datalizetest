import { Database, Globe, Layers, ShieldAlert, Table2 } from "lucide-react"

import { DatasetTable } from "./dataset-table"
import { MetricTile } from "./metric-tile"
import { ImportCsvButton } from "@/components/data/import-csv-button"
import { ImportSampleButtons } from "@/components/data/import-sample-buttons"
import { Sheet } from "@/components/provenance/sheet"
import { listDatasetsForContext } from "@/modules/datasets"
import type { DatasetSummary } from "@/modules/datasets"
import { resolveActiveContext } from "../active-context"

export default async function DatasetsPage() {
  const context = await resolveActiveContext()
  if (context === "no-active-organization") {
    // The layout is rendering the workspace opener; this page has nothing
    // to add until a workspace is active.
    return null
  }
  const datasets = await listDatasetsForContext(context)

  const totalRows = datasets.reduce(
    (sum, dataset) => sum + (dataset.currentVersion?.rowCount ?? 0),
    0,
  )
  const versionCount = datasets.filter((dataset) => dataset.currentVersion !== null).length

  return (
    <>
      <header className="flex flex-col justify-between gap-space-md lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-space-sm">
          <h1 className="text-[34px] font-bold tracking-[-0.03em] text-ink">Datasets</h1>
          <span className="flex items-center gap-space-2xs rounded-full bg-surface-high px-space-sm py-space-2xs font-mono text-code-sm text-ink-muted">
            <Globe strokeWidth={1.5} className="size-3.5 text-cyan" />
            <span className="text-ink">{context.organizationTimezone}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-space-sm">
          <ImportCsvButton />
          <ImportSampleButtons />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Datasets"
          value={datasets.length.toLocaleString()}
          source="in this workspace"
          Icon={Database}
        />
        <MetricTile
          label="Rows at current version"
          value={totalRows.toLocaleString()}
          source={`across ${versionCount} version${versionCount === 1 ? "" : "s"}`}
          Icon={Table2}
          accent="verified"
        />
        <MetricTile
          label="Dataset Versions"
          value={versionCount.toLocaleString()}
          source="immutable, never edited"
          Icon={Layers}
        />
        <MetricTile
          label="Refusals"
          value={null}
          source="needs the query builder"
          Icon={ShieldAlert}
          pendingReason="Refusals are recorded when a query runs; the query builder is not built yet."
        />
      </div>

      {datasets.length === 0 ? <EmptyState /> : <DatasetList datasets={datasets} />}
    </>
  )
}

function EmptyState() {
  return (
    <Sheet
      title="No datasets yet"
      note="Datalize reads the columns, shows you the type it inferred for each one and the timezone it will read naive timestamps in, and waits for you to confirm before it stores anything."
      lineageHeading="WHAT HAPPENS"
      lineage={[
        { label: "1 · upload" },
        { label: "2 · infer" },
        { label: "3 · confirm" },
        { label: "4 · version 1" },
      ]}
      titleBlock={[
        { label: "ACCEPTS", value: "CSV up to 50 MB" },
        { label: "CEILING", value: "1M rows · 100 columns" },
        { label: "ON REPEAT UPLOAD", value: "Idempotent — no duplicate", tone: "verified" },
        { label: "STATUS", value: "Ready for a file" },
      ]}
    >
      <p className="max-w-[62ch] text-[13px] text-ink-muted">
        Nothing has been imported into this workspace yet. Import a CSV to create your first
        Dataset, or run one of the samples above — both go through the real import pipeline, so what
        you get back is a genuine Dataset Version either way.
      </p>
    </Sheet>
  )
}

/**
 * A plain enclosure, not a `Sheet`: the rail now carries workspace provenance and
 * the tiles carry the counts, so the sheet's own axis and title block would only
 * repeat both a second time on the same screen.
 */
function DatasetList({ datasets }: { datasets: readonly DatasetSummary[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-hairline bg-surface/90 backdrop-blur-xl">
      <header className="flex flex-col justify-between gap-space-sm border-b border-hairline px-space-lg py-space-md lg:flex-row lg:items-center">
        <h2 className="text-headline-md text-ink">
          {datasets.length} dataset{datasets.length === 1 ? "" : "s"}
        </h2>
        <p className="max-w-[52ch] text-body-sm text-ink-muted lg:text-right">
          Each row is a Dataset at its current version. Open one to see the inferred schema and a
          preview of the rows.
        </p>
      </header>
      <DatasetTable datasets={datasets} />
    </section>
  )
}
