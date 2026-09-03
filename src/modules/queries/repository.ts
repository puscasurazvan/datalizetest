/**
 * `query_executions` writes — the audit trail for every execution, success
 * or failure (queries/CLAUDE.md "Audit & resolution", docs/decisions/02 §
 * "Every `query_executions` row includes", 03, 04). Runs on the
 * APPLICATION pool (`db`), never `analyticalPool` — this table lives in
 * the `public` schema, not `analytical`, and is written by `service.ts`,
 * not by the store.
 */
import { db } from "@/db/client"
import { queryExecutions } from "@/db/schema"
import type { RequestContext } from "@/shared/context/request-context"
import { withOrganizationId } from "@/shared/repository"

export interface NewQueryExecution {
  readonly datasetVersionId: string
  readonly organizationTimezone: string
  readonly status: "success" | "failed"
  readonly startedAt: Date
  readonly completedAt: Date
  readonly durationMs: number
  /** Nullable: a failed execution has no row count to report — `0` would misstate a query that never ran to completion. */
  readonly rowCount: number | null
  readonly errorCode: string | null
}

/** Returns the new row's id — `QueryResult.queryId` on the success path (query-result.ts). */
export async function insertQueryExecution(
  context: RequestContext,
  execution: NewQueryExecution,
): Promise<string> {
  const [row] = await db
    .insert(queryExecutions)
    .values(withOrganizationId(context, { userId: context.userId, ...execution }))
    .returning({ id: queryExecutions.id })
  if (!row) {
    // Unreachable: a successful single-row INSERT ... RETURNING always
    // returns exactly one row.
    throw new Error("invariant violated: insert into query_executions returned no row")
  }
  return row.id
}
