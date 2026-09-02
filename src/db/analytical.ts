import { Pool } from "pg"

import { env } from "@/shared/env"

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
