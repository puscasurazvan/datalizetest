CREATE TYPE "public"."dataset_column_type" AS ENUM('string', 'integer', 'decimal', 'boolean', 'date', 'timestamptz');--> statement-breakpoint
CREATE TYPE "public"."dataset_version_status" AS ENUM('PENDING', 'QUEUED', 'PROFILING', 'AWAITING_CONFIRMATION', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."import_row_error_code" AS ENUM('UNPARSEABLE_VALUE', 'AMBIGUOUS_LOCAL_TIME', 'NONEXISTENT_LOCAL_TIME', 'FIELD_COUNT_MISMATCH', 'ENCODING');--> statement-breakpoint
CREATE TABLE "analytical_columns" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"dataset_version_id" text NOT NULL,
	"column_id" text NOT NULL,
	"physical_name" text NOT NULL,
	"pg_type" text NOT NULL,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytical_tables" (
	"dataset_version_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"schema_name" text NOT NULL,
	"table_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dropped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dataset_columns" (
	"id" text PRIMARY KEY NOT NULL,
	"column_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"dataset_version_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "dataset_column_type" NOT NULL,
	"nullable" boolean NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"dataset_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"status" "dataset_version_status" NOT NULL,
	"row_count" integer,
	"column_count" integer,
	"timezone_used_for_naive_timestamps" text NOT NULL,
	"schema_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"current_version_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_errors" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"import_id" text NOT NULL,
	"row_number" bigint NOT NULL,
	"column_name" text,
	"error_code" "import_row_error_code" NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"dataset_id" text NOT NULL,
	"dataset_version_id" text,
	"idempotency_key" text NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content_type" text NOT NULL,
	"status" "dataset_version_status" NOT NULL,
	"proposed_schema" jsonb,
	"confirmed_schema" jsonb,
	"job_run_id" text,
	"rows_read" integer,
	"rows_imported" integer,
	"rows_rejected" integer,
	"error_code" text,
	"error_message" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytical_columns" ADD CONSTRAINT "analytical_columns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_columns" ADD CONSTRAINT "analytical_columns_dataset_version_id_analytical_tables_dataset_version_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."analytical_tables"("dataset_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_tables" ADD CONSTRAINT "analytical_tables_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_tables" ADD CONSTRAINT "analytical_tables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_columns" ADD CONSTRAINT "dataset_columns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_columns" ADD CONSTRAINT "dataset_columns_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_versions" ADD CONSTRAINT "dataset_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_versions" ADD CONSTRAINT "dataset_versions_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_current_version_id_dataset_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytical_columns_organization_id_idx" ON "analytical_columns" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytical_columns_organization_version_physical_name_idx" ON "analytical_columns" USING btree ("organization_id","dataset_version_id","physical_name");--> statement-breakpoint
CREATE UNIQUE INDEX "analytical_columns_organization_version_column_idx" ON "analytical_columns" USING btree ("organization_id","dataset_version_id","column_id");--> statement-breakpoint
CREATE INDEX "analytical_tables_organization_id_idx" ON "analytical_tables" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytical_tables_table_name_idx" ON "analytical_tables" USING btree ("table_name");--> statement-breakpoint
CREATE INDEX "dataset_columns_organization_id_idx" ON "dataset_columns" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_columns_organization_version_column_idx" ON "dataset_columns" USING btree ("organization_id","dataset_version_id","column_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_columns_organization_version_name_idx" ON "dataset_columns" USING btree ("organization_id","dataset_version_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_columns_organization_version_position_idx" ON "dataset_columns" USING btree ("organization_id","dataset_version_id","position");--> statement-breakpoint
CREATE INDEX "dataset_versions_organization_id_idx" ON "dataset_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_versions_organization_dataset_version_idx" ON "dataset_versions" USING btree ("organization_id","dataset_id","version_number");--> statement-breakpoint
CREATE INDEX "datasets_organization_id_idx" ON "datasets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_errors_organization_id_idx" ON "import_errors" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "imports_organization_id_idx" ON "imports" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "imports_organization_idempotency_key_idx" ON "imports" USING btree ("organization_id","idempotency_key");