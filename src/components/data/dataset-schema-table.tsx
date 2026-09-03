import { Calendar, Clock, Hash, ToggleLeft, Type as TypeIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { NO_VALUE, Pending } from "@/components/ui/pending"
import type { DatasetColumnSummary } from "@/modules/datasets"

/**
 * The inferred schema of a Dataset Version: what each column is called, the
 * type inference settled on, and whether it holds nulls.
 *
 * A Column ID is shown because it is the handle a saved query holds — when
 * a re-upload renames a column, the ID is what proves it is the same column.
 *
 * `position` is stored 1-based (the import writes the CSV's own column
 * order, first column = 1), so it is rendered as-is. Adding one to make it
 * "human" numbers the first column 2.
 */
const TYPE_ICON: Record<string, LucideIcon> = {
  integer: Hash,
  decimal: Hash,
  boolean: ToggleLeft,
  date: Calendar,
  timestamptz: Clock,
}

function TypeCell({ type }: { type: string }) {
  const Icon = TYPE_ICON[type] ?? TypeIcon
  return (
    <span className="inline-flex items-center gap-space-2xs text-ink-muted">
      <Icon strokeWidth={1.5} className="size-3.5" />
      {type}
    </span>
  )
}

/**
 * The Column ID continuity delta (which columns are new, revised or removed
 * relative to the version this one superseded) needs that prior version's
 * schema to compute. `src/modules/datasets` only ever exposes a Dataset's
 * current version, so the indicator ships at full geometry — a Column ID's
 * own continuity is a real product state (CONTEXT.md) — but inert until a
 * prior version is available to diff against (DESIGN.md "Not built yet").
 */
function ContinuityCell() {
  return (
    <Pending reason="Needs the version this one superseded; only the current version is loaded.">
      {NO_VALUE}
    </Pending>
  )
}

export function DatasetSchemaTable({ columns }: { columns: readonly DatasetColumnSummary[] }) {
  if (columns.length === 0) {
    return <p className="text-body-sm text-ink-muted">This version has no columns.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Column</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Nulls</TableHead>
          <TableHead>Column ID</TableHead>
          <TableHead>State</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {columns.map((column) => (
          <TableRow key={column.columnId}>
            <TableCell className="text-ink-muted tabular-nums">{column.position}</TableCell>
            <TableCell className="font-medium text-ink">{column.name}</TableCell>
            <TableCell>
              <TypeCell type={column.type} />
            </TableCell>
            <TableCell className="text-ink-muted">{column.nullable ? "yes" : "no"}</TableCell>
            <TableCell className="font-mono text-code-sm text-ink-faint">
              {column.columnId}
            </TableCell>
            <TableCell>
              <ContinuityCell />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
