/**
 * Pure translation from the query builder's selections to a `QueryAst`
 * (queries/CLAUDE.md — the AST is the only thing that crosses to
 * `/api/queries/execute`; nothing here touches SQL or a physical name).
 *
 * `aggregationOptions`/`filterOperatorOptions` read the same
 * `AGGREGATIONS_BY_TYPE`/`OPERATORS_BY_TYPE` tables the server validator
 * enforces against, so the builder's dropdowns can never offer a choice
 * the server then rejects (queries/index.ts's own reason for exporting them).
 *
 * The two constants are deep-imported from `internal/validator` rather than
 * the `@/modules/queries` barrel this file otherwise uses only for types
 * (fully erased, so they cost nothing at runtime): that barrel also
 * re-exports `executeQuery`, which chains into `PostgresAnalyticalStore` and
 * `pg` — a value import of anything through it breaks the client bundle for
 * this "use client" tree (`pg` needs Node's `net`/`tls`). `internal/validator`
 * itself imports nothing but types, so it is a safe runtime leaf — the same
 * "deep-import a leaf when the barrel is unsuitable" precedent this plan
 * already took for `organizations/canonical-timezones` (plan section 3).
 * Revert to the barrel once `queries/index.ts` splits its client-safe
 * surface from `executeQuery` (a fix that belongs to steps 2/10, not this
 * one).
 */
import { AGGREGATIONS_BY_TYPE, OPERATORS_BY_TYPE } from "@/modules/queries/internal/validator"
import type {
  Aggregation,
  DatalizeColumnType,
  Dimension,
  Filter,
  FilterOperator,
  FilterValue,
  Granularity,
  Measure,
  QueryAst,
} from "@/modules/queries"

export function aggregationOptions(type: DatalizeColumnType): readonly Aggregation[] {
  return [...AGGREGATIONS_BY_TYPE[type]]
}

// between/in need a two-value or list input the builder does not offer yet
// (ponytail: single-value filters only; add a range/list control when a
// user asks for one — the compiler and validator already handle both).
export type ComparisonOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
export type SingleValueOperator = ComparisonOperator | "is_null" | "is_not_null"

const SINGLE_VALUE_OPERATORS = new Set<FilterOperator>([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_null",
  "is_not_null",
])

function isSingleValueOperator(operator: FilterOperator): operator is SingleValueOperator {
  return SINGLE_VALUE_OPERATORS.has(operator)
}

export function filterOperatorOptions(type: DatalizeColumnType): readonly SingleValueOperator[] {
  return [...OPERATORS_BY_TYPE[type]].filter(isSingleValueOperator)
}

export interface DimensionChoice {
  readonly columnId: string
  readonly granularity: Granularity | null
}

export interface MeasureChoice {
  /** `null` means count-all — the aggregation is then always "count". */
  readonly fieldColumnId: string | null
  readonly aggregation: Aggregation
}

export type FilterChoice =
  | {
      readonly columnId: string
      readonly operator: ComparisonOperator
      readonly value: FilterValue
    }
  | { readonly columnId: string; readonly operator: "is_null" | "is_not_null" }

/** Parses a filter row's raw `<input>` string against the filtered column's
 * type. Returns `null` for an empty or unparseable value — the caller reads
 * that as "not ready to filter yet", never as a filter on a bad value. */
export function parseFilterValue(type: DatalizeColumnType, raw: string): FilterValue | null {
  if (raw === "") return null
  if (type === "integer" || type === "decimal") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (type === "boolean") {
    return raw === "true"
  }
  return raw
}

/** A filter row's selections, resolved to a `FilterChoice` or `null` when
 * nothing is filterable yet — no column chosen, or a value-needing operator
 * whose value has not parsed (see `parseFilterValue`). Never a filter on a
 * value the user has not finished typing. */
export function resolveFilterChoice(
  column: { columnId: string; type: DatalizeColumnType } | null,
  operator: SingleValueOperator,
  rawValue: string,
): FilterChoice | null {
  if (column === null) return null
  if (operator === "is_null" || operator === "is_not_null") {
    return { columnId: column.columnId, operator }
  }
  const value = parseFilterValue(column.type, rawValue)
  return value === null ? null : { columnId: column.columnId, operator, value }
}

/**
 * The charted measure is aliased "value" and compiled first — the compiler's
 * default order (first measure, descending) then ranks a bar chart's rows
 * truthfully as "top" (visualizations/CLAUDE.md's bar chart cap). "rows" is
 * the count-all cross-check `BarDatum.rowCount` needs; it rides along on
 * every query, not only ones that end up charted, since the builder has no
 * way to know ahead of the run whether the result will be chart-eligible.
 */
export function buildQueryAst(input: {
  datasetId: string
  dimension: DimensionChoice | null
  measure: MeasureChoice | null
  filter: FilterChoice | null
}): QueryAst | null {
  const { datasetId, dimension, measure, filter } = input
  if (dimension === null && measure === null) return null

  const dimensions: Dimension[] =
    dimension === null
      ? []
      : [
          dimension.granularity === null
            ? { columnId: dimension.columnId }
            : { columnId: dimension.columnId, granularity: dimension.granularity },
        ]

  const measures: Measure[] =
    measure === null
      ? []
      : [
          { field: measure.fieldColumnId, aggregation: measure.aggregation, alias: "value" },
          { field: null, aggregation: "count", alias: "rows" },
        ]

  const filters: Filter[] = filter === null ? [] : [filter]

  return { version: 1, datasetId, dimensions, measures, filters }
}
