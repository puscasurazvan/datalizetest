/**
 * `query_executions` — the audit trail for every ad-hoc query run against a
 * Dataset Version's analytical table (docs/decisions/02 "Every
 * `query_executions` row includes", docs/decisions/03, docs/decisions/04).
 * Written by src/modules/queries; this file only declares the shape.
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
 */
import { randomUUID } from "node:crypto"

import { index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core"

import { organizations, users } from "./auth"
import { datasetVersions } from "./datasets"

export const queryExecutionStatusEnum = pgEnum("query_execution_status", ["success", "failed"])

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
