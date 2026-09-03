/**
 * The shape `executeQuery` hands back to a Route Handler (docs/decisions/05
 * "Result Contract"). Not a Zod schema — nothing parses this, `service.ts`
 * builds it directly from a `ResolvedQuery` and a store `ExecuteResult`, so
 * there is no untrusted boundary here to validate against.
 *
 * `columns[i].name` is always `rows[*]`'s key at that same position — a
 * Column ID for a grouped dimension, a measure's own `alias` otherwise —
 * mirroring `ExecuteResult.keys`' order (dimensions then measures) so a
 * caller can zip the two without a second lookup.
 */
import type { AnalyticalRow } from "@/modules/analytical-store"

import type { DatalizeColumnType } from "../internal/validator"

export interface QueryResultColumn {
  readonly name: string
  readonly type: DatalizeColumnType
}

export interface QueryResult {
  readonly columns: readonly QueryResultColumn[]
  readonly rows: readonly AnalyticalRow[]
  /** Always `rows.length` (docs/decisions/05). */
  readonly rowCount: number
  /** `true` only when the 10,000-row product cap cut the result — never a smaller user `limit` honoured exactly. */
  readonly truncated: boolean
  /** `true` whenever the engine saw a row beyond `effectiveLimit`, for any reason. */
  readonly hasMore: boolean
  /** Measured with timestamps around the store's `client.query()` call — see `ExecuteResult.durationMs`. */
  readonly durationMs: number
  /** The `query_executions` row this run wrote (docs/full-documentation-audit.md's `queryId` ambiguity, resolved this way — plan section 5 step 10). */
  readonly queryId: string
  /** `startedAt.toISOString()` — when the user ran the query, not when the audit row was written. */
  readonly executedAt: string
}
