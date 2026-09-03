"use client"

import { useMemo } from "react"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
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
 * The bar adapter. Recharts is imported here and nowhere else in the app
 * (docs/adr/0002, this module's CLAUDE.md), so callers pass `BarDatum[]`
 * and never see a Recharts prop — shadcn's own `chart` component was
 * skipped for the same reason plus nine type assertions against "No casts".
 *
 * The extreme is dimensioned rather than merely coloured: the tallest bar
 * takes `--color-chart-1` (cyan, DESIGN.md's "emphasised series") and its
 * value is written out beneath the series with its row count, so the reader
 * gets the figure and its cross-check without a hover. `--color-chart-5`
 * (rose) means a refused series elsewhere and is never spent on an ordinary
 * reading — do not repoint `EMPHASIS_FILL` at it.
 */
const CATEGORY_CAP = 50

const CHART_MARGIN = { top: 12, right: 8, bottom: 4, left: 8 }
const AXIS_TICK = {
  fill: "var(--color-ink-faint)",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
}
const VALUE_LABEL = {
  fill: "var(--color-ink-faint)",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
}
const TOOLTIP_CONTENT_STYLE = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-hairline)",
  borderRadius: "var(--radius-md)",
  boxShadow: "none",
  color: "var(--color-ink)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
}
const TOOLTIP_LABEL_STYLE = { color: "var(--color-ink-muted)" }
const TOOLTIP_CURSOR = { fill: "var(--color-surface-high)" }
const EMPHASIS_FILL = "var(--color-chart-1)"
const NEUTRAL_FILL = "var(--color-chart-2)"

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
          <CartesianGrid
            vertical={false}
            stroke="var(--color-hairline-strong)"
            strokeOpacity={0.3}
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis tickLine={false} axisLine={false} width={56} tick={AXIS_TICK} />
          <Tooltip
            cursor={TOOLTIP_CURSOR}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            formatter={formatTooltipValue}
          />
          <Bar dataKey="value" isAnimationActive={false}>
            {data.map((datum) => (
              <Cell
                key={datum.label}
                fill={datum.label === peak?.label ? EMPHASIS_FILL : NEUTRAL_FILL}
              />
            ))}
            <LabelList
              dataKey="value"
              position="top"
              style={VALUE_LABEL}
              formatter={formatCompact}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <figcaption className="mt-1 flex flex-wrap gap-x-3 font-mono text-code-sm text-ink-muted">
        {peak ? (
          <span>
            <span className="font-semibold text-cyan">{formatFull(peak.value)}</span>
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

/** Recharts' tooltip formatter passes back whatever type the series held. */
function formatTooltipValue(value: unknown): string {
  return typeof value === "number" ? formatFull(value) : String(value)
}
