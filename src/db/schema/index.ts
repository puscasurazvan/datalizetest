/**
 * Drizzle schema for the `public` application schema.
 *
 * Per-version analytical tables live in the `analytical` schema, are created at
 * runtime by the analytical store, and must never be declared here — see
 * `schemaFilter` in drizzle.config.ts and docs/adr/0002.
 */

// Phase A (auth): Better Auth's tables — see src/modules/auth/auth.ts.
export * from "./auth"

// Tables are added in Phase A (auth) and Phase B (datasets, imports).
