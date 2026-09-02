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
