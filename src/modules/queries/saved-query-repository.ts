/**
 * `saved_queries` reads and writes — the persistence half of a Saved
 * Query (queries/CLAUDE.md "Audit & resolution"). Every query is
 * organization-scoped through `scopedWhere`/`withOrganizationId`
 * (src/modules/datasets/repository.ts's pattern) — no bare
 * `db.select/insert/update/delete` against this tenant-owned table.
 *
 * Rows come back with `queryAst`/`visualization` exactly as Postgres
 * stored them (`unknown`) — parsing them into `QueryAst`/
 * `VisualizationConfig` is `./schema/saved-query.ts`'s job, not this
 * file's, matching queries/CLAUDE.md's "jsonb columns come back untyped".
 */
import { randomUUID } from "node:crypto"

import { desc, eq } from "drizzle-orm"
import { DatabaseError } from "pg"

import { db } from "@/db/client"
import { datasets, savedQueries } from "@/db/schema"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"
import { scopedWhere, withOrganizationId } from "@/shared/repository"

const NAME_UNIQUE_CONSTRAINT = "saved_queries_organization_name_idx"

export interface SavedQueryRow {
  readonly id: string
  readonly name: string
  readonly datasetId: string
  readonly queryAst: unknown
  readonly visualization: unknown
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface SavedQueryListRow extends SavedQueryRow {
  readonly datasetName: string
}

export interface NewSavedQuery {
  readonly datasetId: string
  readonly name: string
  readonly queryAst: unknown
  readonly visualization: unknown
  readonly createdBy: string
}

export interface SavedQueryUpdate {
  readonly name: string
  readonly queryAst: unknown
  readonly visualization: unknown
}

/** Maps a Postgres unique-violation on the (organizationId, name) index to
 * the CONFLICT a caller can act on — never a raw driver error. */
function nameConflict(name: string): AppError {
  return new AppError("CONFLICT", `A saved query named "${name}" already exists.`)
}

/**
 * Drizzle's node-postgres driver wraps the underlying `pg` error rather
 * than throwing it directly — the real `DatabaseError` rides on `.cause`,
 * which is exactly why imports/internal/start.ts's own unique-violation
 * check reads `error.cause` instead of `error` itself. Checked in both
 * places here so this holds regardless of which layer the wrap happens at.
 */
function isNameUniqueViolation(error: unknown): boolean {
  const isMatch = (candidate: unknown): boolean =>
    candidate instanceof DatabaseError &&
    candidate.code === "23505" &&
    candidate.constraint === NAME_UNIQUE_CONSTRAINT
  if (isMatch(error)) return true
  return error instanceof Error && isMatch(error.cause)
}

export async function insertSavedQuery(
  context: RequestContext,
  input: NewSavedQuery,
): Promise<string> {
  try {
    const [row] = await db
      .insert(savedQueries)
      .values(
        withOrganizationId(context, {
          id: randomUUID(),
          datasetId: input.datasetId,
          name: input.name,
          queryAst: input.queryAst,
          visualization: input.visualization,
          createdBy: input.createdBy,
        }),
      )
      .returning({ id: savedQueries.id })
    if (!row) {
      // Unreachable: a successful single-row INSERT ... RETURNING always
      // returns exactly one row (mirrors repository.ts's insertQueryExecution).
      throw new Error("invariant violated: insert into saved_queries returned no row")
    }
    return row.id
  } catch (error) {
    if (isNameUniqueViolation(error)) {
      throw nameConflict(input.name)
    }
    throw error
  }
}

/** Every Saved Query in this Organization, newest-edited first, joined to
 * its Dataset's current name for display — never a physical name, `datasets.name`
 * is the human-facing one (docs/adr/0002). */
export async function listSavedQueryRows(
  context: RequestContext,
): Promise<readonly SavedQueryListRow[]> {
  return db
    .select({
      id: savedQueries.id,
      name: savedQueries.name,
      datasetId: savedQueries.datasetId,
      datasetName: datasets.name,
      queryAst: savedQueries.queryAst,
      visualization: savedQueries.visualization,
      createdAt: savedQueries.createdAt,
      updatedAt: savedQueries.updatedAt,
    })
    .from(savedQueries)
    .innerJoin(datasets, eq(datasets.id, savedQueries.datasetId))
    .where(scopedWhere(context, savedQueries))
    .orderBy(desc(savedQueries.updatedAt))
}

export async function findSavedQueryRow(
  context: RequestContext,
  id: string,
): Promise<SavedQueryRow | undefined> {
  const [row] = await db
    .select({
      id: savedQueries.id,
      name: savedQueries.name,
      datasetId: savedQueries.datasetId,
      queryAst: savedQueries.queryAst,
      visualization: savedQueries.visualization,
      createdAt: savedQueries.createdAt,
      updatedAt: savedQueries.updatedAt,
    })
    .from(savedQueries)
    .where(scopedWhere(context, savedQueries, eq(savedQueries.id, id)))
    .limit(1)
  return row
}

/** Returns `undefined` when `id` does not resolve within this
 * organization's scope — the caller (service.ts) is the one that turns
 * that into `AppError("NOT_FOUND", ...)`, matching `assertCan`'s "tenant
 * ownership checked first" ordering: a cross-tenant id must read exactly
 * like a missing one, never a different error. */
export async function updateSavedQueryRow(
  context: RequestContext,
  id: string,
  update: SavedQueryUpdate,
): Promise<SavedQueryRow | undefined> {
  try {
    const [row] = await db
      .update(savedQueries)
      .set({
        name: update.name,
        queryAst: update.queryAst,
        visualization: update.visualization,
        updatedAt: new Date(),
      })
      .where(scopedWhere(context, savedQueries, eq(savedQueries.id, id)))
      .returning({
        id: savedQueries.id,
        name: savedQueries.name,
        datasetId: savedQueries.datasetId,
        queryAst: savedQueries.queryAst,
        visualization: savedQueries.visualization,
        createdAt: savedQueries.createdAt,
        updatedAt: savedQueries.updatedAt,
      })
    return row
  } catch (error) {
    if (isNameUniqueViolation(error)) {
      throw nameConflict(update.name)
    }
    throw error
  }
}

/** Returns `true` when a row within this organization's scope was
 * actually deleted, `false` when `id` did not resolve. */
export async function deleteSavedQueryRow(context: RequestContext, id: string): Promise<boolean> {
  const [row] = await db
    .delete(savedQueries)
    .where(scopedWhere(context, savedQueries, eq(savedQueries.id, id)))
    .returning({ id: savedQueries.id })
  return row !== undefined
}
