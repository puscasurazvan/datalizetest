import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { env } from "@/shared/env"
import * as schema from "./schema"

/**
 * Application pool: Better Auth, dataset metadata, imports, jobs, audit.
 * Analytical queries never run here — see `./analytical.ts`.
 */
const pool = new Pool({
  connectionString: env().DATABASE_URL,
  max: 10,
})

export const db = drizzle(pool, { schema })
export const applicationPool = pool
