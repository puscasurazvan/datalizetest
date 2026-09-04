/**
 * VisualizationConfig — the contract between a Query Result and a Chart
 * Adapter: `Query Result → Visualization Config → Chart Adapter → Recharts`
 * (docs/reference/Datalize.md §17, src/modules/visualizations/CLAUDE.md).
 *
 * Slice 1 ships exactly two chart types. Do not add "line", "area", or
 * "kpi" here — they are Slice 2 and adding them now is speculative.
 *
 * Recharts is not imported here and must not be: this file is the contract
 * an adapter is written against later, not the adapter itself.
 */

/**
 * Names a result column the same way decision 06 #9 already names an
 * `orderBy` target: a Column ID for a raw dimension, or a user-chosen
 * alias for an aggregated measure. Never a bare string — an alias can
 * collide with a Column ID and nothing would say which wins.
 */
export type FieldRef =
  | { readonly kind: "dimension"; readonly columnId: string }
  | { readonly kind: "measure"; readonly alias: string }

/** The identifier a FieldRef resolves to among a QueryResult's columns. */
export function fieldRefName(ref: FieldRef): string {
  return ref.kind === "dimension" ? ref.columnId : ref.alias
}

/** Whether two FieldRefs name the same thing — kind-discriminated, never
 * by comparing resolved names, since a measure alias can collide with a
 * Column ID (see FieldRef above). */
function fieldRefsEqual(a: FieldRef, b: FieldRef): boolean {
  if (a.kind === "dimension" && b.kind === "dimension") {
    return a.columnId === b.columnId
  }
  if (a.kind === "measure" && b.kind === "measure") {
    return a.alias === b.alias
  }
  return false
}

export const VALUE_FORMATS = ["number", "currency", "percent"] as const
export type ValueFormat = (typeof VALUE_FORMATS)[number]

export interface TableVisualizationConfig {
  readonly type: "table"
  // exactOptionalPropertyTypes: widened to agree with config-schema.ts's
  // `z.infer` of an `.optional()` field, which is `string | undefined`, not
  // merely absent-or-string — see config-schema.test.ts's compile-time check.
  readonly title?: string | undefined
}

export interface BarVisualizationConfig {
  readonly type: "bar"
  readonly title?: string | undefined
  readonly categoryField: FieldRef
  readonly valueField: FieldRef
  readonly format?: ValueFormat | undefined
}

/**
 * Discriminated on `type`. Slice 1 has exactly these two members — see
 * src/modules/visualizations/CLAUDE.md.
 */
export type VisualizationConfig = TableVisualizationConfig | BarVisualizationConfig

// --- Chart footer (docs/decisions/03) ---

export const GRANULARITIES = ["day", "week", "month", "quarter", "year"] as const
export type Granularity = (typeof GRANULARITIES)[number]

/**
 * "Grouped by month (UTC)" — every chart grouped by date states its
 * granularity and the resolved organization timezone, so a number is
 * never unexplained (docs/decisions/03). Week additionally states the
 * ISO Monday-start convention, since a US-based analyst otherwise
 * defaults to expecting a Sunday-start week.
 */
export function granularityFooterText(granularity: Granularity, timezone: string): string {
  if (granularity === "week") {
    return `Grouped by week (${timezone}, Monday start)`
  }
  return `Grouped by ${granularity} (${timezone})`
}

// --- Bar chart top-N capping (docs/decisions/06 #12, docs/decisions/05
// "Total Group Count and Ranking for Capped Displays") ---

export const BAR_CHART_CATEGORY_CAP = 50

/**
 * How the query behind the capped result is ordered — the evidence
 * `capBarCategories` needs to know whether its cap can honestly be called
 * "top" (docs/decisions/05 "Total Group Count and Ranking for Capped
 * Displays"). A local stand-in for the compiler's `orderBy` semantics
 * (docs/decisions/06 #9): with no explicit `orderBy` the compiler's
 * default order is the first measure, descending; an explicit `orderBy`
 * inherits whatever order and direction it names. This must be unified
 * with the real query-ast/executor contract once it lands — see the
 * matching note on DatalizeColumnType in ./validate.ts.
 */
