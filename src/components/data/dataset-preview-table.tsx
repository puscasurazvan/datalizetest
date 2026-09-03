import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { AnalyticalRow } from "@/modules/analytical-store"
import type { DatasetColumnSummary } from "@/modules/datasets"

/**
 * A preview of the stored rows, one column per Dataset column, in schema
 * order. Cells are keyed by Column ID — the row objects never carry a
 * physical column name, so there is none to render by accident.
 *
 * Numbers are right-aligned and tabular so a column of figures can be
 * scanned down rather than read across. A null is drawn as a dash rather
 * than left blank: blank and "empty string" are different facts, and the
 * import records which one it saw.
 */
const NUMERIC_TYPES = new Set(["integer", "decimal"])

export function DatasetPreviewTable({
  columns,
  rows,
}: {
  columns: readonly DatasetColumnSummary[]
  rows: readonly AnalyticalRow[]
}) {
  if (rows.length === 0) {
    return <p className="text-body-sm text-ink-muted">No rows to show.</p>
  }

  return (
    <div className="max-h-[28rem] overflow-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-surface-raised">
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.columnId}>{column.name}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            // The preview has no key column of its own — the physical table
            // carries no id — so the index is the only stable handle, and it
            // is stable here because this list is never reordered or filtered.
            // oxlint-disable-next-line react/no-array-index-key
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell
                  key={column.columnId}
                  className={cn(
                    "font-mono text-code-md text-ink",
                    NUMERIC_TYPES.has(column.type) && "text-right tabular-nums",
                  )}
                >
                  {renderCell(row[column.columnId])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function renderCell(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "—"
  }
  if (value === "") {
    return "(empty)"
  }
  return value
}
