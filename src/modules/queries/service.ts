/**
 * `executeQuery` — the one entry point that turns a `QueryAst` into a
 * `QueryResult`, per queries/CLAUDE.md: this module owns AST -> validation
 * -> limits -> result -> audit row, and never touches a pool or compiles
 * SQL itself (that is `analytical-store`'s `compileQuery` /
 * `execute-query.ts`, reached only through `AnalyticalStore.execute`).
 */
import { PostgresAnalyticalStore } from "@/modules/analytical-store"
import type { DatasetColumnSummary } from "@/modules/datasets"
import { getDatasetSchema } from "@/modules/datasets"
import { assertCan } from "@/modules/auth/policy"
import { toPolicyContext } from "@/modules/organizations"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

import { finishRows, rowLimits } from "./internal/limits"
import type { DatasetColumn, ResolvedQuery, SchemaIssue } from "./internal/validator"
import { singleCurrencyRefusal, validateQueryAgainstDataset } from "./internal/validator"
import { insertQueryExecution } from "./repository"
import type { QueryAst } from "./schema/query-ast"
import type { QueryResult, QueryResultColumn } from "./schema/query-result"

function toDatasetColumn(column: DatasetColumnSummary): DatasetColumn {
  return { id: column.columnId, name: column.name, type: column.type, nullable: column.nullable }
}

// One line per SchemaIssue variant, joined — the message an AppError("SCHEMA_INCOMPATIBLE")
// carries, and the only thing a client ever sees of the issue (validation.error.issues
// itself still rides along in `internal` for server-side logging). Exhaustive switch, no
// `default`: a new SchemaIssue variant fails typecheck here, not review.
function describeSchemaIssue(issue: SchemaIssue): string {
  switch (issue.code) {
    case "COLUMN_REMOVED":
      return `Column "${issue.columnId}" no longer exists in the current version of this dataset.`
    case "TYPE_INCOMPATIBLE":
      return `Column "${issue.columnName}": ${issue.reason}.`
    case "ORDER_BY_UNRESOLVED":
      return issue.ref.kind === "dimension"
        ? `The sort order references a dimension ("${issue.ref.columnId}") this query does not group by.`
        : `The sort order references a measure alias ("${issue.ref.alias}") this query does not define.`
  }
}

function schemaIssueMessage(issues: readonly SchemaIssue[]): string {
  return issues.map(describeSchemaIssue).join(" ")
}

// count/count_distinct always return an integer regardless of the counted column's
// type; avg always returns a decimal (Postgres itself widens an integer avg); sum/min/max
// keep the aggregated column's own type. measure.column is non-null in every branch but
// count/count_distinct — query-ast.ts's own refine guarantees field is null only when
// aggregation is "count", and the validator resolves count_distinct's field the same way.
function measureColumnType(measure: ResolvedQuery["measures"][number]): DatasetColumn["type"] {
  switch (measure.aggregation) {
    case "count":
    case "count_distinct":
      return "integer"
    case "avg":
      return "decimal"
    case "sum":
    case "min":
    case "max": {
      if (measure.column === null) {
        // Unreachable: query-ast.ts's refine rejects field: null for every
        // aggregation but "count".
        throw new Error(`invariant violated: "${measure.aggregation}" measure has no column`)
      }
      return measure.column.type
    }
  }
}

// A granularity dimension projects `::date` (compile-query.ts, G5: `date_trunc(x AT
// TIME ZONE tz)` returns a zone-less `timestamp`, never `timestamptz`) — the result
// column must say so, or a formatter downstream would render a zone that isn't there.
function dimensionColumnType(
  dimension: ResolvedQuery["dimensions"][number],
): DatasetColumn["type"] {
  return dimension.granularity !== undefined ? "date" : dimension.column.type
}

// Dimensions then measures, keyed by the same name `ExecuteResult.keys` used for that
// row position — a Column ID for a dimension, the measure's own alias otherwise.
export function resultColumns(resolved: ResolvedQuery): readonly QueryResultColumn[] {
  return [
    ...resolved.dimensions.map((dimension) => ({
      name: dimension.column.id,
      type: dimensionColumnType(dimension),
    })),
    ...resolved.measures.map((measure) => ({
      name: measure.alias,
      type: measureColumnType(measure),
    })),
  ]
}

