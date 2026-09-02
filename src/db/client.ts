import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { env } from "@/shared/env"
import { createLogger } from "@/shared/observability/logger"
import * as schema from "./schema"

/**
 * Application pool: Better Auth, dataset metadata, imports, jobs, audit.
 * Analytical queries never run here — see `./analytical.ts`.
 */
const pool = new Pool({
  connectionString: env().DATABASE_URL,
  max: 10,
})

const logger = createLogger()

// pg-pool emits `'error'` on the pool itself when an *idle* pooled client
// fails (a Postgres restart, `pg_terminate_backend`, a proxy dropping an
// idle connection). An EventEmitter with no listener for `'error'` throws
// that error out of `emit()` as an uncaught exception — outside `next
// start`'s own handler (the vitest integration process, a Trigger.dev
// worker, a bare serverless instance) that takes the whole process down
// with it. Logging and moving on is correct: pg-pool has already dropped
// the failed client from the pool by the time this fires.
pool.on("error", (error) => {
  logger.error("application pool: idle client error", { error })
})

export const db = drizzle(pool, { schema })
export const applicationPool = pool
