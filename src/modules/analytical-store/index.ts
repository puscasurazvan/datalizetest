/**
 * Public surface of src/modules/analytical-store (docs/adr/0002). Exports
 * only the write-surface interface, its Postgres implementation, and the
 * types built for physical-name-free returns (./types.ts) — never
 * `typeof analyticalTables.$inferSelect` / `typeof
 * analyticalColumns.$inferSelect` from `@/db/schema`, which carry
 * `tableName` / `physicalName`. Import those two tables directly from
 * `@/db/schema` only from inside this module.
 */
export { PostgresAnalyticalStore } from "./postgres-store"
export type {
  AnalyticalColumnDefinition,
  AnalyticalColumnType,
  AnalyticalRow,
  AnalyticalStore,
  AnalyticalTableSummary,
  ExecuteResult,
  LoadRowsResult,
  ReadRowsResult,
} from "./types"
export { ANALYTICAL_COLUMN_TYPES } from "./types"
