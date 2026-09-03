"use client"

import { useMemo } from "react"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"

/** One group of a `sum`/`count`/`avg` aggregate: the dimension value and its measure. */
export interface BarDatum {
  readonly label: string
  readonly value: number
  /** The corroborating second reading — a row count beside a sum. */
  readonly rowCount: number
}

/**
 * The bar adapter. Recharts is imported here and nowhere else in the app:
 * docs/adr/0002 and src/modules/visualizations/CLAUDE.md require chart
 * library types to stay inside this module, so callers pass `BarDatum[]`
 * and never see a Recharts prop.
 *
 * shadcn's own `chart` component was deliberately not used. It lives in
 * `components/ui`, which would export Recharts-typed props app-wide and
 * break exactly that boundary, and its implementation carries nine type
 * assertions against CLAUDE.md's "No casts". The CSS-variable theming it
 * provides is already in globals.css as `--chart-1` … `--chart-5`.
 *
 * The extreme is dimensioned rather than merely coloured: the tallest bar
 * takes `--chart-5` (redline) and its value is written out beneath the
 * series with its row count, so the reader gets the figure and its
 * cross-check without a hover. Colour is never the only channel.
 */
const CATEGORY_CAP = 50

const CHART_MARGIN = { top: 12, right: 8, bottom: 4, left: 8 }
const X_AXIS_LINE = { stroke: "var(--hairline)" }
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 9 }

export function BarVisualization({
  data,
  measureLabel,
  granularityNote,
  groupCount,
}: {
  data: readonly BarDatum[]
  measureLabel: string
  /** Granularity and the resolved workspace timezone, e.g. "Grouped by month
   *  (Europe/Paris)" — required by this module's CLAUDE.md (decisions/03). */
  granularityNote: string
  /** The query result's true `rowCount`. Pass `"10000+"` when the result was
   *  truncated by the product cap; never fabricate a number (decisions/05). */
  groupCount: number | "10000+"
}) {
  const rows = useMemo(() => [...data], [data])
  const peak = data.reduce<BarDatum | undefined>(
    (highest, datum) => (highest === undefined || datum.value > highest.value ? datum : highest),
    undefined,
  )

  return (
    <figure className="m-0">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart accessibilityLayer data={rows} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke="var(--hairline-faint)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={X_AXIS_LINE}
            tick={AXIS_TICK}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis tickLine={false} axisLine={false} width={56} tick={AXIS_TICK} />
          <Bar dataKey="value" isAnimationActive={false}>
            {data.map((datum) => (
              <Cell
                key={datum.label}
                fill={datum.label === peak?.label ? "var(--chart-5)" : "var(--chart-1)"}
              />
            ))}
            <LabelList
              dataKey="value"
              position="top"
              fontSize={9}
              fill="var(--muted-foreground)"
              formatter={formatCompact}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <figcaption className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-muted-foreground">
        {peak ? (
          <span>
            <span className="font-semibold text-redline">{formatFull(peak.value)}</span>
            {` ${measureLabel} · ${peak.label} · cross-checked against ${peak.rowCount.toLocaleString("en-US")} rows`}
          </span>
        ) : null}
        <span>{granularityNote}</span>
        {capNote(data.length, groupCount)}
      </figcaption>
    </figure>
  )
}

/**
 * The top-50 cap note. Only says "top" because the compiler's default order
 * for a bar chart is the charted measure descending; any other explicit
 * `orderBy` must not use this wording (this module's CLAUDE.md).
 */
function capNote(shown: number, groupCount: number | "10000+"): string | null {
  if (shown < CATEGORY_CAP) return null
  const total = groupCount === "10000+" ? "10,000+" : groupCount.toLocaleString("en-US")
  return `Showing top ${CATEGORY_CAP} of ${total}`
}

function formatCompact(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString("en-US", { notation: "compact" }) : ""
}

function formatFull(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
