import type { DatasetColumnSummary } from "@/modules/datasets"

/**
 * The inferred schema of a Dataset Version: what each column is called, the
 * type inference settled on, and whether it holds nulls.
 *
 * A Column ID is shown because it is the handle a saved query holds — when
 * a re-upload renames a column, the ID is what proves it is the same column.
 */
export function DatasetSchemaTable({ columns }: { columns: readonly DatasetColumnSummary[] }) {
  if (columns.length === 0) {
    return <p className="text-[13px] text-muted-foreground">This version has no columns.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-hairline text-left">
            <th className="py-2 pr-4 font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">
              #
            </th>
            <th className="py-2 pr-4 font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">
              COLUMN
            </th>
            <th className="py-2 pr-4 font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">
              TYPE
            </th>
            <th className="py-2 pr-4 font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">
              NULLS
            </th>
            <th className="py-2 font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">
              COLUMN ID
            </th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.columnId} className="border-b border-hairline/60">
              <td className="py-2 pr-4 font-mono text-[11px] tabular-nums text-muted-foreground">
                {column.position + 1}
              </td>
              <td className="py-2 pr-4 font-medium">{column.name}</td>
              <td className="py-2 pr-4 font-mono text-[11px]">{column.type}</td>
              <td className="py-2 pr-4 font-mono text-[11px] text-muted-foreground">
                {column.nullable ? "yes" : "no"}
              </td>
              <td className="py-2 font-mono text-[11px] text-muted-foreground">
                {column.columnId}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
