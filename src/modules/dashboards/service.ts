/**
 * Dashboard orchestration: default-dashboard bootstrap, widget membership,
 * sequential widget execution, and the layout compare-and-set
 * (dashboards/CLAUDE.md). Authorization happens here, once, per
 * src/app/CLAUDE.md's chain — never left to the route layer.
 */
import { assertCan } from "@/modules/auth/policy"
import { toPolicyContext } from "@/modules/organizations"
import { executeSavedQuery } from "@/modules/queries"
import type { QueryResult } from "@/modules/queries"
import { getSavedQuery } from "@/modules/queries"
import type { VisualizationConfig } from "@/modules/visualizations"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError, toSafeDto } from "@/shared/errors"

import {
  deleteWidget,
  findDashboardById,
  findDashboardByName,
  insertDashboardIfAbsent,
  insertWidget,
  listWidgetRows,
  nextWidgetPosition,
  saveDashboardLayout,
} from "./repository"
import type { DashboardWidgetRow, WidgetLayoutInput, WidgetSize } from "./repository"

export type { WidgetSize } from "./repository"

/** Multi-dashboard UI is out of this slice (dashboards/CLAUDE.md); every Organization gets exactly this one, by name. */
const DEFAULT_DASHBOARD_NAME = "Dashboard"

export type WidgetOutcome =
  | {
      readonly kind: "ok"
      readonly result: QueryResult
      readonly datasetName: string
      readonly versionNumber: number
      readonly timezone: string
      readonly visualization: VisualizationConfig
    }
  | { readonly kind: "error"; readonly code: string; readonly message: string }

export interface DashboardWidgetView {
  readonly id: string
  readonly savedQueryId: string
  readonly name: string
  readonly size: WidgetSize
  readonly position: number
  readonly outcome: WidgetOutcome
}

export interface DashboardView {
  readonly id: string
  readonly name: string
  readonly revision: number
  readonly widgets: readonly DashboardWidgetView[]
}

/**
 * Any thrown value into a `WidgetOutcome` — an `AppError`'s code/message
 * pass through as-is, anything else is masked via the same `toSafeDto`
 * every client boundary uses. Exported for `service.test.ts` only — not
 * part of this module's public barrel (`./index.ts`).
 */
export function toErrorOutcome(error: unknown): WidgetOutcome {
  const safe = toSafeDto(error)
  return { kind: "error", code: safe.code, message: safe.message }
}

async function runWidget(context: RequestContext, row: DashboardWidgetRow): Promise<WidgetOutcome> {
  if (row.versionNumber === null) {
    // No current version to resolve against — the same fate
    // `executeSavedQuery` would independently reach, surfaced without
    // paying for the round trip: it always fails resolving the Dataset
    // Version before it could ever succeed.
    return {
      kind: "error",
      code: "SCHEMA_INCOMPATIBLE",
      message: "This dataset has no current version to run against.",
    }
  }

  try {
    const { savedQuery, result } = await executeSavedQuery(context, row.savedQueryId)
    return {
      kind: "ok",
      result,
      datasetName: row.datasetName,
      versionNumber: row.versionNumber,
      timezone: context.organizationTimezone,
      visualization: savedQuery.visualization,
    }
  } catch (error) {
    return toErrorOutcome(error)
  }
}

/**
 * Gives a workspace its one dashboard, creating it on first visit. Returns
 * the same dashboard on every subsequent call — `insertDashboardIfAbsent`
 * tolerates a concurrent first visit racing this one.
 */
export async function getOrCreateDefaultDashboard(
  context: RequestContext,
): Promise<{ id: string; name: string; revision: number }> {
  assertCan(toPolicyContext(context), "dataset:read")

  const existing = await findDashboardByName(context, DEFAULT_DASHBOARD_NAME)
  if (existing) return existing

  await insertDashboardIfAbsent(context, DEFAULT_DASHBOARD_NAME)
  const created = await findDashboardByName(context, DEFAULT_DASHBOARD_NAME)
  if (!created) {
    // Unreachable: the insert above either lands this row or loses a race
    // to one with the same (organizationId, name) — either way a row now
    // exists to find.
    throw new Error("invariant violated: default dashboard not found after insert")
  }
  return created
}

