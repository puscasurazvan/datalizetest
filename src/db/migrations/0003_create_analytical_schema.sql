-- Creates the `analytical` schema that holds runtime-created, per-Dataset-Version
-- physical tables (docs/adr/0002). Hand-written, not drizzle-kit generated: those
-- physical tables must never be declared in a Drizzle schema file — drizzle.config.ts's
-- schemaFilter: ["public"] is what keeps drizzle-kit from diffing this schema and
-- emitting DROP TABLE for live customer data (see src/db/CLAUDE.md).
--
-- Table and column creation inside this schema is owned entirely by
-- src/modules/analytical-store at runtime, never by a migration.
CREATE SCHEMA IF NOT EXISTS analytical;