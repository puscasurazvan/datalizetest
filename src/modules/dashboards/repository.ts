/**
 * Reads and writes for `dashboards` / `dashboard_widgets`, on the
 * application pool only (dashboards/CLAUDE.md). Every query is
 * organization-scoped through `scopedWhere` / `withOrganizationId`.
 */
import { randomUUID } from "node:crypto"

import { and, eq, sql } from "drizzle-orm"

import { db } from "@/db/client"
import { dashboardWidgets, dashboards, datasetVersions, datasets, savedQueries } from "@/db/schema"
import type { dashboardWidgetSizeEnum } from "@/db/schema"
import type { RequestContext } from "@/shared/context/request-context"
import { scopedWhere, withOrganizationId } from "@/shared/repository"

/** "third" / "half" / "full" — drizzle's own enum, not a re-declaration. */
export type WidgetSize = (typeof dashboardWidgetSizeEnum.enumValues)[number]

export interface DashboardRow {
  readonly id: string
  readonly name: string
  readonly revision: number
}

/**
 * Everything `loadDashboard` needs about one widget, already joined to its
 * Saved Query and that query's Dataset — one query for the whole
 * dashboard rather than one lookup per widget. `versionNumber` is
 * `null` when the Dataset has no current version yet (an import still
 * running, or none ever completed); `service.ts` turns that into a
 * `SCHEMA_INCOMPATIBLE`-shaped error outcome, the same fate
 * `executeSavedQuery` would independently reach for the same Dataset.
 */
export interface DashboardWidgetRow {
  readonly id: string
  readonly savedQueryId: string
  /** The Saved Query's own name — the widget's display title. */
  readonly name: string
  readonly size: WidgetSize
  readonly position: number
  /** The Saved Query's Dataset's current name — for the ok outcome's provenance line, not the widget title. */
  readonly datasetName: string
  readonly versionNumber: number | null
}

export async function findDashboardByName(
  context: RequestContext,
  name: string,
): Promise<DashboardRow | undefined> {
  const [row] = await db
    .select({ id: dashboards.id, name: dashboards.name, revision: dashboards.revision })
    .from(dashboards)
    .where(scopedWhere(context, dashboards, eq(dashboards.name, name)))
    .limit(1)
  return row
}

export async function findDashboardById(
  context: RequestContext,
  dashboardId: string,
): Promise<DashboardRow | undefined> {
  const [row] = await db
    .select({ id: dashboards.id, name: dashboards.name, revision: dashboards.revision })
    .from(dashboards)
    .where(scopedWhere(context, dashboards, eq(dashboards.id, dashboardId)))
    .limit(1)
  return row
}

/**
 * Inserts the Organization's one dashboard, tolerating a concurrent
 * creator: `onConflictDoNothing` relies on the same unique index
 * (`organizationId`, `name`) that already guards a second same-named
 * dashboard, so two racing first visits produce one row, not a thrown
 * unique-violation. The caller re-selects afterward either way — this
 * never returns the row itself, since it may not be the one that landed.
 */
export async function insertDashboardIfAbsent(
  context: RequestContext,
  name: string,
): Promise<void> {
  await db
    .insert(dashboards)
    .values(withOrganizationId(context, { id: randomUUID(), name, createdBy: context.userId }))
    .onConflictDoNothing()
}

export async function listWidgetRows(
  context: RequestContext,
  dashboardId: string,
): Promise<readonly DashboardWidgetRow[]> {
  return db
    .select({
      id: dashboardWidgets.id,
      savedQueryId: dashboardWidgets.savedQueryId,
      size: dashboardWidgets.size,
      position: dashboardWidgets.position,
      name: savedQueries.name,
      datasetName: datasets.name,
      versionNumber: datasetVersions.versionNumber,
    })
    .from(dashboardWidgets)
    .innerJoin(savedQueries, eq(savedQueries.id, dashboardWidgets.savedQueryId))
    .innerJoin(datasets, eq(datasets.id, savedQueries.datasetId))
    .leftJoin(datasetVersions, eq(datasetVersions.id, datasets.currentVersionId))
    .where(scopedWhere(context, dashboardWidgets, eq(dashboardWidgets.dashboardId, dashboardId)))
    .orderBy(dashboardWidgets.position)
}

