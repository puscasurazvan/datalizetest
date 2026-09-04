/**
 * Saved Queries — a persisted, re-runnable `QueryAst` + `VisualizationConfig`
 * (queries/CLAUDE.md "Audit & resolution", docs/adr/0003, docs/decisions/02(b)).
 * A Saved Query stores `datasetId`, never a version, and resolves to that
 * Dataset's CURRENT version each time it runs — `executeSavedQuery` below
 * delegates to `executeQuery` for that resolution rather than repeating it,
 * so validation, limits, the currency refusal, and the audit row all stay
 * exactly as `executeQuery` already implements them.
 *
 * Mutations (`create`/`update`/`delete`) assert `query:save`; reads
 * (`list`/`get`/`execute`) assert `query:execute` — there is no
 * `query:read` permission, and a viewer (who only holds `query:execute`)
 * must still be able to open a dashboard built on saved queries they did
 * not create.
 */
import { assertCan } from "@/modules/auth/policy"
import { toPolicyContext } from "@/modules/organizations"
import type { ConfigMismatch, VisualizationConfig } from "@/modules/visualizations"
import { fieldRefName, validateVisualizationConfig } from "@/modules/visualizations"
import type { QueryResultShape } from "@/modules/visualizations"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

import { countFailedQueryExecutions } from "./repository"
import {
  deleteSavedQueryRow,
  findSavedQueryRow,
  insertSavedQuery,
  listSavedQueryRows,
  updateSavedQueryRow,
} from "./saved-query-repository"
import type { SavedQueryRow } from "./saved-query-repository"
import {
  parseSavedQueryAst,
  parseSavedQueryVisualization,
  savedQueryNameSchema,
} from "./schema/saved-query"
import type { QueryAst } from "./schema/query-ast"
import type { QueryResult } from "./schema/query-result"
import { executeQuery, resolveSavedQueryShape } from "./service"

export interface SavedQuerySummary {
  readonly id: string
  readonly name: string
  readonly datasetId: string
  readonly datasetName: string
  readonly visualizationType: "table" | "bar"
  readonly updatedAt: string
}

export interface SavedQueryDetail {
  readonly id: string
  readonly name: string
  readonly datasetId: string
  readonly ast: QueryAst
  readonly visualization: VisualizationConfig
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SavedQueryInput {
  readonly name: string
  readonly ast: QueryAst
  readonly visualization: VisualizationConfig
}

function parseName(name: string): string {
  const result = savedQueryNameSchema.safeParse(name)
  if (!result.success) {
    throw new AppError("VALIDATION", result.error.issues[0]?.message ?? "Invalid name.")
  }
  return result.data
}

// One line per ConfigMismatch variant, mirroring service.ts's own
// describeSchemaIssue — the user-facing reason a Saved Query's
// visualization does not fit the shape its own query produces (contract
// decision 3). Exhaustive switch, no `default`.
function describeVisualizationMismatch(mismatch: ConfigMismatch): string {
  switch (mismatch.kind) {
    case "field_not_found":
      return `The ${mismatch.role} field ("${fieldRefName(mismatch.field)}") is not part of this query's result.`
    case "value_not_numeric":
      return `The value field ("${fieldRefName(mismatch.field)}") is ${mismatch.actualType}, not numeric — a bar chart's value must be a number.`
    case "category_not_groupable":
      return `The category field ("${fieldRefName(mismatch.field)}") is ${mismatch.actualType}, which cannot be grouped into bar categories.`
  }
}

/**
 * Resolves `ast` against its Dataset's current schema and rejects a
 * `visualization` that does not fit the resulting shape — the pre-save
 * half of contract decision 3, shared by `createSavedQuery` and
 * `updateSavedQuery` so neither duplicates the other. Does not execute
 * the query: the checked shape stands in for a result with `rowCount: 0`
 * and `truncated: false`, since a not-yet-run save has no real result to
 * measure against and neither figure affects `validateVisualizationConfig`,
 * which only reads `columns`.
 */
async function assertShapeFitsVisualization(
  context: RequestContext,
  ast: QueryAst,
  visualization: VisualizationConfig,
): Promise<void> {
  const { columns } = await resolveSavedQueryShape(context, ast)
  const shape: QueryResultShape = { columns, rowCount: 0, truncated: false }
  const validation = validateVisualizationConfig(visualization, shape)
  if (!validation.ok) {
    throw new AppError("VALIDATION", describeVisualizationMismatch(validation.mismatch))
  }
}

function toDetail(row: SavedQueryRow): SavedQueryDetail {
  return {
    id: row.id,
    name: row.name,
    datasetId: row.datasetId,
    ast: parseSavedQueryAst(row.id, row.queryAst),
    visualization: parseSavedQueryVisualization(row.id, row.visualization),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function createSavedQuery(
  context: RequestContext,
  input: SavedQueryInput,
): Promise<{ readonly id: string }> {
  assertCan(toPolicyContext(context), "query:save")

  const name = parseName(input.name)
  // `resolveSavedQueryShape` calls `getDatasetSchema(context, ast.datasetId)`,
  // which throws NOT_FOUND when `ast.datasetId` does not resolve to an
  // accessible Dataset — the one way "the Dataset the query is being saved
  // against" can fail to match `ast.datasetId` on a brand-new save, since
  // the row being inserted has no prior `datasetId` of its own to disagree
  // with (see `updateSavedQuery`'s explicit check, where one already exists).
  await assertShapeFitsVisualization(context, input.ast, input.visualization)

  const id = await insertSavedQuery(context, {
    datasetId: input.ast.datasetId,
    name,
    queryAst: input.ast,
    visualization: input.visualization,
    createdBy: context.userId,
  })
  return { id }
}

export async function listSavedQueries(
  context: RequestContext,
): Promise<readonly SavedQuerySummary[]> {
  assertCan(toPolicyContext(context), "query:execute")

  const rows = await listSavedQueryRows(context)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    datasetId: row.datasetId,
    datasetName: row.datasetName,
    visualizationType: parseSavedQueryVisualization(row.id, row.visualization).type,
    updatedAt: row.updatedAt.toISOString(),
  }))
}