export type ResultOrdering =
  | { readonly kind: "default"; readonly firstMeasureAlias: string }
  | { readonly kind: "explicit"; readonly ref: FieldRef; readonly direction: "asc" | "desc" }

/**
 * True only when the query's effective order — its default (first
 * measure, descending) or its explicit `orderBy` — is the charted value
 * field, descending. Only then are the first BAR_CHART_CATEGORY_CAP rows
 * legitimately "top": a default order charting a measure other than the
 * first, or any explicit order not naming the charted field descending,
 * still shows the first N rows but must not call them "top"
 * (docs/decisions/05).
 */
function isRankedByChartedMeasure(ordering: ResultOrdering, valueField: FieldRef): boolean {
  if (ordering.kind === "default") {
    return valueField.kind === "measure" && valueField.alias === ordering.firstMeasureAlias
  }
  return ordering.direction === "desc" && fieldRefsEqual(ordering.ref, valueField)
}

/** A count with a thousands separator, fixed to en-US so output does not
 * depend on the host's locale (`10000` -> `"10,000"`). */
function formatCount(value: number): string {
  return value.toLocaleString("en-US")
}

export interface BarCategoryCapping {
  /** How many categories the chart actually renders. */
  readonly visibleCount: number
  /** How many categories the cap cut. Zero when nothing was dropped. */
  readonly droppedCount: number
  /**
   * "Showing top 50 of N" when the visible rows are ranked by the charted
   * measure descending, "Showing first 50 of N" otherwise (docs/decisions/05)
   * — null when nothing was dropped. N reads "10,000+", never a fabricated
   * exact number, when the underlying result was truncated at the 10,000-row
   * product cap and the true group count is unknown.
   */
  readonly note: string | null
}

export interface BarCategoryCapInput {
  /** The result's `rowCount` — the total category count (docs/decisions/05:
   * "`rowCount` on this same result _is_ the total group count"). */
  readonly totalCategoryCount: number
  /** The result's `truncated` flag — true when more than 10,000 groups
   * exist and the exact total is unknown. */
  readonly truncated: boolean
  /** How the query behind the result is ordered. */
  readonly ordering: ResultOrdering
  /** The bar chart's charted (value) field — what "top" would rank by. */
  readonly valueField: FieldRef
}

/**
 * An uncapped `GROUP BY` can legitimately return thousands of categories
 * (docs/decisions/06 #12). This decides how many a bar chart renders and
 * reports how many it drops, given the total category count and ordering
 * the result carried; it does not sort or slice rows itself.
 *
 * The result may never be called "top N" without evidence the visible
 * rows are actually ranked by the charted measure, and N may never be a
 * fabricated exact number once the result is truncated
 * (docs/decisions/05 "Total Group Count and Ranking for Capped Displays").
 */
export function capBarCategories(input: BarCategoryCapInput): BarCategoryCapping {
  const { totalCategoryCount, truncated, ordering, valueField } = input
  if (totalCategoryCount <= BAR_CHART_CATEGORY_CAP) {
    return { visibleCount: totalCategoryCount, droppedCount: 0, note: null }
  }

  const droppedCount = totalCategoryCount - BAR_CHART_CATEGORY_CAP
  const verb = isRankedByChartedMeasure(ordering, valueField) ? "top" : "first"
  const total = truncated ? `${formatCount(totalCategoryCount)}+` : formatCount(totalCategoryCount)
  return {
    visibleCount: BAR_CHART_CATEGORY_CAP,
    droppedCount,
    note: `Showing ${verb} ${BAR_CHART_CATEGORY_CAP} of ${total}`,
  }
}
