/**
 * Parse boundary for a Saved Query's jsonb columns (queries/CLAUDE.md
 * "Audit & resolution", "jsonb columns come back untyped" — decision 2 of
 * this build's contract). `saved_queries.query_ast` and `.visualization`
 * are stored as plain `jsonb`, deliberately never typed with drizzle's
 * `.$type<T>()` — that would be a cast wearing a generic (AGENTS.md "No
 * casts"). Every read of either column goes through the two parsers below
 * instead, never straight off the row.
 */
import { z } from "zod"

import type { VisualizationConfig } from "@/modules/visualizations"
import { visualizationConfigSchema } from "@/modules/visualizations"

import { queryAstSchema } from "./query-ast"
import type { QueryAst } from "./query-ast"

export const SAVED_QUERY_NAME_MAX_LENGTH = 200

/**
 * A Saved Query's display name: non-empty once trimmed, and capped so it
 * always fits `saved_queries_organization_name_idx` (the (organizationId,
 * name) unique index) without ever being silently truncated at the
 * database.
 */
export const savedQueryNameSchema = z
  .string()
  .trim()
  .min(1, "name is required")
  .max(
    SAVED_QUERY_NAME_MAX_LENGTH,
    `name must be at most ${SAVED_QUERY_NAME_MAX_LENGTH} characters`,
  )

/**
 * A stored row that fails to parse is not this call's user input to
 * reject — it is evidence a Dataset's schema moved on since the row was
 * written (queries/CLAUDE.md "Audit & resolution": a removed/retyped
 * column surfaces as SCHEMA_INCOMPATIBLE at *execution* time, which is a
 * different, expected path; a jsonb blob that no longer parses at all is
 * not that — it means the AST/visualization *shape itself* changed, e.g. a
 * schema migration). `AppErrorCode` (src/shared/errors) has no member for
 * "unexpected internal state", so — matching the existing "invariant
 * violated" convention already in this module (service.ts's
 * measureColumnType, repository.ts's insertQueryExecution) — this throws a
 * plain `Error`, not an `AppError`: `toSafeDto`'s default branch is what
 * turns it into a safe, generic 500 for the client, never the raw
 * `ZodError` (which could otherwise carry a fragment of the stored value).
 */
function parseFailure(
  savedQueryId: string,
  field: "queryAst" | "visualization",
  cause: unknown,
): Error {
  return new Error(`saved query "${savedQueryId}": stored ${field} no longer parses`, { cause })
}

export function parseSavedQueryAst(savedQueryId: string, raw: unknown): QueryAst {
  const result = queryAstSchema.safeParse(raw)
  if (!result.success) {
    throw parseFailure(savedQueryId, "queryAst", result.error)
  }
  return result.data
}

export function parseSavedQueryVisualization(savedQueryId: string, raw: unknown): VisualizationConfig {
  const result = visualizationConfigSchema.safeParse(raw)
  if (!result.success) {
    throw parseFailure(savedQueryId, "visualization", result.error)
  }
  return result.data
}
