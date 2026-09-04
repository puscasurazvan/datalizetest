/**
 * `query_executions` — the audit trail for every ad-hoc query run against a
 * Dataset Version's analytical table (docs/decisions/02 "Every
 * `query_executions` row includes", docs/decisions/03, docs/decisions/04).
 * `saved_queries` — a persisted, re-runnable QueryAst + VisualizationConfig,
 * the foundation the dashboards slice is built on. Written by
 * src/modules/queries; this file only declares the shape.
 *
 * `organizationId` is `onDelete: "cascade"` and indexed on its own, per
 * CLAUDE.md's non-negotiable "every tenant-owned row carries
 * organization_id" — the reference architecture's own sketch
 * (docs/reference/Datalize.md) omits both, but the project rule wins.
 *
 * `datasetVersionId` is `onDelete: "cascade"`, NOT `restrict` like
 * `analyticalTables.datasetVersionId` above: this table only records that a
 * query ran against a version, it does not gate whether the version's
 * physical table may be dropped, and every integration suite deletes
 * `datasetVersions` in `afterAll` — `restrict` here would wedge that
 * teardown permanently after the first query test.
 *
 * `organizationTimezone` is NOT NULL on every row, success or failure
 * (docs/decisions/03/04): a query executed before a later timezone change
 * must still show the zone actually applied at the time.
 *
 * `rowCount` is nullable, deliberately: a failed execution has no row count
 * to report, and `0` would misstate a query that never ran to completion.
 * `errorCode` is a nullable AppErrorCode string, not a Postgres enum — the
 * error vocabulary lives in src/shared/errors and this table only records
 * whichever code was thrown, never re-derives or constrains it.
 *
 * `savedQueryId` is `onDelete: "set null"`, NOT cascade: deleting a saved
 * query must never erase the historical record that it was once executed —
 * the row simply stops naming which saved query it came from, exactly like
 * `imports.datasetVersionId` above preserves import history after its
 * version is gone.
 */
import { randomUUID } from "node:crypto"

import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

import { organizations, users } from "./auth"
import { datasets, datasetVersions } from "./datasets"

export const queryExecutionStatusEnum = pgEnum("query_execution_status", ["success", "failed"])

/**
 * A Saved Query stores `datasetId`, never a version (docs/adr/0003,
 * docs/decisions/02(b)): it resolves to the Dataset's CURRENT version at
 * execution time, so `datasetId` is `onDelete: "cascade"` — a saved query
 * has no meaning once its Dataset is gone, unlike `queryExecutions` above
 * which records history against a specific, immutable version.
 *
 * `queryAst` and `visualization` are `jsonb`, deliberately untyped at the
 * schema layer (docs/adr/0002 "Queries are structured QueryAst" describes
 * the shape; this file only stores it). Every read must parse them with
 * `queryAstSchema` / `visualizationConfigSchema` — `.$type<T>()` would claim
 * a shape the compiler cannot check, which is a cast wearing a generic.
 *
 * Unique index on (organizationId, name): a saved query's name must be
 * unique within its own Organization, not globally.
 */
export const savedQueries = pgTable(
  "saved_queries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    queryAst: jsonb("query_ast").notNull(),
    visualization: jsonb("visualization").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("saved_queries_organization_id_idx").on(table.organizationId),
    uniqueIndex("saved_queries_organization_name_idx").on(table.organizationId, table.name),
  ],
)

export const queryExecutions = pgTable(
  "query_executions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    datasetVersionId: text("dataset_version_id")
      .notNull()
      .references(() => datasetVersions.id, { onDelete: "cascade" }),
    // Nullable: an ad-hoc, unsaved execution names no saved query at all.
    // "set null" per the file-level doc comment above.
    savedQueryId: text("saved_query_id").references(() => savedQueries.id, { onDelete: "set null" }),
    organizationTimezone: text("organization_timezone").notNull(),
    status: queryExecutionStatusEnum("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    rowCount: integer("row_count"),
    errorCode: text("error_code"),
  },
  (table) => [index("query_executions_organization_id_idx").on(table.organizationId)],
)
