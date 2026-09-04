/**
 * `dashboards` and `dashboard_widgets` — a dashboard is a named, ordered
 * layout of widgets, each widget a Saved Query rendered at one of three
 * preset sizes on a 12-column grid (brief 4.8). Written by
 * src/modules/dashboards; this file only declares the shape.
 *
 * `dashboardWidgetSizeEnum`: "third" / "half" / "full" map to 4 / 6 / 12
 * grid columns respectively — the module owns that mapping, this enum only
 * names the three presets brief 4.8 allows. No arbitrary width: a widget
 * that could be any size is a layout the module would have to validate on
 * every save instead of by construction.
 *
 * `dashboards.revision` exists for optimistic-locking, not audit: brief 4.8
 * section 5's stale-save guard. `saveLayout` compares a caller-supplied
 * `expectedRevision` against the stored value inside one transaction and
 * throws `AppError("CONFLICT", ...)` on a mismatch, bumping `revision` on
 * success — a second browser tab's stale layout can never silently
 * overwrite a newer save.
 *
 * `dashboardWidgets.savedQueryId` is `onDelete: "cascade"`, the opposite of
 * `queryExecutions.savedQueryId`'s "set null": a widget's entire reason to
 * exist is the saved query it renders, so once that saved query is gone the
 * widget referencing it is not a thing to preserve — it must go with it, not
 * dangle pointing at nothing.
 */
import { randomUUID } from "node:crypto"

import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

import { organizations, users } from "./auth"
import { savedQueries } from "./queries"

export const dashboardWidgetSizeEnum = pgEnum("dashboard_widget_size", ["third", "half", "full"])

export const dashboards = pgTable(
  "dashboards",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    revision: integer("revision").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("dashboards_organization_id_idx").on(table.organizationId),
    uniqueIndex("dashboards_organization_name_idx").on(table.organizationId, table.name),
  ],
)

export const dashboardWidgets = pgTable(
  "dashboard_widgets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    dashboardId: text("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),
    savedQueryId: text("saved_query_id")
      .notNull()
      .references(() => savedQueries.id, { onDelete: "cascade" }),
    size: dashboardWidgetSizeEnum("size").notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("dashboard_widgets_organization_id_idx").on(table.organizationId),
    index("dashboard_widgets_dashboard_id_idx").on(table.dashboardId),
  ],
)
