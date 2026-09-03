/**
 * Drizzle schema for the `public` application schema.
 *
 * Per-version analytical tables live in the `analytical` schema, are created at
 * runtime by the analytical store, and must never be declared here — see
 * `schemaFilter` in drizzle.config.ts and docs/adr/0002.
 */

// Phase A (auth): Better Auth's tables — see src/modules/auth/auth.ts.
export * from "./auth"

// Phase B: Dataset, Dataset Version, Dataset Column, Import, Import Error,
// and the analytical store's own registry — see src/db/schema/datasets.ts.
export * from "./datasets"

// Query pipeline: the query_executions audit trail — see src/db/schema/queries.ts.
export * from "./queries"
