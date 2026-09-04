import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { analyticalPool, importPool } from "@/db/analytical"
import { applicationPool, db } from "@/db/client"
import {
  analyticalColumns,
  analyticalTables,
  dashboardWidgets,
  dashboards,
  datasetColumns,
  datasets,
  datasetVersions,
  organizations,
  queryExecutions,
  savedQueries,
  users,
} from "@/db/schema"
import { PostgresAnalyticalStore } from "@/modules/analytical-store"
import type { AnalyticalColumnDefinition, AnalyticalRow } from "@/modules/analytical-store"
import {
  addWidget,
  getOrCreateDefaultDashboard,
  loadDashboard,
  removeWidget,
  saveLayout,
} from "@/modules/dashboards"
import { createTestRequestContext } from "@/shared/context/testing"

// End-to-end coverage of the dashboards module against the real test
// database — the default-dashboard bootstrap, sequential widget execution
// with independent per-widget failure, the layout compare-and-set, and
// tenant isolation (dashboards/CLAUDE.md). Saved queries are seeded with a
// direct `db.insert(savedQueries)` rather than the sibling `createSavedQuery`
// service, so this suite exercises only this module's own contract and
// stays decoupled from that module's own validation strictness.
describe("dashboards (integration)", () => {
  const store = new PostgresAnalyticalStore()
  const runId = randomUUID()
  const userId = randomUUID()
  const organizationId = randomUUID()
  const context = createTestRequestContext({
    userId,
    organizationId,
    role: "owner",
    organizationTimezone: "America/Chicago",
  })

  const otherOrganizationId = randomUUID()
  const otherContext = createTestRequestContext({
    userId,
    organizationId: otherOrganizationId,
    role: "owner",
    organizationTimezone: "UTC",
  })

  const createdVersionIds: string[] = []
  const createdOrganizationIds = [organizationId, otherOrganizationId]

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      name: "Dashboards Test User",
      email: `dashboards-${runId}@example.test`,
      emailVerified: true,
    })
    await db.insert(organizations).values([
      { id: organizationId, name: "Dashboards Test Org", slug: `dashboards-${runId}` },
      { id: otherOrganizationId, name: "Dashboards Other Org", slug: `dashboards-other-${runId}` },
    ])
  })

  afterAll(async () => {
    for (const versionId of createdVersionIds) {
      // oxlint-disable-next-line no-await-in-loop -- test teardown, not a hot path; dropVersion drops one physical table at a time.
      await store.dropVersion(context, versionId)
    }
    for (const orgId of createdOrganizationIds) {
      // oxlint-disable-next-line no-await-in-loop -- test teardown, sequential is simplest here.
      await db.delete(dashboardWidgets).where(eq(dashboardWidgets.organizationId, orgId))
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await db.delete(dashboards).where(eq(dashboards.organizationId, orgId))
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await db.delete(queryExecutions).where(eq(queryExecutions.organizationId, orgId))
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await db.delete(savedQueries).where(eq(savedQueries.organizationId, orgId))
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await db.delete(datasetColumns).where(eq(datasetColumns.organizationId, orgId))
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await db.delete(analyticalColumns).where(eq(analyticalColumns.organizationId, orgId))
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await db.delete(analyticalTables).where(eq(analyticalTables.organizationId, orgId))
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await db.delete(datasetVersions).where(eq(datasetVersions.organizationId, orgId))
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await db.delete(datasets).where(eq(datasets.organizationId, orgId))
    }
    await db.delete(organizations).where(eq(organizations.id, organizationId))
    await db.delete(organizations).where(eq(organizations.id, otherOrganizationId))
    await db.delete(users).where(eq(users.id, userId))
    await importPool.end()
    await analyticalPool.end()
    await applicationPool.end()
  })

  const COL_QTY = "col_qty"

  /** A complete, queryable Dataset Version — mirrors queries/service.integration.test.ts's helper. */
  async function seedDataset(
    columns: readonly AnalyticalColumnDefinition[],
    rows: readonly AnalyticalRow[],
  ): Promise<{ datasetId: string; versionId: string }> {
    const datasetId = randomUUID()
    const versionId = randomUUID()

    await db.insert(datasets).values({
      id: datasetId,
      organizationId,
      name: `Dashboards Test Dataset ${datasetId}`,
      createdByUserId: userId,
    })
    await db.insert(datasetVersions).values({
      id: versionId,
      organizationId,
      datasetId,
      versionNumber: 1,
      status: "COMPLETED",
      rowCount: rows.length,
      columnCount: columns.length,
      timezoneUsedForNaiveTimestamps: "UTC",
      completedAt: new Date(),
    })
    await db.update(datasets).set({ currentVersionId: versionId }).where(eq(datasets.id, datasetId))
    await db.insert(datasetColumns).values(
      columns.map((column, index) => ({
        id: randomUUID(),
        columnId: column.columnId,
        organizationId,
        datasetVersionId: versionId,
        name: column.columnId,
        type: column.type,
        nullable: false,
        position: index,
      })),
    )

    await store.createVersionTable(context, versionId, columns)
    await store.loadRows(context, versionId, rowsFrom(rows))
    createdVersionIds.push(versionId)

    return { datasetId, versionId }
  }

  /** A count-all Saved Query against `datasetId` — always resolves, whatever the current schema. */
  async function seedSavedQuery(
    datasetId: string,
    name: string,
    ast: Record<string, unknown> = {
      version: 1,
      datasetId,
      dimensions: [],
      measures: [{ field: null, aggregation: "count", alias: "n" }],
      filters: [],
    },
  ): Promise<string> {
    const id = randomUUID()
    await db.insert(savedQueries).values({
      id,
      organizationId,
      datasetId,
      name,
      queryAst: ast,
      visualization: { type: "table" },
      createdBy: userId,
    })
    return id
  }

  it("gives the Organization one dashboard, created once and reused", async () => {
    const first = await getOrCreateDefaultDashboard(context)
    const second = await getOrCreateDefaultDashboard(context)

    expect(second.id).toBe(first.id)
    expect(second.name).toBe("Dashboard")
    expect(second.revision).toBe(first.revision)
  })

  it("adds and removes widgets, and loads them in position order", async () => {
    const { datasetId } = await seedDataset(
      [{ columnId: COL_QTY, type: "integer" }],
      [{ [COL_QTY]: "1" }, { [COL_QTY]: "2" }],
    )
    const dashboard = await getOrCreateDefaultDashboard(context)
    const savedQueryA = await seedSavedQuery(datasetId, `Widget A ${randomUUID()}`)
    const savedQueryB = await seedSavedQuery(datasetId, `Widget B ${randomUUID()}`)

    await addWidget(context, { dashboardId: dashboard.id, savedQueryId: savedQueryA, size: "half" })
    await addWidget(context, { dashboardId: dashboard.id, savedQueryId: savedQueryB, size: "full" })

    const loaded = await loadDashboard(context, dashboard.id)
    const added = loaded.widgets.filter(
      (widget) => widget.savedQueryId === savedQueryA || widget.savedQueryId === savedQueryB,
    )
    expect(added.map((widget) => widget.savedQueryId)).toEqual([savedQueryA, savedQueryB])
    for (const widget of added) {
      expect(widget.outcome.kind).toBe("ok")
    }

    const widgetAId = added[0]?.id
    if (!widgetAId) throw new Error("expected widget A to have been added")
    await removeWidget(context, widgetAId)

    const afterRemoval = await loadDashboard(context, dashboard.id)
    expect(afterRemoval.widgets.some((widget) => widget.id === widgetAId)).toBe(false)
    expect(afterRemoval.widgets.some((widget) => widget.savedQueryId === savedQueryB)).toBe(true)
  })

  it("a SCHEMA_INCOMPATIBLE widget renders an error outcome while its siblings still return data", async () => {
    const { datasetId } = await seedDataset(
      [{ columnId: COL_QTY, type: "integer" }],
      [{ [COL_QTY]: "1" }],
    )
    const dashboard = await getOrCreateDefaultDashboard(context)

    const healthySavedQueryId = await seedSavedQuery(datasetId, `Healthy ${randomUUID()}`)
    const brokenSavedQueryId = await seedSavedQuery(datasetId, `Broken ${randomUUID()}`, {
      version: 1,
      datasetId,
      dimensions: [{ columnId: "col_removed" }],
      measures: [{ field: null, aggregation: "count", alias: "n" }],
      filters: [],
    })

    await addWidget(context, {
      dashboardId: dashboard.id,
      savedQueryId: healthySavedQueryId,
      size: "third",
    })
    await addWidget(context, {
      dashboardId: dashboard.id,
      savedQueryId: brokenSavedQueryId,
      size: "third",
    })

    const loaded = await loadDashboard(context, dashboard.id)
    const healthy = loaded.widgets.find((widget) => widget.savedQueryId === healthySavedQueryId)
    const broken = loaded.widgets.find((widget) => widget.savedQueryId === brokenSavedQueryId)

    expect(healthy?.outcome.kind).toBe("ok")
    expect(broken?.outcome).toMatchObject({
      kind: "error",
      code: "SCHEMA_INCOMPATIBLE",
      message: expect.stringContaining("col_removed"),
    })
  })

  it("a stale saveLayout is refused with CONFLICT, never silently applied", async () => {
    const { datasetId } = await seedDataset(
      [{ columnId: COL_QTY, type: "integer" }],
      [{ [COL_QTY]: "1" }],
    )
    const dashboard = await getOrCreateDefaultDashboard(context)
    const savedQueryId = await seedSavedQuery(datasetId, `Layout ${randomUUID()}`)
    await addWidget(context, { dashboardId: dashboard.id, savedQueryId, size: "third" })

    const loaded = await loadDashboard(context, dashboard.id)
    const widget = loaded.widgets.find((entry) => entry.savedQueryId === savedQueryId)
    if (!widget) throw new Error("expected the widget just added to be present")

    const firstSave = await saveLayout(context, {
      dashboardId: dashboard.id,
      expectedRevision: loaded.revision,
      widgets: [{ id: widget.id, size: "full", position: 0 }],
    })
    expect(firstSave.revision).toBe(loaded.revision + 1)

    await expect(
      saveLayout(context, {
        dashboardId: dashboard.id,
        // Stale: the revision this same caller already saw before, now behind by one.
        expectedRevision: loaded.revision,
        widgets: [{ id: widget.id, size: "half", position: 0 }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" })

    // The stale attempt's "half" never landed — the successful save's "full" still stands.
    const afterConflict = await loadDashboard(context, dashboard.id)
    const stillFull = afterConflict.widgets.find((entry) => entry.id === widget.id)
    expect(stillFull?.size).toBe("full")
  })

  it("another Organization's dashboard is NOT_FOUND, never a cross-tenant read", async () => {
    const dashboard = await getOrCreateDefaultDashboard(context)

    await expect(loadDashboard(otherContext, dashboard.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
    await expect(removeWidget(otherContext, randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })
})

function rowsFrom(rows: readonly AnalyticalRow[]): AsyncIterable<AnalyticalRow> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) {
        yield row
      }
    },
  }
}
