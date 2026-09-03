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
    return <p className="text-[13px] text-muted-foreground">No rows to show.</p>
  }

  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-hairline text-left">
            {columns.map((column) => (
              <th
                key={column.columnId}
                className="whitespace-nowrap py-2 pr-4 font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground"
              >
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            // The preview has no key column of its own — the physical table
            // carries no id — so the index is the only stable handle, and it
            // is stable here because this list is never reordered or filtered.
            // oxlint-disable-next-line react/no-array-index-key
            <tr key={index} className="border-b border-hairline/60">
              {columns.map((column) => (
                <td
                  key={column.columnId}
                  className={
                    NUMERIC_TYPES.has(column.type)
                      ? "whitespace-nowrap py-1.5 pr-4 text-right font-mono text-[12px] tabular-nums"
                      : "whitespace-nowrap py-1.5 pr-4 font-mono text-[12px]"
                  }
                >
                  {renderCell(row[column.columnId])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