/** Next widget's position: one past the current max, 0 for the first widget on a dashboard. */
export async function nextWidgetPosition(
  context: RequestContext,
  dashboardId: string,
): Promise<number> {
  const [row] = await db
    .select({ maxPosition: sql<number | null>`max(${dashboardWidgets.position})` })
    .from(dashboardWidgets)
    .where(scopedWhere(context, dashboardWidgets, eq(dashboardWidgets.dashboardId, dashboardId)))
  return (row?.maxPosition ?? -1) + 1
}

export async function insertWidget(
  context: RequestContext,
  input: { dashboardId: string; savedQueryId: string; size: WidgetSize; position: number },
): Promise<string> {
  const [row] = await db
    .insert(dashboardWidgets)
    .values(withOrganizationId(context, { id: randomUUID(), ...input }))
    .returning({ id: dashboardWidgets.id })
  if (!row) {
    // Unreachable: a successful single-row INSERT ... RETURNING always returns exactly one row.
    throw new Error("invariant violated: insert into dashboard_widgets returned no row")
  }
  return row.id
}

/** Returns whether a row was actually deleted — the caller turns "none" into `NOT_FOUND`. */
export async function deleteWidget(context: RequestContext, widgetId: string): Promise<boolean> {
  const deleted = await db
    .delete(dashboardWidgets)
    .where(scopedWhere(context, dashboardWidgets, eq(dashboardWidgets.id, widgetId)))
    .returning({ id: dashboardWidgets.id })
  return deleted.length > 0
}

export interface WidgetLayoutInput {
  readonly id: string
  readonly size: WidgetSize
  readonly position: number
}

export type SaveLayoutOutcome =
  | { readonly kind: "ok"; readonly revision: number }
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict" }

/**
 * The whole compare-and-set, one transaction, entirely inside this
 * function — never split across a helper that takes a `tx` parameter, the
 * pattern every other transactional repository function in this codebase
 * already follows (e.g. imports/repository/dataset-version-repository.ts).
 *
 * The revision bump is the `UPDATE`'s own predicate
 * (`revision = expectedRevision`), never a preceding `SELECT`
 * (dashboards/CLAUDE.md "saveLayout's compare-and-set") — that's what
 * makes two concurrent callers with the same `expectedRevision` unable to
 * both win. The loser's `UPDATE` matches no row; a follow-up scoped
 * `SELECT` *inside the same transaction* then tells "no such dashboard"
 * (`not_found`) apart from "revision already moved" (`conflict`). Widget
 * writes only happen after the bump succeeds, so they're serialized behind
 * the same row lock.
 */
export async function saveDashboardLayout(
  context: RequestContext,
  dashboardId: string,
  expectedRevision: number,
  widgets: readonly WidgetLayoutInput[],
): Promise<SaveLayoutOutcome> {
  return db.transaction(async (tx) => {
    const [bumped] = await tx
      .update(dashboards)
      .set({ revision: sql`${dashboards.revision} + 1`, updatedAt: new Date() })
      .where(
        scopedWhere(
          context,
          dashboards,
          eq(dashboards.id, dashboardId),
          eq(dashboards.revision, expectedRevision),
        ),
      )
      .returning({ revision: dashboards.revision })

    if (!bumped) {
      const [current] = await tx
        .select({ id: dashboards.id })
        .from(dashboards)
        .where(scopedWhere(context, dashboards, eq(dashboards.id, dashboardId)))
        .limit(1)
      return current ? { kind: "conflict" } : { kind: "not_found" }
    }

    for (const widget of widgets) {
      // oxlint-disable-next-line no-await-in-loop -- each write is a small, independent UPDATE inside the same CAS transaction, serialized behind the row lock the bump above already took; sequencing has no correctness requirement of its own here (unlike loadDashboard's widget executions), it's simply the natural shape for a handful of rows.
      await tx
        .update(dashboardWidgets)
        .set({ size: widget.size, position: widget.position })
        .where(
          and(
            scopedWhere(context, dashboardWidgets, eq(dashboardWidgets.id, widget.id)),
            eq(dashboardWidgets.dashboardId, dashboardId),
          ),
        )
    }

    return { kind: "ok", revision: bumped.revision }
  })
}
