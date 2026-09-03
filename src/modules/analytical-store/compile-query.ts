/**
 * Compiles a resolved query into parameterised SQL text against one Dataset
 * Version's physical table (this module's CLAUDE.md "Build order",
 * queries/CLAUDE.md "Limits & execution").
 *
 * Pure: no pool, no I/O. `ResolvedQuery` is the one type crossing the
 * queries -> analytical-store boundary (plan section 1) — physical names
 * never travel the other way, and this file never imports `@/db/analytical`
 * or the QueryAst schema itself, only the already-resolved shape.
 *
 * Every user-supplied value (filter values, `engineLimit`) is a bind
 * parameter. The only things ever string-interpolated into `text` are:
 * server-generated identifiers (`quoteIdentifier`, from the stored Column
 * ID -> physical name mapping and `qualifiedTable`), and the granularity /
 * comparison-operator SQL fragments below, each drawn from a
 * `Record<EnumMember, string>` so nothing but a known enum member can ever
 * reach the string — never a bare `${dimension.granularity}` or
 * `${filter.operator}` splice.
 */
import type { FilterValue, Granularity, OrderBy, ResolvedQuery } from "@/modules/queries"
import { CANONICAL_IANA_TIMEZONES } from "@/modules/organizations/canonical-timezones"
import { AppError } from "@/shared/errors"

import { quoteIdentifier } from "./physical-names"

export interface CompiledQuery {
  readonly text: string
  readonly values: readonly FilterValue[]
}

type ResolvedDimension = ResolvedQuery["dimensions"][number]
type ResolvedMeasure = ResolvedQuery["measures"][number]
type ResolvedFilter = ResolvedQuery["filters"][number]

// date_trunc's field argument is itself a SQL string literal, not an
// identifier — Postgres has no bind-parameter position for it, so this
// table is what stands between the granularity value and interpolation.
// Values equal their own keys today; the table exists so a future
// granularity can't be added to the Zod enum (query-ast.ts) without a
// matching, deliberate entry here.
const DATE_TRUNC_FIELD: Record<Granularity, string> = {
  day: "day",
  week: "week",
  month: "month",
  quarter: "quarter",
  year: "year",
}

const COMPARISON_SQL: Record<"eq" | "neq" | "gt" | "gte" | "lt" | "lte", string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
}

/** Escapes a Postgres string literal per its own doubling rule (`quoteIdentifier`'s sibling). */
function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function quoteColumn(columnId: string, mapping: ReadonlyMap<string, string>): string {
  const physicalName = mapping.get(columnId)
  if (physicalName === undefined) {
    // Reachable only if the caller's mapping omits a column the validator
    // already resolved against the same Dataset Version — a caller bug,
    // not user input.
    throw new Error(`invariant violated: no physical mapping for column "${columnId}"`)
  }
  return quoteIdentifier(physicalName)
}

/**
 * The dimension's grouping expression — identical in SELECT (`::text`
 * appended by the caller below), GROUP BY, and ORDER BY, so the projection's
 * text cast is never what rows are sorted or grouped by. A granularity
 * dimension truncates to the org's timezone and casts to `::date`: Plan 1
 * tagged this result column `timestamptz`, but `date_trunc(x AT TIME ZONE
 * tz)` returns `timestamp` — no zone attached — so the compiled expression
 * itself lands on `date`, not merely the caller's column-type label (G5).
 */
function dimensionExpr(
  dimension: ResolvedDimension,
  mapping: ReadonlyMap<string, string>,
  timezone: string,
): string {
  const column = quoteColumn(dimension.column.id, mapping)
  if (dimension.granularity === undefined) return column
  const field = DATE_TRUNC_FIELD[dimension.granularity]
  return `date_trunc('${field}', ${column} AT TIME ZONE ${sqlStringLiteral(timezone)})::date`
}

/**
 * The measure's aggregate expression. `field: null` only ever pairs with
 * `aggregation: "count"` (measureSchema's refine in query-ast.ts) — there is
 * no column to aggregate, so `count(*)` covers every reachable case here.
 */
