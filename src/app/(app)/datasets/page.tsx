import Link from "next/link"

import { ImportSampleButtons } from "@/components/data/import-sample-buttons"
import { Sheet } from "@/components/drawing/sheet"
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

  return (
    <div>
      <p className="mb-1 font-mono text-[9.5px] font-semibold tracking-[0.16em] text-muted-foreground">
        DATASETS
      </p>
      <h1 className="font-display mb-7 max-w-[20ch] text-[30px] leading-[1.05] tracking-[-0.02em]">
        Every chart starts from a sheet.
      </h1>

      {datasets.length === 0 ? <EmptyState /> : <DatasetList datasets={datasets} />}
    </div>
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
        { label: "ON REPEAT UPLOAD", value: "Idempotent — no duplicate", tone: "checked" },
        { label: "STATUS", value: "Ready for a sample" },
      ]}
    >
      <div className="flex flex-col items-start gap-4 py-2">
        <p className="max-w-[62ch] text-[13px] text-muted-foreground">
          Nothing has been imported into this workspace. Start from one of the three sample files —
          each one runs the real import pipeline, so what you get back is a genuine Dataset Version.
        </p>
        <ImportSampleButtons />
      </div>
    </Sheet>
  )
}

function DatasetList({ datasets }: { datasets: readonly DatasetSummary[] }) {
  const totalRows = datasets.reduce(
    (sum, dataset) => sum + (dataset.currentVersion?.rowCount ?? 0),
    0,
  )

  return (
    <div className="flex flex-col gap-6">
      <Sheet
        title={`${datasets.length} dataset${datasets.length === 1 ? "" : "s"}`}
        note="Each row is a Dataset at its current version. Open one to see the inferred schema and a preview of the rows."
        lineageHeading="THIS WORKSPACE"
        lineage={[
          { label: `${datasets.length} datasets` },
          { label: `${totalRows.toLocaleString()} rows` },
        ]}
        titleBlock={[
          { label: "DATASETS", value: String(datasets.length) },
          { label: "ROWS AT CURRENT VERSION", value: totalRows.toLocaleString() },
          { label: "SOURCE", value: "CSV import", tone: "checked" },
        ]}
      >
        <ul className="divide-y divide-hairline">
          {datasets.map((dataset) => (
            <li key={dataset.id}>
              <Link
                href={`/datasets/${dataset.id}`}
                className="flex flex-wrap items-baseline justify-between gap-3 py-3 hover:bg-muted/40"
              >
                <span className="text-[14px] font-medium">{dataset.name}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {describeVersion(dataset)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>

      <Sheet
        title="Add another"
        lineageHeading="SAMPLES"
        lineage={[{ label: "stripe" }, { label: "customers" }, { label: "events" }]}
        titleBlock={[{ label: "PIPELINE", value: "Real — upload, infer, confirm, load" }]}
      >
        <ImportSampleButtons />
      </Sheet>
    </div>
  )
}

function describeVersion(dataset: DatasetSummary): string {
  const version = dataset.currentVersion
  if (version === null) {
    return "no version yet"
  }
  const rows = version.rowCount === null ? "—" : version.rowCount.toLocaleString()
  const columns = version.columnCount === null ? "—" : String(version.columnCount)
  return `v${version.versionNumber} · ${rows} rows · ${columns} cols · ${version.timezoneUsedForNaiveTimestamps}`
}
