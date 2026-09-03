/**
 * Drizzle table definitions for the Slice 1 logical and physical dataset
 * model — Dataset, Dataset Version, Dataset Column, Import, Import Error,
 * and the analytical store's own registry (Analytical Table, Analytical
 * Column). See docs/adr/0002, docs/decisions/01-06, and CONTEXT.md.
 *
 * Ownership split (do not blur this in code built on top of this file):
 * - `datasets` / `datasetVersions` / `datasetColumns` are the LOGICAL model
 *   (src/modules/datasets). They never carry a physical table or column
 *   name — only the opaque Column ID.
 * - `imports` / `importErrors` are the import lifecycle (src/modules/imports).
 * - `analyticalTables` / `analyticalColumns` are owned exclusively by
 *   src/modules/analytical-store. They are the ONLY place the Column ID ->
 *   physical name mapping lives (docs/adr/0002). Nothing else may read or
 *   write them directly.
 *
 * Tenancy: every table here carries `organization_id`, indexed on its own,
 * and `organization_id` leads every composite unique index below. This is
 * stricter than the minimum needed for correctness (e.g.
 * `dataset_versions`' natural key is `(dataset_id, version_number)`) but
 * matches the project-wide rule (CLAUDE.md) and means a caller must always
 * supply a verified `RequestContext`'s organization to satisfy `NOT NULL`,
 * never a bare cross-tenant lookup.
 *
 * IMPORTANT for callers using `onConflictDoNothing` / `onConflictDoUpdate`:
 * the `target` must name a unique index's columns exactly. The tuples below
 * are NOT the bare natural keys named in the Slice 1 task text — each has
 * `organizationId` prepended. See the index names for the exact column
 * order to pass as `target`.
 *
 * Circular FK: `datasets.currentVersionId` references `datasetVersions.id`,
 * and `datasetVersions.datasetId` references `datasets.id`. Both are
 * declared as normal Drizzle `.references()` calls (the `datasetVersions`
 * side needs an explicit `AnyPgColumn` return type only because it is
 * declared before `datasetVersions` exists as a value — see the comment at
 * that column). drizzle-kit resolves the cycle by emitting both `CREATE
 * TABLE`s first and then every FK as a separate `ALTER TABLE ... ADD
 * CONSTRAINT` statement, so the migration naturally lands the second FK in
 * an ALTER after both tables exist — no manual multi-migration split is
 * needed for this to work; the task's "second ALTER inside the same
 * migration" is what drizzle-kit's default output already does.
 */
import { randomUUID } from "node:crypto"

import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { organizations, users } from "./auth"

/**
 * Shared status vocabulary for `dataset_versions.status` and (per the Slice
 * 1 task text, "status (same vocabulary)") `imports.status`. One Postgres
 * enum type, reused by both columns, so the two can never drift apart.
 * Not every value is reachable on every table in practice (a
 * `dataset_versions` row's earliest reachable status is closer to
 * `RUNNING` than `PENDING`), but a shared type is what keeps them from
 * silently diverging as the import pipeline (docs/decisions/06 #1) evolves.
 */
export const datasetVersionStatusEnum = pgEnum("dataset_version_status", [
  "PENDING",
  "QUEUED",
  "PROFILING",
  "AWAITING_CONFIRMATION",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
])

/** The six canonical Datalize column types (docs/decisions/04). */
export const datasetColumnTypeEnum = pgEnum("dataset_column_type", [
  "string",
  "integer",
  "decimal",
  "boolean",
  "date",
  "timestamptz",
])

/** Row-level import error codes (docs/decisions/06 #4-6). */
export const importRowErrorCodeEnum = pgEnum("import_row_error_code", [
  "UNPARSEABLE_VALUE",
  "AMBIGUOUS_LOCAL_TIME",
  "NONEXISTENT_LOCAL_TIME",
  "FIELD_COUNT_MISMATCH",
  "ENCODING",
])

export const datasets = pgTable(
  "datasets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // Circular FK target: datasetVersions is declared below, after this
    // table, so it cannot be referenced as a value yet at this point in the
    // module — only its eventual type can. The explicit `AnyPgColumn`
    // return type breaks the "both consts depend on each other's inferred
    // type" cycle that would otherwise make tsc report `datasets` (and
    // everything built on it) as implicitly `any`.
    //
    // Nullable: a freshly created dataset has no completed version yet
    // (docs/decisions/02, /06 #1 — the version is created once import.load
    // has run against a confirmed schema), and `set null` lets a version
    // row be deleted without forcing every dataset that ever pointed at it
    // to be deleted too.
    currentVersionId: text("current_version_id").references((): AnyPgColumn => datasetVersions.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("datasets_organization_id_idx").on(table.organizationId)],
)