function measureExpr(measure: ResolvedMeasure, mapping: ReadonlyMap<string, string>): string {
  if (measure.column === null) return "count(*)"
  const column = quoteColumn(measure.column.id, mapping)
  if (measure.aggregation === "count_distinct") return `count(DISTINCT ${column})`
  return `${measure.aggregation}(${column})`
}

/** Accumulates bind values in emission order and hands back each one's `$n` placeholder. */
class ParamBinder {
  private readonly boundValues: FilterValue[] = []

  bind(value: FilterValue): string {
    this.boundValues.push(value)
    return `$${this.boundValues.length}`
  }

  get values(): readonly FilterValue[] {
    return this.boundValues
  }
}

/**
 * One filter's WHERE clause, per-operator (G2) — `is_null`/`is_not_null`
 * bind nothing, `between` binds two, `in` binds one placeholder per value
 * (an explicit `IN ($1, $2, …)`, never `= ANY($1)`, so there is no
 * array-element-type inference to reason about against a `date` column).
 */
function filterClause(
  filter: ResolvedFilter,
  mapping: ReadonlyMap<string, string>,
  binder: ParamBinder,
): string {
  const column = quoteColumn(filter.column.id, mapping)
  switch (filter.operator) {
    case "is_null":
      return `${column} IS NULL`
    case "is_not_null":
      return `${column} IS NOT NULL`
    case "between": {
      const [low, high] = filter.value
      return `${column} BETWEEN ${binder.bind(low)} AND ${binder.bind(high)}`
    }
    case "in":
      return `${column} IN (${filter.value.map((value) => binder.bind(value)).join(", ")})`
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return `${column} ${COMPARISON_SQL[filter.operator]} ${binder.bind(filter.value)}`
  }
}

type OrderClause = { readonly expr: string; readonly direction: "asc" | "desc" }

// Default ordering when the AST supplies no `orderBy` (docs/decisions/05
// "Default Ordering, and Why Truncation Needs It"): the first measure,
// descending, so a truncated result keeps its largest values; falling back
// to the first dimension, ascending, for a measure-less (dimension-only,
// e.g. distinct values) query. `queryAstSchema` guarantees at least one of
// the two is non-empty, but that guarantee lives in a sibling module's
// schema, not this function's parameter type, so both branches are handled.
function defaultOrderBy(query: ResolvedQuery): readonly OrderBy[] {
  const [firstMeasure] = query.measures
  if (firstMeasure !== undefined) {
    return [{ kind: "measure", alias: firstMeasure.alias, direction: "desc" }]
  }
  const [firstDimension] = query.dimensions
  if (firstDimension !== undefined) {
    return [{ kind: "dimension", columnId: firstDimension.column.id, direction: "asc" }]
  }
  return []
}

function orderByClauses(
  query: ResolvedQuery,
  dimensionExprByColumnId: ReadonlyMap<string, string>,
  measureExprByAlias: ReadonlyMap<string, string>,
): readonly OrderClause[] {
  const refs =
    query.orderBy !== undefined && query.orderBy.length > 0 ? query.orderBy : defaultOrderBy(query)

  return refs.map((ref): OrderClause => {
    if (ref.kind === "dimension") {
      const expr = dimensionExprByColumnId.get(ref.columnId)
      if (expr === undefined) {
        // unresolvedOrderByIssues (validator.ts) already rejects an orderBy
        // ref to an ungrouped dimension before a ResolvedQuery can exist.
        throw new Error(
          `invariant violated: orderBy references ungrouped dimension "${ref.columnId}"`,
        )
      }
      return { expr, direction: ref.direction }
    }
    const expr = measureExprByAlias.get(ref.alias)
    if (expr === undefined) {
      throw new Error(
        `invariant violated: orderBy references undefined measure alias "${ref.alias}"`,
      )
    }
    return { expr, direction: ref.direction }
  })
}

