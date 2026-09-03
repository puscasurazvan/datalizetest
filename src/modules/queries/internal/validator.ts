import type { AnalyticalColumnType } from "@/modules/analytical-store"
import type {
  Aggregation,
  Dimension,
  Filter,
  FilterOperator,
  OrderBy,
  QueryAst,
} from "../schema/query-ast"

/**
 * Resolves a validated QueryAst against one dataset's columns (docs/decisions/06 #9,
 * queries/CLAUDE.md). Every Column ID the AST references must exist in `columns` and
 * be used in a way its type supports — an operator, a granularity, or an aggregation
 * that does not fit the type is rejected the same as a missing column.
 */

// The canonical six live once, in analytical-store (docs/decisions/03, 04) — this
// is a type-only import, so it does not create the runtime edge queries/CLAUDE.md
// forbids (this module still never imports @/db/analytical or touches a pool).
// "date" is a calendar date — no instant, never passed through AT TIME ZONE;
// "timestamptz" is the instant type, covering both offset-bearing and naive
// import input. "datetime" is an input SHAPE only and is never a column type.
export type DatalizeColumnType = AnalyticalColumnType

export type DatasetColumn = {
  id: string
  name: string
  type: DatalizeColumnType
  nullable: boolean
}

export type ResolvedColumnRef = { id: string; name: string; type: DatalizeColumnType }

export type ResolvedDimension = {
  column: ResolvedColumnRef
  granularity?: Dimension["granularity"]
}
export type ResolvedMeasure = {
  column: ResolvedColumnRef | null
  aggregation: Aggregation
  alias: string
}

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never
export type ResolvedFilter = DistributiveOmit<Filter, "columnId"> & { column: ResolvedColumnRef }

export type ResolvedQuery = {
  version: 1
  datasetId: string
  dimensions: ResolvedDimension[]
  measures: ResolvedMeasure[]
  filters: ResolvedFilter[]
  orderBy?: OrderBy[]
  limit?: number
}

// Defined locally: another workflow owns src/shared/errors and this module must not
// import from it. Unify with that module's error shape once it exists.
//
// No TYPE_CHANGED code: this validator's only input is the current dataset's
// columns, looked up by Column ID. A retyped column gets a NEW Column ID
// (CONTEXT.md), so a retyped column and a removed one look identical from
// here — both are simply "this columnId is absent" — and there is no sound
// way to tell them apart without also being handed the previous version's
// columns. Rather than keep a union member this validator can never produce,
// both surface as COLUMN_REMOVED, matching what queries/CLAUDE.md actually
// promises: "A removed/retyped column raises SCHEMA_INCOMPATIBLE naming the
// column — never a blank chart." Distinguishing the two (a strictly better
// message: "this column's type changed" vs. "this column is gone") is a real
// improvement but needs a second input this pure kernel does not have yet;
// it belongs on validateQueryAgainstDataset as an added parameter once a
// caller can supply the previous version's columns, not as a dead error code
// today.
export type SchemaIssue =
  | { code: "COLUMN_REMOVED"; columnId: string }
  | { code: "TYPE_INCOMPATIBLE"; columnId: string; columnName: string; reason: string }
  | { code: "ORDER_BY_UNRESOLVED"; ref: OrderByRef }

type OrderByRef = { kind: "dimension"; columnId: string } | { kind: "measure"; alias: string }

export type SchemaIncompatibleError = { code: "SCHEMA_INCOMPATIBLE"; issues: SchemaIssue[] }

export type ValidationResult =
  | { ok: true; query: ResolvedQuery }
  | { ok: false; error: SchemaIncompatibleError }

