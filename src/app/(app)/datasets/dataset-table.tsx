import Link from "next/link"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { DatasetSummary, DatasetVersionSummary } from "@/modules/datasets"

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
})

/**
 * One row per Dataset, each showing its current Version as a corroborating
 * second reading beside the row count it produced (DESIGN.md "Cross-check")
 * — the two numbers a reader would otherwise have to open the Dataset to
 * compare.
 */
export function DatasetTable({ datasets }: { datasets: readonly DatasetSummary[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="font-mono text-[10px] tracking-[0.12em] text-ink-faint">
            DATASET
          </TableHead>
          <TableHead className="font-mono text-[10px] tracking-[0.12em] text-ink-faint">
            VERSION
          </TableHead>
          <TableHead className="text-right font-mono text-[10px] tracking-[0.12em] text-ink-faint">
            ROWS
          </TableHead>
          <TableHead className="font-mono text-[10px] tracking-[0.12em] text-ink-faint">
            UPDATED
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {datasets.map((dataset) => (
          <DatasetRow key={dataset.id} dataset={dataset} />
        ))}
      </TableBody>
    </Table>
  )
}

function DatasetRow({ dataset }: { dataset: DatasetSummary }) {
  const version = dataset.currentVersion

  return (
    <TableRow>
      <TableCell>
        <Link href={`/datasets/${dataset.id}`} className="font-medium text-ink hover:text-cyan">
          {dataset.name}
        </Link>
      </TableCell>
      <TableCell className="font-mono text-ink-muted">
        {version === null ? (
          <span className="text-ink-faint">no version</span>
        ) : (
          `v${version.versionNumber}`
        )}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums text-ink-muted">
        {version === null ? "—" : rowCountLabel(version)}
      </TableCell>
      <TableCell className="font-mono text-ink-faint">
        {TIMESTAMP_FORMAT.format(dataset.createdAt)}
      </TableCell>
    </TableRow>
  )
}

function rowCountLabel(version: DatasetVersionSummary): string {
  return version.rowCount === null ? "—" : version.rowCount.toLocaleString()
}