/**
 * Compiles `query` against `qualifiedTable`, using `mapping` (Column ID ->
 * physical column name, this Dataset Version's slice of `analytical_columns`)
 * to resolve every identifier. `timezone` must be a canonical IANA zone —
 * checked here, before any interpolation, because it is spliced into
 * `AT TIME ZONE` literally rather than bound (queries/CLAUDE.md: "allowlist-
 * checked, not parameterised" — Postgres has no bind position for it).
 * `engineLimit` is `LIMIT`'s value, bound like any other parameter, never a
 * literal — the caller (rowLimits, queries/internal/limits.ts) already
 * folded the user's `limit` and the `MAX_ROWS` cap into this one integer.
 *
 * Every SELECT item carries a fixed, positional `AS "s{i}"` — never a
 * caller-chosen name, so no caller data reaches SQL identifier position any
 * more than before, and `rowMode: "array"` never reads it; the caller zips
 * positions back to Column IDs and measure aliases itself. The alias exists
 * only to defeat a Postgres naming rule that would otherwise break ORDER
 * BY: a bare `"c_0"::text` with no alias is itself still named `c_0` (a
 * cast of a plain column reference keeps the column's name), and `ORDER BY
 * "c_0"` — a bare identifier that then matches that output column's name —
 * binds to the *output* column, not the input one, sorting the `::text`
 * cast instead of the raw value ("9", "10", "100" sorts as "10" < "100" <
 * "9"). Confirmed against real Postgres, not merely reasoned about — see
 * this repo's execute-query.integration.test.ts. `s{i}` can never equal a
 * `c_{n}` physical name, so ORDER BY (which repeats the *un-cast*
 * expression, never the alias) unambiguously binds to the input column
 * again.
 */
export function compileQuery(
  query: ResolvedQuery,
  mapping: ReadonlyMap<string, string>,
  qualifiedTable: string,
  timezone: string,
  engineLimit: number,
): CompiledQuery {
  if (!CANONICAL_IANA_TIMEZONES.has(timezone)) {
    throw new AppError("VALIDATION", "This workspace's timezone is not on the supported list.", {
      internal: { timezone },
    })
  }

  // Each dimension's expression is computed once here and reused verbatim
  // for SELECT (`::text` appended), GROUP BY, and — via the two lookup maps
  // below — ORDER BY, so the projection's text cast is never the sort key.
  const dimensionEntries = query.dimensions.map((dimension) => ({
    columnId: dimension.column.id,
    expr: dimensionExpr(dimension, mapping, timezone),
  }))
  const measureEntries = query.measures.map((measure) => ({
    alias: measure.alias,
    expr: measureExpr(measure, mapping),
  }))
  const dimensionExprByColumnId = new Map(
    dimensionEntries.map((entry): [string, string] => [entry.columnId, entry.expr]),
  )
  const measureExprByAlias = new Map(
    measureEntries.map((entry): [string, string] => [entry.alias, entry.expr]),
  )

  // SELECT order is dimensions then measures — the same order the executor
  // (execute-query.ts) zips `rowMode: "array"` positions back to Column IDs
  // and measure aliases. Each item's `AS "s{i}"` is this function's own doc
  // comment's ORDER BY fix, not a caller-visible name.
  const selectList = [...dimensionEntries, ...measureEntries].map(
    (entry, index) => `${entry.expr}::text AS "s${index}"`,
  )

  const binder = new ParamBinder()
  const whereClause =
    query.filters.length > 0
      ? ` WHERE ${query.filters.map((filter) => filterClause(filter, mapping, binder)).join(" AND ")}`
      : ""

  const groupByClause =
    dimensionEntries.length > 0
      ? ` GROUP BY ${dimensionEntries.map((entry) => entry.expr).join(", ")}`
      : ""

  const order = orderByClauses(query, dimensionExprByColumnId, measureExprByAlias)
  const orderByClause =
    order.length > 0
      ? ` ORDER BY ${order.map((clause) => `${clause.expr} ${clause.direction.toUpperCase()}`).join(", ")}`
      : ""

  const limitPlaceholder = binder.bind(engineLimit)

  const text =
    `SELECT ${selectList.join(", ")} FROM ${qualifiedTable}` +
    `${whereClause}${groupByClause}${orderByClause} LIMIT ${limitPlaceholder}`

  return { text, values: binder.values }
}
