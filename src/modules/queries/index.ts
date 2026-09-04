/**
 * Public surface of src/modules/queries (queries/CLAUDE.md). Other modules
 * reach the AST shape, the canonical column-type union, and what a resolved
 * query looks like through here — never by reaching into ./internal or
 * ./schema directly. `AGGREGATIONS_BY_TYPE`/`OPERATORS_BY_TYPE` are exported
 * so a query builder's dropdowns read the same table the validator enforces
 * against, instead of hard-coding a second list that can drift out of sync.
 * `executeQuery` is the one entry point a Route Handler calls — AST in,
 * `QueryResult` out, with the audit row already written either way.
 */
export { queryAstSchema } from "./schema/query-ast"
export type {
  Aggregation,
  Dimension,
  Filter,
  FilterOperator,
  FilterValue,
  Granularity,
  Measure,
  OrderBy,
  QueryAst,
} from "./schema/query-ast"

export { AGGREGATIONS_BY_TYPE, OPERATORS_BY_TYPE } from "./internal/validator"
export type {
  DatalizeColumnType,
  DatasetColumn,
  ResolvedQuery,
  SchemaIssue,
} from "./internal/validator"

export { executeQuery } from "./service"
export type { QueryResult, QueryResultColumn } from "./schema/query-result"

export {
  countFailedExecutions,
  createSavedQuery,
  deleteSavedQuery,
  executeSavedQuery,
  getSavedQuery,
  listSavedQueries,
  updateSavedQuery,
} from "./saved-query-service"
export type {
  SavedQueryDetail,
  SavedQueryInput,
  SavedQuerySummary,
} from "./saved-query-service"
