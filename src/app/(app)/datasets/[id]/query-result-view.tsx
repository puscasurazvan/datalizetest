import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { QueryResult } from "@/modules/queries"
import { BarVisualization, type BarDatum } from "@/modules/visualizations/bar-chart"
import {
  capBarCategories,
  granularityFooterText,
  type Granularity,
} from "@/modules/visualizations/config"

const NUMERIC_TYPES = new Set(["integer", "decimal"])
const TABLE_ROW_LIMIT = 100

/**
 * Renders one executed query: a table always, and — only when the result
 * has the exact shape a chartable query produces (one grouped dimension,
 * the charted measure aliased "value", its count-all cross-check aliased
 * "rows") and that dimension was grouped by a date granularity — the bar
 * chart too. A dimension with no granularity (a plain category) still gets
 * a table only: `BarVisualization`'s `granularityNote` is a required prop
 * (decisions/03's footer is specifically about date grouping), and this
 * slice ships no other footer text to give it (ponytail: table-only for a
 * categorical dimension; a category-only bar chart is a real feature, add
 * it — and its own footer wording — when a user asks for one).
 */
export function QueryResultView({
  result,
  organizationTimezone,
  granularity,
  measureLabel,
  columnNames,
}: {
  result: QueryResult
  organizationTimezone: string
  granularity: Granularity | null
  measureLabel: string
  /**
   * Column ID -> the column's human name. A result names its dimensions by
   * Column ID, because that is the only name the query layer is allowed to
   * carry (docs/adr/0002) — but an opaque ID is not a table heading a reader
   * can use, so the name is resolved here, at the edge. A measure alias is
   * not a Column ID and falls through to itself.
   */
  columnNames: Readonly<Record<string, string>>
}) {
  if (result.rowCount === 0) {
    return <p className="text-body-sm text-ink-muted">This query matched no rows.</p>
  }

  const totalLabel = result.truncated ? "10,000+" : result.rowCount.toLocaleString("en-US")

  return (
    <div className="flex flex-col gap-space-lg">
      <BarSection
        result={result}
        granularity={granularity}
        organizationTimezone={organizationTimezone}
        measureLabel={measureLabel}
      />
      <div className="flex flex-col gap-space-sm">
        <p className="text-body-sm text-ink-muted">
          Showing {Math.min(result.rows.length, TABLE_ROW_LIMIT)} of {totalLabel} rows
        </p>
        <ResultTable result={result} columnNames={columnNames} />
      </div>
    </div>
  )
}

function BarSection({
  result,
  granularity,
  organizationTimezone,
  measureLabel,
}: {
  result: QueryResult
  granularity: Granularity | null
  organizationTimezone: string
  measureLabel: string
}) {
  const dimensionColumn = result.columns[0]
  const valueColumn = result.columns[1]
  const rowsColumn = result.columns[2]
  const isChartShaped =
    result.columns.length === 3 &&
    dimensionColumn !== undefined &&
    valueColumn?.name === "value" &&
    rowsColumn?.name === "rows"

  if (!isChartShaped || granularity === null || dimensionColumn === undefined) {
    return null
  }

  const capping = capBarCategories({
    totalCategoryCount: result.rowCount,
    truncated: result.truncated,
    ordering: { kind: "default", firstMeasureAlias: "value" },
    valueField: { kind: "measure", alias: "value" },
  })

  const data: BarDatum[] = result.rows.slice(0, capping.visibleCount).map((row) => ({
    label: row[dimensionColumn.name] ?? "—",
    value: Number(row.value ?? 0),
    rowCount: Number(row.rows ?? 0),
  }))

  return (
    <BarVisualization
      data={data}
      measureLabel={measureLabel}
      granularityNote={granularityFooterText(granularity, organizationTimezone)}
      groupCount={result.truncated ? "10000+" : result.rowCount}
    />
  )
}

function ResultTable({
  result,
  columnNames,
}: {
  result: QueryResult
  columnNames: Readonly<Record<string, string>>
}) {
  return (
    <div className="max-h-[28rem] overflow-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-surface-raised">
          <TableRow>
            {result.columns.map((column) => (
              <TableHead key={column.name}>{columnNames[column.name] ?? column.name}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.slice(0, TABLE_ROW_LIMIT).map((row, index) => (
            // No key column of its own in a query result — the index is stable
            // here because this list is never reordered or filtered client-side.
            // oxlint-disable-next-line react/no-array-index-key
            <TableRow key={index}>
              {result.columns.map((column) => (
                <TableCell
                  key={column.name}
                  className={cn(
                    "font-mono text-code-md text-ink",
                    NUMERIC_TYPES.has(column.type) && "text-right tabular-nums",
                  )}
                >
                  {renderCell(row[column.name])}
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
  if (value === null || value === undefined) return "—"
  if (value === "") return "(empty)"
  return value
}