export async function getSavedQuery(
  context: RequestContext,
  id: string,
): Promise<SavedQueryDetail> {
  assertCan(toPolicyContext(context), "query:execute")

  const row = await findSavedQueryRow(context, id)
  if (row === undefined) {
    throw new AppError("NOT_FOUND", "Saved query not found.")
  }
  return toDetail(row)
}

export async function updateSavedQuery(
  context: RequestContext,
  id: string,
  input: SavedQueryInput,
): Promise<void> {
  assertCan(toPolicyContext(context), "query:save")

  const existing = await findSavedQueryRow(context, id)
  if (existing === undefined) {
    throw new AppError("NOT_FOUND", "Saved query not found.")
  }
  // A saved query's dataset is fixed at creation — retargeting it to a
  // different Dataset on edit is what contract decision 3's "`ast.datasetId`
  // differs from the Dataset the query is being saved against" actually
  // guards: `existing.datasetId` IS that Dataset.
  if (input.ast.datasetId !== existing.datasetId) {
    throw new AppError(
      "VALIDATION",
      "A saved query cannot be retargeted to a different dataset — delete and re-save it against the new one instead.",
    )
  }

  const name = parseName(input.name)
  await assertShapeFitsVisualization(context, input.ast, input.visualization)

  const updated = await updateSavedQueryRow(context, id, {
    name,
    queryAst: input.ast,
    visualization: input.visualization,
  })
  if (updated === undefined) {
    // Existed a moment ago under this scope (checked above) — a concurrent
    // delete raced this update. Reported the same as a plain miss.
    throw new AppError("NOT_FOUND", "Saved query not found.")
  }
}

export async function deleteSavedQuery(context: RequestContext, id: string): Promise<void> {
  assertCan(toPolicyContext(context), "query:save")

  const deleted = await deleteSavedQueryRow(context, id)
  if (!deleted) {
    throw new AppError("NOT_FOUND", "Saved query not found.")
  }
}

export async function executeSavedQuery(
  context: RequestContext,
  id: string,
): Promise<{ readonly savedQuery: SavedQueryDetail; readonly result: QueryResult }> {
  assertCan(toPolicyContext(context), "query:execute")

  const savedQuery = await getSavedQuery(context, id)
  const result = await executeQuery(context, savedQuery.ast, savedQuery.id)
  return { savedQuery, result }
}

/** This Organization's failed `query_executions` count — feeds a dashboard
 * tile that used to read "—" (contract's `countFailedExecutions`). */
export async function countFailedExecutions(context: RequestContext): Promise<number> {
  assertCan(toPolicyContext(context), "query:execute")
  return countFailedQueryExecutions(context)
}
