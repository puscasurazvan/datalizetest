import { ArrowLeft, Globe, Layers, Table2 } from "lucide-react"
import Link from "next/link"

import { ImportCsvButton } from "@/components/data/import-csv-button"
import { NO_VALUE, Pending } from "@/components/ui/pending"
import type { DatasetVersionSummary } from "@/modules/datasets"

/**
 * The eyebrow, name and status pills for one Dataset — the same idiom as
 * the Datasets index header, so the two screens read as one product. The
 * pills are corroborating readings (DESIGN.md "Cross-check"): version, row
 * count and the timezone naive timestamps were read in, all real.
 *
 * "Add a version" gates on `canAddVersion`, which the page computes from
 * `dataset:manage` — not `dataset:read` (plan section 5, step 6): a viewer
 * can watch this Dataset but `start.ts`'s `datasetId` branch would reject
 * their submit, so the button must not exist for them at all.
 */
export function DatasetHeader({
  datasetId,
  name,
  version,
  canAddVersion,
}: {
  datasetId: string
  name: string
  version: DatasetVersionSummary | null
  canAddVersion: boolean
}) {
  return (
    <header className="flex flex-col gap-space-sm">
      <Link
        href="/datasets"
        className="-mx-space-sm inline-flex w-fit items-center gap-space-xs rounded-lg px-space-sm py-space-2xs text-body-sm text-ink-muted transition-colors hover:bg-surface-high hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft strokeWidth={1.5} className="size-4" />
        Datasets
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex flex-wrap items-center gap-space-sm">
          <h1 className="text-[34px] font-bold tracking-[-0.03em] text-ink">{name}</h1>
          <VersionPill version={version} />
          <RowsPill version={version} />
          <TimezonePill version={version} />
        </div>
        {canAddVersion ? <ImportCsvButton datasetId={datasetId} /> : null}
      </div>
    </header>
  )
}

function VersionPill({ version }: { version: DatasetVersionSummary | null }) {
  return (
    <span className="flex items-center gap-space-2xs rounded-full bg-surface-high px-space-sm py-space-2xs font-mono text-code-sm text-ink-muted">
      <Layers strokeWidth={1.5} className="size-3.5 text-cyan" />
      {version === null ? (
        <Pending reason="This Dataset has no current version yet.">{NO_VALUE}</Pending>
      ) : (
        <span className="text-ink">v{version.versionNumber}</span>
      )}
    </span>
  )
}

function RowsPill({ version }: { version: DatasetVersionSummary | null }) {
  return (
    <span className="flex items-center gap-space-2xs rounded-full bg-surface-high px-space-sm py-space-2xs font-mono text-code-sm text-ink-muted">
      <Table2 strokeWidth={1.5} className="size-3.5 text-cyan" />
      {version === null || version.rowCount === null ? (
        <Pending reason="Row count is recorded once the version's rows are loaded.">
          {NO_VALUE}
        </Pending>
      ) : (
        <span className="text-ink">{version.rowCount.toLocaleString()} rows</span>
      )}
    </span>
  )
}

function TimezonePill({ version }: { version: DatasetVersionSummary | null }) {
  return (
    <span className="flex items-center gap-space-2xs rounded-full bg-surface-high px-space-sm py-space-2xs font-mono text-code-sm text-ink-muted">
      <Globe strokeWidth={1.5} className="size-3.5 text-cyan" />
      {version === null ? (
        <Pending reason="Applied only once naive timestamps are read for a version.">
          {NO_VALUE}
        </Pending>
      ) : (
        <span className="text-ink">{version.timezoneUsedForNaiveTimestamps}</span>
      )}
    </span>
  )
}