export const datasetVersions = pgTable(
  "dataset_versions",
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
    versionNumber: integer("version_number").notNull(),
    status: datasetVersionStatusEnum("status").notNull(),
    // Nullable: unknown until the load phase (import.load) has actually
    // read/written rows/columns against the confirmed schema.
    rowCount: integer("row_count"),
    columnCount: integer("column_count"),
    // NEVER NULL (docs/decisions/03: "timezoneUsedForNaiveTimestamps is
    // never null") — every version records the timezone actually applied
    // to naive-timestamp interpretation, org default or per-import
    // override, even when the import had no naive columns at all.
    timezoneUsedForNaiveTimestamps: text("timezone_used_for_naive_timestamps").notNull(),
    schemaHash: text("schema_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("dataset_versions_organization_id_idx").on(table.organizationId),
    // Natural key from the task text is (dataset_id, version_number);
    // organization_id leads per the tenancy rule above. Pass
    // `[table.organizationId, table.datasetId, table.versionNumber]` as an
    // `onConflictDoNothing`/`onConflictDoUpdate` target to match this index.
    uniqueIndex("dataset_versions_organization_dataset_version_idx").on(
      table.organizationId,
      table.datasetId,
      table.versionNumber,
    ),
  ],
)

export const datasetColumns = pgTable(
  "dataset_columns",
  {
    // Surrogate primary key. Deliberately NOT columnId below: columnId is
    // reused across dataset_versions when a column's name and type are
    // unchanged (CONTEXT.md "Column ID"), so it cannot be this table's
    // primary key without colliding across the versions that share it.
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    // The opaque, server-generated Column ID (CONTEXT.md). Carried forward
    // into the next version only when name AND type are both unchanged.
    columnId: text("column_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    datasetVersionId: text("dataset_version_id")
      .notNull()
      .references(() => datasetVersions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: datasetColumnTypeEnum("type").notNull(),
    nullable: boolean("nullable").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    index("dataset_columns_organization_id_idx").on(table.organizationId),
    // Natural keys from the task text: (dataset_version_id, column_id),
    // (dataset_version_id, name), (dataset_version_id, position).
    // organization_id leads each per the tenancy rule above — match these
    // exact tuples in any onConflict target.
    uniqueIndex("dataset_columns_organization_version_column_idx").on(
      table.organizationId,
      table.datasetVersionId,
      table.columnId,
    ),
    uniqueIndex("dataset_columns_organization_version_name_idx").on(
      table.organizationId,
      table.datasetVersionId,
      table.name,
    ),
    uniqueIndex("dataset_columns_organization_version_position_idx").on(
      table.organizationId,
      table.datasetVersionId,
      table.position,
    ),
  ],
)

export const imports = pgTable(
  "imports",
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
    // Nullable: the version row is created once import.load runs against a
    // confirmed schema (docs/decisions/06 #1) — an import sitting at
    // AWAITING_CONFIRMATION has no version yet. `set null` rather than
    // cascade: deleting a version must not delete the historical import
    // record of how it got there.
    datasetVersionId: text("dataset_version_id").references(() => datasetVersions.id, {
      onDelete: "set null",
    }),
    // Derived server-side from the object key and dataset ID
    // (docs/decisions/06 #7) — never client-minted. Unique per organization.
    idempotencyKey: text("idempotency_key").notNull(),
    objectKey: text("object_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    // `bigint`, not `integer`: an object's real size is learned from
    // `StorageProvider.statObject` (src/modules/storage/s3.ts) before
    // `startImport` ever compares it against `MAX_UPLOAD_BYTES` — a `text`
    // column can only INSERT if the value fits, so an `integer` column
    // (max 2,147,483,647) would 500 on any upload past ~2 GB with an opaque
    // `numeric field overflow`, before the ceiling check ever gets to name
    // the bound and run. `mode: "number"` is safe: every value that reaches
    // this INSERT has already passed the `MAX_UPLOAD_BYTES` check (50 MB),
    // far inside `Number.MAX_SAFE_INTEGER`.
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    status: datasetVersionStatusEnum("status").notNull(),
    // Written by import.profile / overwritten by the user's confirmation
    // (docs/decisions/06 #1). Parsed with Zod at the boundary by the
    // imports module — left untyped here, this file does not own that shape.
    proposedSchema: jsonb("proposed_schema"),
    confirmedSchema: jsonb("confirmed_schema"),
    // Trigger.dev run ID once dispatched (docs/decisions/06 #17). Nullable:
    // unset until the request handler or reconciler's trigger() call returns.
    jobRunId: text("job_run_id"),
    rowsRead: integer("rows_read"),
    rowsImported: integer("rows_imported"),
    rowsRejected: integer("rows_rejected"),
    // Open, import-level failure vocabulary (e.g. a ceiling-exceeded code
    // naming which bound was hit — docs/decisions/01 "Ceiling Conflict").
    // Distinct from importErrors.errorCode below, which is a closed,
    // row-level enum.
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("imports_organization_id_idx").on(table.organizationId),
    // "idempotency_key (unique per organization)" from the task text —
    // organization_id already leads this tuple as part of its own stated
    // meaning, not just the tenancy rule above.
    uniqueIndex("imports_organization_idempotency_key_idx").on(
      table.organizationId,
      table.idempotencyKey,
    ),
  ],
)

export const importErrors = pgTable(
  "import_errors",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    importId: text("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    rowNumber: bigint("row_number", { mode: "number" }).notNull(),
    // Nullable: FIELD_COUNT_MISMATCH and ENCODING are row/file-level
    // failures with no single offending column to name.
    columnName: text("column_name"),
    errorCode: importRowErrorCodeEnum("error_code").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // No raw value column, deliberately (docs/decisions/06 #5): storing the
    // offending cell would put customer data in an application table and
    // in every Sentry breadcrumb that touches this row.
  },
  (table) => [index("import_errors_organization_id_idx").on(table.organizationId)],
)

/**
 * Owned exclusively by src/modules/analytical-store (docs/adr/0002). One
 * row per Dataset Version's physical table. `datasetVersionId` is this
 * table's own primary key, not a surrogate — the relationship to a Dataset
 * Version is exactly one-to-one-or-zero.
 *
 * `onDelete: "restrict"` on `datasetVersionId` is deliberate and differs
 * from every other FK to `datasetVersions.id` in this file: a Dataset
 * Version row must never be deletable while a live physical table is still
 * registered under it — that would orphan customer data nobody can find or
 * drop. The analytical store must explicitly drop the physical table and
 * set `droppedAt` (or delete this row) before the version row beneath it
 * can go away.
 *
 * `organizationId` is ALSO `onDelete: "restrict"`, not "cascade" — this is
 * the FK Postgres actually checks first when an `organizations` row is
 * deleted, and it is the one that must block that delete: a "cascade" here
 * would let the org-delete statement remove this row directly, which
 * satisfies (trivially, because the row is already gone) the `restrict` on
 * `datasetVersionId` above by the time the cascade reaches
 * `dataset_versions` — so the "restrict propagates transitively" claim this
 * comment used to make here does NOT hold with a cascading `organizationId`.
 * With `organizationId` itself `restrict`, deleting an `organizations` row
 * while any live physical table is still registered under it aborts the
 * whole statement; the caller must call `AnalyticalStore.dropVersion` for
 * every registered table first. `organization:delete` is a real, reachable
 * permission (src/modules/auth/policy.ts's matrix) with no such explicit
 * drop-then-delete flow implemented yet — an owner deleting a workspace
 * that holds a completed import gets a raw Postgres foreign-key-violation
 * error today, not an `AppError` naming the reason. See this task's
 * `blockers`.
 */
export const analyticalTables = pgTable(
  "analytical_tables",
  {
    datasetVersionId: text("dataset_version_id")
      .primaryKey()
      .references(() => datasetVersions.id, { onDelete: "restrict" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    schemaName: text("schema_name").notNull(),
    tableName: text("table_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    droppedAt: timestamp("dropped_at", { withTimezone: true }),
  },
  (table) => [
    index("analytical_tables_organization_id_idx").on(table.organizationId),
    uniqueIndex("analytical_tables_table_name_idx").on(table.tableName),
  ],
)

/**
 * Owned exclusively by src/modules/analytical-store (docs/adr/0002). This
 * table, together with `analyticalTables` above, is the ONLY place the
 * Column ID -> physical column name mapping lives.
 *
 * `organizationId` is NOT in the Slice 1 task's enumerated column list for
 * this table, but is added here anyway: CLAUDE.md's "every tenant-owned
 * row carries organization_id" is stated as non-negotiable, and
 * `src/shared/repository.ts`'s `TenantScopedTable`/`scopedWhere` helpers
 * (which every module repository is built on) require the column to exist
 * on any table they scope. Omitting it here would mean
 * analytical-store — which docs/modules/analytical-store/CLAUDE.md
 * requires to take a `RequestContext` on every method — could not use the
 * shared scoping helper for its own table. This is a pure addition beyond
 * the enumerated list: every column the task named is present, unchanged.
 */
export const analyticalColumns = pgTable(
  "analytical_columns",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    datasetVersionId: text("dataset_version_id")
      .notNull()
      .references(() => analyticalTables.datasetVersionId, { onDelete: "cascade" }),
    columnId: text("column_id").notNull(),
    physicalName: text("physical_name").notNull(),
    pgType: text("pg_type").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    index("analytical_columns_organization_id_idx").on(table.organizationId),
    // Natural keys from the task text: (dataset_version_id, physical_name),
    // (dataset_version_id, column_id). organization_id leads each per the
    // tenancy rule above — match these exact tuples in any onConflict target.
    uniqueIndex("analytical_columns_organization_version_physical_name_idx").on(
      table.organizationId,
      table.datasetVersionId,
      table.physicalName,
    ),
    uniqueIndex("analytical_columns_organization_version_column_idx").on(
      table.organizationId,
      table.datasetVersionId,
      table.columnId,
    ),
  ],
)
