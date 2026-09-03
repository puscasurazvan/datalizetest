/**
 * How many physical tables an Organization still has registered.
 *
 * `analytical_tables.dataset_version_id` is `ON DELETE RESTRICT`, so deleting
 * a workspace that still owns loaded data is refused by Postgres itself — a
 * foreign-key violation, correct but opaque, surfacing to the user as a raw
 * database error. This lets the delete path refuse first, with a message that
 * names the reason.
 *
 * It returns a count and nothing else: a physical table name never leaves this
 * module (docs/adr/0002), and the caller has no use for one anyway.
 */
import { eq, sql } from "drizzle-orm"

import { db } from "@/db/client"
import { analyticalTables } from "@/db/schema"

export async function countRegisteredTables(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(analyticalTables)
    .where(eq(analyticalTables.organizationId, organizationId))

  return row?.count ?? 0
}
