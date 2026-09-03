/**
 * Runs one compiled query on a single `analyticalPool` client and maps a
 * Postgres failure to the `AppError` code the caller-facing surface expects
 * (queries/CLAUDE.md "Limits & execution", docs/decisions/05 §(c)).
 *
 * The whole recipe lives here, on one client, in this order: `BEGIN` ->
 * `SET LOCAL statement_timeout` -> up to 5 advisory-lock attempts
 * (./execution-slots) -> the query itself -> `COMMIT`, with `ROLLBACK` in
 * `catch` and `client.release()` in `finally` no matter which step failed.
 * An advisory **transaction** lock (`pg_try_advisory_xact_lock`) needs no
 * manual unlock — it releases itself at `COMMIT` or `ROLLBACK` — so there
 * is no unlock step an early return could skip.
 *
 * `postgres-store.ts` is the only caller (it owns tenancy checks and
 * `compileQuery`); this file never reaches back into it, to keep the
 * dependency one-directional.
 */
import type { PoolClient } from "pg"
import { DatabaseError } from "pg"

import { ANALYTICAL_STATEMENT_TIMEOUT_MS, analyticalPool } from "@/db/analytical"
import { AppError } from "@/shared/errors"

import type { CompiledQuery } from "./compile-query"
import { slotKeys } from "./execution-slots"
import type { AnalyticalRow } from "./types"

export interface RunQueryResult {
  readonly rows: readonly AnalyticalRow[]
  readonly durationMs: number
}

/**
 * Every cell comes back `::text` from `compileQuery`, so a value is a
 * string or null — the same shape `readRows` returns and the same reason
 * (docs/decisions/06 #11: a `decimal` must not become a JS number).
 * `keys` is `compileQuery`'s SELECT order (dimensions then measures), so
 * position `i` here always names position `i` there.
 */
function toRowByKeys(keys: readonly string[], values: readonly unknown[]): AnalyticalRow {
  const row: Record<string, string | null> = {}
  keys.forEach((key, index) => {
    const value = values[index]
    row[key] = typeof value === "string" ? value : null
  })
  return row
}

/**
 * Wraps an unexpected driver failure so its `.message` — which can and does
 * name a physical table (`relation "analytical.dv_..." does not exist`) —
 * never becomes this function's own thrown error's message. Mirrors
 * `postgres-store.ts`'s `safeStoreError` in behavior; kept as a separate,
 * local definition rather than an import from that file, since
 * `postgres-store.ts` is the one that imports *this* file for `runQuery` —
 * importing back would make the two files a cycle.
 */
function unexpectedExecutionError(cause: unknown): Error {
  return new Error("Could not execute the query against the dataset version's table.", { cause })
}

/**
 * Classifies a failure raised mid-transaction into the `AppError` this
 * module's callers expect (G4). Only a real `DatabaseError` (a SQLSTATE
 * from the server) is classified — `57014` (`query_canceled`, what the
 * pool/session statement timeout raises) to `QUERY_TIMEOUT`, the `22*`
 * class (data exceptions — e.g. a filter value that doesn't parse as its
 * column's type) to `VALIDATION`. Anything else, including a non-driver
 * error, falls through to `unexpectedExecutionError`, matching
 * `safeStoreError`'s "never trust the raw message" rule. Exported for its
 * own unit test — this is the one branch in this file with no I/O.
 */
export function toExecutionError(error: unknown): Error {
  if (error instanceof DatabaseError && error.code !== undefined) {
    if (error.code === "57014") {
      return new AppError("QUERY_TIMEOUT", "This query took too long and was cancelled.", {
        cause: error,
      })
    }
    if (error.code.startsWith("22")) {
      return new AppError("VALIDATION", "A filter value does not match its column's type.", {
        cause: error,
      })
    }
  }
  return unexpectedExecutionError(error)
}

/**
 * Attempts each of the Organization's 5 lock slots in order and returns on
 * the first success — no retry, no queue (docs/decisions/05 §(c)): a 6th
 * concurrent query fails fast rather than waiting. Must run inside the
 * transaction whose `COMMIT`/`ROLLBACK` will release whichever slot it
 * takes; `pg_try_advisory_xact_lock` never blocks, so 5 attempts costs one
 * fast round-trip each, never a wait.
 */
async function acquireExecutionSlot(client: PoolClient, organizationId: string): Promise<void> {
  for (const { key1, key2 } of slotKeys(organizationId)) {
    // oxlint-disable-next-line no-await-in-loop -- deliberately sequential and stops on first success: each attempt must observe the previous one's outcome, and running all 5 in parallel would hold no more locks but cost more round-trips on the common (uncontended) path.
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1::int4, $2::int4) AS locked",
      [key1, key2],
    )
    if (result.rows[0]?.locked === true) return
  }
  throw new AppError(
    "CONCURRENCY_LIMIT",
    "This workspace already has 5 queries running. Try again shortly.",
  )
}

/**
 * Runs `compiled` against `analyticalPool`, gated by `organizationId`'s
 * advisory-lock slot, and zips its `rowMode: "array"` result back to
 * `keys`.
 */
export async function runQuery(
  organizationId: string,
  compiled: CompiledQuery,
  keys: readonly string[],
): Promise<RunQueryResult> {
  const client = await analyticalPool.connect()
  // Only a rollback that itself fails leaves the connection's state
  // unknown — every other rejection here (CONCURRENCY_LIMIT before any
  // query ran, a clean 57014/22* mid-transaction) is followed by a
  // successful ROLLBACK, so the connection is fine to return to the pool.
  // `client.release(true)` — unlike `loadRows`'s COPY-stream precedent,
  // where the stream itself can leave the connection genuinely unknown —
  // would otherwise pay a TCP reconnect on every single query failure,
  // including the routine CONCURRENCY_LIMIT case the 5-slot cap exists to
  // make common at the product's own concurrency ceiling.
  let poisoned = false
  try {
    await client.query("BEGIN")
    // Belt and braces on top of the pool-level timeout (db/analytical.ts,
    // which applies even to a client that forgets BEGIN): this is the
    // documented per-execution recipe (queries/CLAUDE.md) and holds even if
    // a future pool reconfiguration ever raises the pool-level default.
    await client.query(`SET LOCAL statement_timeout = ${ANALYTICAL_STATEMENT_TIMEOUT_MS}`)
    await acquireExecutionSlot(client, organizationId)

    // Brackets only the query call, per ExecuteResult's doc — not BEGIN,
    // the lock attempts, or COMMIT, so this is "how long the query took,"
    // not connection/lock overhead.
    const startedAt = Date.now()
    const result = await client.query({
      text: compiled.text,
      values: [...compiled.values],
      rowMode: "array",
    })
    const durationMs = Date.now() - startedAt

    await client.query("COMMIT")
    return { rows: result.rows.map((values) => toRowByKeys(keys, values)), durationMs }
  } catch (error) {
    try {
      await client.query("ROLLBACK")
    } catch {
      poisoned = true
    }
    if (error instanceof AppError) throw error
    throw toExecutionError(error)
  } finally {
    client.release(poisoned)
  }
}