const ORDERABLE: FilterOperator[] = ["gt", "gte", "lt", "lte", "between"]
// Exported so the query builder's operator/aggregation dropdowns read the same
// table this validator enforces against — a dropdown that hard-codes its own
// list can drift out of sync and offer a choice the validator then rejects.
export const OPERATORS_BY_TYPE: Record<DatalizeColumnType, ReadonlySet<FilterOperator>> = {
  string: new Set(["eq", "neq", "in", "is_null", "is_not_null"]),
  integer: new Set(["eq", "neq", "in", "is_null", "is_not_null", ...ORDERABLE]),
  decimal: new Set(["eq", "neq", "in", "is_null", "is_not_null", ...ORDERABLE]),
  boolean: new Set(["eq", "neq", "is_null", "is_not_null"]),
  date: new Set(["eq", "neq", "in", "is_null", "is_not_null", ...ORDERABLE]),
  timestamptz: new Set(["eq", "neq", "in", "is_null", "is_not_null", ...ORDERABLE]),
}

// sum/avg need a numeric column; min/max need an orderable one (Postgres has no
// min/max(boolean)); count and count_distinct apply to any column, null included.
export const AGGREGATIONS_BY_TYPE: Record<DatalizeColumnType, ReadonlySet<Aggregation>> = {
  string: new Set(["count", "count_distinct", "min", "max"]),
  integer: new Set(["count", "count_distinct", "sum", "avg", "min", "max"]),
  decimal: new Set(["count", "count_distinct", "sum", "avg", "min", "max"]),
  boolean: new Set(["count", "count_distinct"]),
  date: new Set(["count", "count_distinct", "min", "max"]),
  timestamptz: new Set(["count", "count_distinct", "min", "max"]),
}

function findColumn(columns: DatasetColumn[], columnId: string): DatasetColumn | undefined {
  return columns.find((column) => column.id === columnId)
}

export function validateQueryAgainstDataset(
  ast: QueryAst,
  columns: DatasetColumn[],
): ValidationResult {
  const issues: SchemaIssue[] = []

  for (const dimension of ast.dimensions) {
    const column = findColumn(columns, dimension.columnId)
    if (!column) {
      issues.push({ code: "COLUMN_REMOVED", columnId: dimension.columnId })
      continue
    }
    if (dimension.granularity !== undefined && column.type !== "timestamptz") {
      issues.push(
        typeIssue(column, `granularity "${dimension.granularity}" requires a timestamptz column`),
      )
    }
  }

  for (const measure of ast.measures) {
    if (measure.field === null) continue // count-all, no column to resolve
    const column = findColumn(columns, measure.field)
    if (!column) {
      issues.push({ code: "COLUMN_REMOVED", columnId: measure.field })
      continue
    }
    if (!AGGREGATIONS_BY_TYPE[column.type].has(measure.aggregation)) {
      issues.push(typeIssue(column, `aggregation "${measure.aggregation}" does not apply here`))
    }
  }

  for (const filter of ast.filters) {
    const column = findColumn(columns, filter.columnId)
    if (!column) {
      issues.push({ code: "COLUMN_REMOVED", columnId: filter.columnId })
      continue
    }
    if (!OPERATORS_BY_TYPE[column.type].has(filter.operator)) {
      issues.push(typeIssue(column, `operator "${filter.operator}" does not apply here`))
    }
  }

  issues.push(...unresolvedOrderByIssues(ast))

  if (issues.length > 0) {
    return { ok: false, error: { code: "SCHEMA_INCOMPATIBLE", issues } }
  }
  return { ok: true, query: resolveQuery(ast, columns) }
}

function typeIssue(column: DatasetColumn, reason: string): SchemaIssue {
  return {
    code: "TYPE_INCOMPATIBLE",
    columnId: column.id,
    columnName: column.name,
    reason: `${reason} (column "${column.name}" is ${column.type})`,
  }
}

// ORDER BY may only reference a dimension actually grouped by, or a measure alias
// actually defined — never a bare string, so nothing else can collide with a
// Column ID (docs/decisions/06 #9).
function unresolvedOrderByIssues(ast: QueryAst): SchemaIssue[] {
  const dimensionIds = new Set(ast.dimensions.map((dimension) => dimension.columnId))
  const measureAliases = new Set(ast.measures.map((measure) => measure.alias))
  return (ast.orderBy ?? [])
    .filter((ref) =>
      ref.kind === "dimension" ? !dimensionIds.has(ref.columnId) : !measureAliases.has(ref.alias),
    )
    .map((ref): SchemaIssue => {
      const unresolvedRef: OrderByRef =
        ref.kind === "dimension"
          ? { kind: "dimension", columnId: ref.columnId }
          : { kind: "measure", alias: ref.alias }
      return { code: "ORDER_BY_UNRESOLVED", ref: unresolvedRef }
    })
}