/**
 * Executes every widget's Saved Query SEQUENTIALLY, in position order
 * (dashboards/CLAUDE.md, docs/decisions/05(c)) — never `Promise.all`, so
 * a dashboard's own widgets can never exhaust the 5-execution-per-Organization
 * cap and refuse each other. Each widget fails independently: an `AppError`
 * (SCHEMA_INCOMPATIBLE, FORBIDDEN, CONCURRENCY_LIMIT, ...) becomes that
 * widget's own error outcome, never a thrown error for the whole page.
 */
export async function loadDashboard(
  context: RequestContext,
  dashboardId: string,
): Promise<DashboardView> {
  assertCan(toPolicyContext(context), "dataset:read")

  const dashboard = await findDashboardById(context, dashboardId)
  if (!dashboard) {
    throw new AppError("NOT_FOUND", "Dashboard not found.")
  }

  const rows = await listWidgetRows(context, dashboardId)

  const widgets: DashboardWidgetView[] = []
  for (const row of rows) {
    // oxlint-disable-next-line no-await-in-loop -- docs/decisions/05(c): a 5-execution-per-Organization concurrency cap means firing this dashboard's own widgets in parallel could exhaust the budget and refuse them against each other. Sequential is the requirement, not an oversight — see dashboards/CLAUDE.md.
    const outcome = await runWidget(context, row)
    widgets.push({
      id: row.id,
      savedQueryId: row.savedQueryId,
      name: row.name,
      size: row.size,
      position: row.position,
      outcome,
    })
  }

  return { id: dashboard.id, name: dashboard.name, revision: dashboard.revision, widgets }
}

export async function addWidget(
  context: RequestContext,
  input: { dashboardId: string; savedQueryId: string; size: WidgetSize },
): Promise<void> {
  assertCan(toPolicyContext(context), "query:save")

  const dashboard = await findDashboardById(context, input.dashboardId)
  if (!dashboard) {
    throw new AppError("NOT_FOUND", "Dashboard not found.")
  }
  // Fail fast with a clean NOT_FOUND for a bad/cross-tenant savedQueryId,
  // rather than surfacing a raw foreign-key violation from the insert below.
  await getSavedQuery(context, input.savedQueryId)

  const position = await nextWidgetPosition(context, input.dashboardId)
  await insertWidget(context, {
    dashboardId: input.dashboardId,
    savedQueryId: input.savedQueryId,
    size: input.size,
    position,
  })
}

export async function removeWidget(context: RequestContext, widgetId: string): Promise<void> {
  assertCan(toPolicyContext(context), "query:save")

  const deleted = await deleteWidget(context, widgetId)
  if (!deleted) {
    throw new AppError("NOT_FOUND", "Widget not found.")
  }
}

/**
 * Compare-and-set: throws `CONFLICT` when `expectedRevision` no longer
 * matches the stored one — someone else saved first, and this caller's
 * layout is built on a now-stale read. Never silently overwritten
 * (brief 4.8 §5, dashboards/CLAUDE.md).
 */
export async function saveLayout(
  context: RequestContext,
  input: {
    dashboardId: string
    expectedRevision: number
    widgets: readonly WidgetLayoutInput[]
  },
): Promise<{ revision: number }> {
  assertCan(toPolicyContext(context), "query:save")

  const outcome = await saveDashboardLayout(
    context,
    input.dashboardId,
    input.expectedRevision,
    input.widgets,
  )

  switch (outcome.kind) {
    case "ok":
      return { revision: outcome.revision }
    case "not_found":
      throw new AppError("NOT_FOUND", "Dashboard not found.")
    case "conflict":
      throw new AppError(
        "CONFLICT",
        "Someone else saved this dashboard's layout since you loaded it. Reload and try again.",
      )
  }
}
