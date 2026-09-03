import { Pool } from "pg"

import { env } from "@/shared/env"
import { createLogger } from "@/shared/observability/logger"

/**
 * Analytical pool. Separate from the application pool so a slow or runaway
 * dataset query cannot starve authentication, dashboards, or job bookkeeping.
 *
 * `statement_timeout` is set at the pool level rather than per query: it must
 * apply even to a code path that forgets to open a transaction.
 * See docs/decisions/05-query-limits.md.
 */
export const ANALYTICAL_STATEMENT_TIMEOUT_MS = 30_000

export const analyticalPool = new Pool({
  connectionString: env().ANALYTICAL_DATABASE_URL,
  max: 10,
  statement_timeout: ANALYTICAL_STATEMENT_TIMEOUT_MS,
})

const logger = createLogger()

// See src/db/client.ts for why this listener is required: pg-pool emits
// `'error'` on the pool when an idle pooled client fails, and an
// EventEmitter with no `'error'` listener throws that error as an uncaught
// exception, which here would take down every in-flight interactive query.
analyticalPool.on("error", (error) => {
  logger.error("analytical pool: idle client error", { error })
})

/**
 * Import pool. A second, independently constructed `pg.Pool` against the
 * same database as `analyticalPool` above — NOT a `SET LOCAL` override on
 * the interactive pool (docs/decisions/06 #16): that would hold one of the
 * interactive pool's 10 connections for up to 10 minutes and defeat the
 * reason `ANALYTICAL_STATEMENT_TIMEOUT_MS` is set at pool level in the
 * first place — it must apply even to a code path that forgets to open a
 * transaction.
 *
 * `import.load` (src/modules/analytical-store) creates each Dataset
 * Version's physical table (DDL) and loads its rows here, never on
 * `analyticalPool`. 10 minutes is double the <=5 min pass bar
 * docs/decisions/06 #15 sets for a 50 MB / 1M row load — a circuit
 * breaker, not a target. The interactive pool's 30s timeout is NOT
 * weakened to accommodate this; the two constants are independent.
 */
export const IMPORT_STATEMENT_TIMEOUT_MS = 600_000

// max: 2 — Slice 1 runs one load per Organization at a time by product
// design, not by lock contention (docs/decisions/06 #16); the import pool
// is not subject to the interactive pool's 5-per-organization advisory
// lock (docs/decisions/05 §c), concurrency here is bounded by Trigger.dev's
// own task/queue settings instead.
export const importPool = new Pool({
  connectionString: env().ANALYTICAL_DATABASE_URL,
  max: 2,
  statement_timeout: IMPORT_STATEMENT_TIMEOUT_MS,
})

// Same idle-client-error hazard as analyticalPool above — a distinct pool
// instance needs its own listener, one does not cover the other.
importPool.on("error", (error) => {
  logger.error("import pool: idle client error", { error })
})