/**
 * Validates `ast` against the Dataset's CURRENT schema (`columns`) and
 * returns the resolved query, or throws `AppError("SCHEMA_INCOMPATIBLE", ...)`
 * — the one place that builds that message, shared by `executeQuery`'s
 * try block below and by `saved-query-service.ts`'s pre-save shape check
 * (contract decision 3), so neither duplicates `describeSchemaIssue`.
 */
function resolveAgainstSchema(ast: QueryAst, columns: DatasetColumn[]): ResolvedQuery {
  const validation = validateQueryAgainstDataset(ast, columns)
  if (!validation.ok) {
    throw new AppError("SCHEMA_INCOMPATIBLE", schemaIssueMessage(validation.error.issues), {
      internal: { issues: validation.error.issues },
    })
  }
  return validation.query
}

/**
 * The same schema resolution `executeQuery` runs, reused by
 * `saved-query-service.ts` to check a Saved Query's `ast` and
 * `visualization` fit the Dataset's CURRENT schema at create/update time
 * — without executing the query (contract decision 3: "rejects when
 * `ast.datasetId` ... and when `validateVisualizationConfig` says the
 * config does not fit the query's own result shape"). Not itself part of
 * this module's public surface (`./index.ts`) — a same-module sibling
 * import, not a cross-module one.
 */
export async function resolveSavedQueryShape(
  context: RequestContext,
  ast: QueryAst,
): Promise<{ resolved: ResolvedQuery; columns: readonly QueryResultColumn[] }> {
  const schema = await getDatasetSchema(context, ast.datasetId)
  const datasetColumns = schema.columns.map(toDatasetColumn)
  const resolved = resolveAgainstSchema(ast, datasetColumns)
  return { resolved, columns: resultColumns(resolved) }
}

/**
 * `savedQueryId` is `null` for an ad-hoc builder/AI-generated query
 * (docs/decisions/02(b): "Absent for ad-hoc builder queries and
 * AI-generated queries") and threaded into the audit row on both the
 * success and failure branches below — an optional third parameter with a
 * default so every existing two-argument call site keeps working
 * unchanged (queries/CLAUDE.md's own contract for this change).
 */
export async function executeQuery(
  context: RequestContext,
  ast: QueryAst,
  savedQueryId: string | null = null,
): Promise<QueryResult> {
  assertCan(toPolicyContext(context), "query:execute")

  // Captured once, before the Dataset Version even resolves: this is "when the
  // user ran the query" (executedAt, G10) and the wall-clock anchor a failure's
  // audit row measures `durationMs` from (G9) — a validation or store failure has
  // no client.query() bracket of its own the way a success does.
  const startedAt = new Date()
  const enteredAt = Date.now()

  // Deliberately outside the try/catch below: `query_executions.datasetVersionId`
  // is NOT NULL, and there is nothing honest to put there for a Dataset that does
  // not resolve at all — no row is written for this failure (G9).
  const schema = await getDatasetSchema(context, ast.datasetId)
  const columns = schema.columns.map(toDatasetColumn)

  try {
    const resolved = resolveAgainstSchema(ast, columns)

    const refusal = singleCurrencyRefusal(resolved, columns)
    if (refusal !== null) {
      throw new AppError("VALIDATION", refusal)
    }

    const { effectiveLimit, engineLimit } = rowLimits(resolved.limit)
    const executed = await new PostgresAnalyticalStore().execute(
      context,
      schema.datasetVersionId,
      resolved,
      engineLimit,
    )
    const finished = finishRows(executed.rows, effectiveLimit)

    const queryId = await insertQueryExecution(context, {
      datasetVersionId: schema.datasetVersionId,
      savedQueryId,
      organizationTimezone: context.organizationTimezone,
      status: "success",
      startedAt,
      completedAt: new Date(),
      durationMs: executed.durationMs,
      rowCount: finished.rowCount,
      errorCode: null,
    })

    return {
      columns: resultColumns(resolved),
      rows: finished.rows,
      rowCount: finished.rowCount,
      truncated: finished.truncated,
      hasMore: finished.hasMore,
      durationMs: executed.durationMs,
      queryId,
      executedAt: startedAt.toISOString(),
    }
  } catch (error) {
    await insertQueryExecution(context, {
      datasetVersionId: schema.datasetVersionId,
      savedQueryId,
      organizationTimezone: context.organizationTimezone,
      status: "failed",
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - enteredAt,
      rowCount: null,
      errorCode: error instanceof AppError ? error.code : "INTERNAL",
    })
    throw error
  }
}