// Only reached once every reference above is confirmed to resolve, so a lookup miss
// here means this validator's own two passes disagree — an invariant break, not
// user input to report structurally.
function requireColumn(columns: DatasetColumn[], columnId: string): ResolvedColumnRef {
  const column = findColumn(columns, columnId)
  if (!column)
    throw new Error(`invariant violated: column "${columnId}" missing after passing validation`)
  return { id: column.id, name: column.name, type: column.type }
}

// ponytail: a column-name heuristic ("currency", case-insensitive) — the dataset
// model has no monetary-column tag yet, so this is the only signal available.
// Replace with a real tag on DatasetColumn once one exists; until then this is
// the only thing standing between `transactions_stripe.csv`'s mixed USD/EUR
// rows (decisions/01:60) and a SUM that silently adds two currencies together.
const CURRENCY_AGGREGATIONS: ReadonlySet<Aggregation> = new Set(["sum", "avg", "min", "max"])

/**
 * Refuses a query that aggregates a decimal column across rows that may carry
 * different currencies — called only after validateQueryAgainstDataset has
 * already passed (docs/decisions/01:60, this plan's "Currency rule placement").
 * Returns a user-facing message, or null when the query is safe: no currency
 * column exists, no measure needs it, or the caller already pinned one
 * currency by an equality filter, a single-value "in" filter, or grouping by
 * currency.
 */
export function singleCurrencyRefusal(
  resolved: ResolvedQuery,
  columns: DatasetColumn[],
): string | null {
  const currencyColumn = columns.find(
    (column) => column.type === "string" && column.name.toLowerCase() === "currency",
  )
  if (!currencyColumn) return null

  const aggregatesMoney = resolved.measures.some(
    (measure) =>
      measure.column !== null &&
      measure.column.type === "decimal" &&
      CURRENCY_AGGREGATIONS.has(measure.aggregation),
  )
  if (!aggregatesMoney) return null

  if (isCurrencyPinned(resolved, currencyColumn.id)) return null

  return (
    `This query aggregates an amount without pinning "${currencyColumn.name}" to one value — ` +
    `the dataset mixes currencies, so the total would silently add different currencies ` +
    `together. Filter "${currencyColumn.name}" to a single value, or group by it, first.`
  )
}

function isCurrencyPinned(resolved: ResolvedQuery, currencyColumnId: string): boolean {
  const groupedByCurrency = resolved.dimensions.some(
    (dimension) => dimension.column.id === currencyColumnId,
  )
  if (groupedByCurrency) return true

  return resolved.filters.some((filter) => {
    if (filter.column.id !== currencyColumnId) return false
    if (filter.operator === "eq") return true
    if (filter.operator === "in") return filter.value.length === 1
    return false
  })
}

function resolveQuery(ast: QueryAst, columns: DatasetColumn[]): ResolvedQuery {
  return {
    version: 1,
    datasetId: ast.datasetId,
    dimensions: ast.dimensions.map((dimension) => ({
      column: requireColumn(columns, dimension.columnId),
      ...(dimension.granularity !== undefined ? { granularity: dimension.granularity } : {}),
    })),
    measures: ast.measures.map((measure) => ({
      column: measure.field === null ? null : requireColumn(columns, measure.field),
      aggregation: measure.aggregation,
      alias: measure.alias,
    })),
    filters: ast.filters.map((filter) => {
      const { columnId, ...rest } = filter
      return { ...rest, column: requireColumn(columns, columnId) }
    }),
    ...(ast.orderBy !== undefined ? { orderBy: ast.orderBy } : {}),
    ...(ast.limit !== undefined ? { limit: ast.limit } : {}),
  }
}
