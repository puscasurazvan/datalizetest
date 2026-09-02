# Datalize Query Limits — MVP Behavior

This document defines the three hard query limits required by Review #11 and §15 of Datalize.md. These limits are enforced by the query compiler and execution engine.

---

## Decision Summary

| Limit                                                   | Value           | Rationale                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) Max rows returned to UI**                         | **10,000 rows** | Product-wide cap, not a per-request setting. Compile `LIMIT min(requestedLimit, 10000) + 1`, drop the extra row if present. `truncated: true` ONLY when the 10,000 cap did the cutting — a user's own smaller `limit`, honoured exactly, never sets it. Low end of the "10k–50k" range; §34 already forbids rendering 10k DOM rows, so anything above this is only reachable by export (not in MVP). |
| **(b) Statement timeout (interactive query execution)** | **30 seconds**  | Long enough for a 1M-row aggregate on an indexed Postgres table, short enough that interactive connections do not hold resources indefinitely. Scoped to interactive query execution on the interactive analytical pool — the import pool sets its own, much longer `statement_timeout` for `import.load` at pool construction; see [decisions/06 #16](./06-slice-1-implementation-defaults.md).     |
| **(c) Max concurrent executions per org**               | **5**           | Enough for one dashboard's widgets to load in parallel, low enough that one analyst cannot exhaust the interactive analytical pool for their whole workspace. Excess requests fail immediately with a structured error (no queuing).                                                                                                                                                                 |

---

## (a) Max Rows Returned to UI — 10,000

### Limit

**10,000 rows maximum** per query result returned to the UI. This is a product-wide cap on rows returned, not a per-request setting — a request can ask for fewer, never more.

### Four Values, Not One

The row-limit logic only makes sense once these are named separately. They are never the same number except by coincidence:

| Name             | Meaning                                                                                                          | Formula                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `requestedLimit` | What the user asked for, or the 10,000 cap when the AST supplies no `limit`.                                     | `userLimit ?? 10000`            |
| `effectiveLimit` | `requestedLimit`, clamped to the product cap — never more than 10,000 rows leave Postgres.                       | `min(requestedLimit, 10000)`    |
| `engineLimit`    | What reaches SQL: `effectiveLimit` plus one probe row, so the compiler can detect "more exist" without guessing. | `effectiveLimit + 1`            |
| `returnedRows`   | What the caller gets. Never exceeds `requestedLimit`.                                                            | `rows.slice(0, effectiveLimit)` |

Two booleans follow from the same probe row, and they answer different questions:

- **`hasMore`** — the engine saw a row beyond `effectiveLimit`. True whenever there was more data, regardless of why the cut happened.
- **`truncated`** — `hasMore` is true **and** the cut was the 10,000 product cap (`effectiveLimit === 10000`), not the user's own smaller `limit`. A `limit: 50` request that has a 51st row sets `hasMore: true` and `truncated: false` — the user got exactly what they asked for; the UI has no truncation banner to show, though it may still offer "load more" using `hasMore`.

`truncated` means one thing only: _the 10,000-row product cap removed rows the user did not ask to limit._ It never means _you asked for 50 and got 50._

### Enforcement

The query compiler appends a `LIMIT` clause to every query, sized to `engineLimit`:

```sql
-- User query (no explicit limit — requestedLimit defaults to 10,000)
-- currency filter required: an unfiltered SUM(amount) over the mixed-currency
-- transactions fixture is refused — see decisions/01's currency rule.
SELECT date_trunc('month', created_at AT TIME ZONE 'UTC') AS month,
       SUM(amount) AS total_amount
FROM dataset_transactions_v1
WHERE currency = 'USD'
GROUP BY month
ORDER BY month;

-- Compiled query (engineLimit = min(10000, 10000) + 1)
SELECT date_trunc('month', created_at AT TIME ZONE 'UTC') AS month,
       SUM(amount) AS total_amount
FROM dataset_transactions_v1
WHERE currency = 'USD'
GROUP BY month
ORDER BY month
LIMIT 10001;
```

A `limit: 50` request compiles `LIMIT 51` (`engineLimit = min(50, 10000) + 1`), not `LIMIT 10001` — the probe row rides on the user's own limit, not the product cap.

**Why the +1 probe row?**

With `LIMIT effectiveLimit`, a result of exactly `effectiveLimit` rows is **indistinguishable** from a result that had more behind it. By compiling `LIMIT effectiveLimit + 1`:

- If `engineLimit` rows come back, drop the extra row, set `hasMore: true`, and set `truncated` to whether `effectiveLimit` was the 10,000 cap
- If fewer than `engineLimit` rows come back, `hasMore: false` and `truncated: false`

This makes both flags **computable** rather than guessed, at any `requestedLimit`.

### Default Ordering, and Why Truncation Needs It

`LIMIT` without `ORDER BY` returns _some_ `effectiveLimit` rows — Postgres does not guarantee which ones, and a re-run can return a different set. `truncated: true` would then describe an arbitrary sample, not "the first N by some rule," which is not useful to a user deciding whether to refine their query. Truncation is only meaningful when the rows kept and the rows dropped are determined by an explicit order.

When the AST's `orderBy` is empty, the compiler applies a default so every compiled query is deterministically ordered:

- If the query has at least one measure, order by the **first measure, descending**.
- Otherwise (dimension-only queries, e.g. distinct values), order by the **first dimension, ascending**.

An explicit `orderBy` overrides this default entirely; see "`orderBy` References" below for what it may contain.

### Result Contract

Every query result carries the values above:

```ts
type QueryResult = {
  columns: Array<{ name: string; type: string }>
  rows: Array<Record<string, unknown>>
  rowCount: number // Always equals rows.length (i.e. returnedRows.length)
  truncated: boolean // true ONLY when the 10,000-row product cap removed rows
  hasMore: boolean // true when the engine saw a row beyond effectiveLimit, for any reason
  durationMs: number // Measured with timestamps around client.query()
  queryId: string
  executedAt: string
}
```

**Implementation:**

```ts
async function executeQuery(compiledQuery: string, requestedLimit: number): Promise<QueryResult> {
  const startedAt = Date.now()
  const result = await analyticalPool.query(compiledQuery)
  const durationMs = Date.now() - startedAt

  const effectiveLimit = Math.min(requestedLimit, 10000)

  let rows = result.rows
  const hasMore = rows.length > effectiveLimit // the probe row came back
  if (hasMore) {
    rows = rows.slice(0, effectiveLimit)
  }
  const truncated = hasMore && effectiveLimit === 10000

  return {
    columns: result.fields.map((f) => ({ name: f.name, type: getColumnType(f.name) })),
    rows,
    rowCount: rows.length,
    truncated,
    hasMore,
    durationMs,
    queryId: generateId(),
    executedAt: new Date().toISOString(),
  }
}
```

`compiledQuery` is built with `LIMIT effectiveLimit + 1` (`engineLimit`), as shown above; `requestedLimit` is passed through unchanged so this function trims to the user's own limit, never to a hard-coded 10,000.

If `truncated === true`, the UI must display:

> "This result was truncated to 10,000 rows. Refine your query or export the full dataset."

### Why 10,000, Not 50,000?

- §34 of Datalize.md explicitly forbids rendering 10k DOM rows ("Never render 10,000 DOM rows")
- TanStack Virtual handles large datasets, but 10k rows is already a heavy payload for the browser
- Export functionality (which would allow larger result sets) is **not in the MVP**
- A truncated chart that says it is truncated beats a 50k-row payload nobody can read

If users need more than 10k rows, they should:

- Add filters to narrow the result
- Aggregate at a higher granularity (e.g., month instead of day)
- Export the data (post-MVP feature)

---

## (b) Statement Timeout — 30 Seconds (Interactive Query Execution)

### Limit

**30 seconds maximum** per statement on the **interactive analytical pool** — the pool that runs ad-hoc and saved query execution. This is not a property of "the analytical pool" in general: there are three pools (interactive analytical, import, application — see [decisions/06 #16](./06-slice-1-implementation-defaults.md)), and the 30s figure governs interactive query execution only. DDL and row loading for imports run on the import pool, which sets its own, much longer `statement_timeout` for `import.load` at pool construction — a pool that cancels every statement at 30s would cancel every load.

### Enforcement

The interactive analytical pool is configured with a default `statement_timeout`:

```ts
// Pool configuration
const analyticalPool = new Pool({
  // ... connection config
  statement_timeout: 30000, // 30 seconds — interactive query execution only
})
```

Alternatively, set it per-transaction using `SET LOCAL`:

```ts
await client.query("BEGIN")
await client.query("SET LOCAL statement_timeout = 30000")
const result = await client.query(compiledQuery, parameters)
await client.query("COMMIT")
```

If the query exceeds 30 seconds, Postgres cancels it and returns an error:

```ts
type QueryTimeoutError = {
  code: "QUERY_TIMEOUT"
  message: "Query exceeded 30 second timeout. Refine your query or contact support."
  durationMs: number
}
```

### Why 30 Seconds?

- **Long enough** for a 1M-row aggregate on an indexed Postgres table (typical MVP interactive workload)
- **Short enough** that interactive connections do not hold resources indefinitely
- Prevents a single pathological query from blocking the interactive analytical pool for other users
- Not weakened to accommodate imports — imports get their own pool with its own, longer timeout, rather than a per-session override on this one; see [decisions/06 #16](./06-slice-1-implementation-defaults.md)

### UI Behavior

On timeout, the widget or query builder shows:

> "This query took too long (>30s). Try adding filters, reducing the date range, or aggregating at a higher granularity (e.g., month instead of day)."

---

## (c) Max Concurrent Executions Per Organization — 5

### Limit

**5 concurrent query executions maximum** per organization on the interactive analytical pool.

### Enforcement — PostgreSQL Advisory Transaction Locks

Use **Postgres advisory transaction locks** (`pg_try_advisory_xact_lock`) rather than a database-backed semaphore or Redis. Use the **two-argument `pg_try_advisory_xact_lock(key1 int4, key2 int4)` form**, keyed on the organization hash and the slot number separately — a single-bigint key truncated to 32 bits lets unrelated organizations share a slot pool and breaks the "5 per organization" guarantee this section exists to state (see [decisions/06 #18](./06-slice-1-implementation-defaults.md)):

```ts
import { createHash } from "crypto"

function orgLockKeys(organizationId: string, slot: number): [number, number] {
  // Full 64 bits of the hash are in play: key1 from the first 4 bytes,
  // key2 from the next 4 bytes XORed with the slot number (1-5).
  const hash = createHash("sha256").update(organizationId).digest()
  const key1 = hash.readInt32BE(0)
  const key2 = hash.readInt32BE(4) ^ slot
  return [key1, key2]
}

async function acquireExecutionSlot(client: PoolClient, organizationId: string): Promise<void> {
  // Try to acquire one of 5 advisory transaction locks (n = 1..5)
  for (let slot = 1; slot <= 5; slot++) {
    const [key1, key2] = orgLockKeys(organizationId, slot)

    const lockResult = await client.query<{ pg_try_advisory_xact_lock: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1::int4, $2::int4)`,
      [key1, key2],
    )

    if (lockResult.rows[0].pg_try_advisory_xact_lock) {
      // Lock acquired - no manual release needed, releases on COMMIT/ROLLBACK
      return
    }
  }

  // All 5 locks held by other queries
  throw new ConcurrencyLimitError({
    code: "CONCURRENCY_LIMIT",
    message: "Too many concurrent queries. Please wait and try again.",
  })
}
```

**Key properties:**

- **Atomic**: `pg_try_advisory_xact_lock` succeeds or fails in one statement
- **Automatic release**: Locks release automatically on `COMMIT` or `ROLLBACK`
- **No manual unlock**: No `slot.release()` to call, no leak on exception
- **No lease tuning**: No 45-second lease to tune against the 30-second timeout
- **No orphan rows**: No cleanup queries, no expiry logic, no crash leaks
- **Transaction-scoped**: Lock is held for the duration of the transaction

### Usage Pattern

```ts
async function executeQueryWithLimits(
  organizationId: string,
  compiledQuery: string, // already compiled with LIMIT engineLimit, see (a)
  requestedLimit: number,
): Promise<QueryResult> {
  const client = await analyticalPool.connect()

  try {
    await client.query("BEGIN")
    await client.query("SET LOCAL statement_timeout = 30000")

    // Acquire concurrency slot (advisory transaction lock)
    await acquireExecutionSlot(client, organizationId)

    try {
      // Execute query (statement_timeout already set)
      const startedAt = Date.now()
      const result = await client.query(compiledQuery)
      const durationMs = Date.now() - startedAt

      // Trim to the user's own requestedLimit, not to the 10,000 cap — see (a)
      const effectiveLimit = Math.min(requestedLimit, 10000)
      let rows = result.rows
      const hasMore = rows.length > effectiveLimit
      if (hasMore) {
        rows = rows.slice(0, effectiveLimit)
      }
      const truncated = hasMore && effectiveLimit === 10000

      await client.query("COMMIT")

      return {
        columns: result.fields.map((f) => ({ name: f.name, type: getColumnType(f.name) })),
        rows,
        rowCount: rows.length,
        truncated,
        hasMore,
        durationMs,
        queryId: generateId(),
        executedAt: new Date().toISOString(),
      }
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  } finally {
    client.release()
  }
}
```

### Why Advisory Transaction Locks?

- **Simplicity**: One statement, atomic, no race conditions
- **No state management**: No lease expiry, no cleanup queries, no orphan rows
- **Crash-safe**: If the worker crashes, the transaction rolls back and locks release automatically
- **No Redis dependency**: MVP uses Postgres only; Redis can be added later if needed
- **Exception-safe**: An exception between acquire and commit cannot leak the lock

### Why Fail Fast, Not Queue?

Excess requests **fail immediately** with `CONCURRENCY_LIMIT` — no queuing:

- Queued requests still occupy a serverless function (Vercel or similar)
- A 30-second queue would waste function runtime on requests that will ultimately timeout
- Fail-fast gives immediate feedback to the user, who can retry or refine their query
- The UI implements exponential backoff for retries (e.g., 1s, 2s, 4s, 8s)

### UI Behavior

On concurrency limit exceeded:

> "Too many queries running at once. Please wait a moment and try again."

The UI should implement exponential backoff for retries (e.g., 1s, 2s, 4s, 8s).

---

## Query Result Contract — Additional Decisions

### Count with No Field — Count-All

A measure with `aggregation: 'count'` and `field: null` means **count all rows**:

```ts
type Measure = {
  field: string | null // null means count-all
  aggregation: "count" | "count_distinct" | "sum" | "avg" | "min" | "max"
  alias?: string
}
```

**Example:**

```ts
{
  datasetId: 'transactions',
  dimensions: [{ field: 'status' }],
  measures: [{ field: null, aggregation: 'count', alias: 'total_transactions' }],
}
```

Compiles to:

```sql
SELECT status, COUNT(*) AS total_transactions
FROM dataset_transactions_v1
GROUP BY status;
```

---

### `orderBy` References — a Discriminated Reference, Not a Bare Field String

Each `orderBy` entry is a **discriminated reference** — it names either a dimension Column ID or a measure alias, tagged so the compiler never has to guess which:

- `{ kind: "dimension", columnId }` — a dimension **Column ID** (e.g., `created_at`, `status`)
- `{ kind: "measure", alias }` — a measure **alias** (e.g., `total_amount`, `avg_amount`)

**Nothing else** (no arbitrary expressions, no column indexes, no bare `field: string`).

```ts
type OrderBy =
  | { kind: "dimension"; columnId: string; direction: "asc" | "desc" }
  | { kind: "measure"; alias: string; direction: "asc" | "desc" }
```

**Example:**

```ts
{
  dimensions: [{ field: 'created_at', granularity: 'month' }],
  measures: [{ field: 'amount', aggregation: 'sum', alias: 'total_amount' }],
  filters: [{ field: 'currency', operator: 'eq', value: 'USD' }],
  orderBy: [{ kind: 'measure', alias: 'total_amount', direction: 'desc' }],
}
```

Compiles to (currency filter required — an unfiltered `SUM(amount)` over the mixed-currency transactions fixture is refused, see decisions/01's currency rule):

```sql
SELECT date_trunc('month', created_at AT TIME ZONE 'UTC') AS month,
       SUM(amount) AS total_amount
FROM dataset_transactions_v1
WHERE currency = 'USD'
GROUP BY month
ORDER BY total_amount DESC;
```

**Invalid:**

```ts
// Bare field string is rejected — must be a discriminated { kind, ... } reference
orderBy: [{ field: "total_amount", direction: "desc" }] // Rejected

// Cannot order by arbitrary expression
orderBy: [{ kind: "measure", alias: "SUM(amount)", direction: "desc" }] // Rejected

// Cannot order by column index
orderBy: [{ kind: "dimension", columnId: "2", direction: "desc" }] // Rejected
```

An empty `orderBy` is valid, not an omission to reject — see "Default Ordering, and Why Truncation Needs It" under (a) for what the compiler applies instead.

---

### Total Group Count and Ranking for Capped Displays (docs/decisions/06 #12)

A widget that shows only some of a grouped result — a bar chart's "showing top 50 of N" — needs two things, and this contract supplies both without an extra query:

- **Which rows are "top."** The default-ordering rule under (a) guarantees that a query with no explicit `orderBy` arrives sorted by its first measure, descending. The first 50 rows of `rows` are then legitimately the top 50 by that measure. A query with an explicit `orderBy` inherits whatever order it names; if that order is not the charted measure descending, the widget may show the first 50 rows but must not call them "top."
- **N, the total group count.** `rowCount` on this same result _is_ the total group count. A display cap of 50 categories sits far below the 10,000-row product cap, so the full grouped result the widget caps for display is already present in `rows` — the display cap is a rendering decision, never an additional `LIMIT` at the query layer. When `truncated` is true (more than 10,000 groups exist), the exact total is unknown; the widget must show "10,000+", never a fabricated number.

This only holds when the query behind the widget carries no `limit` below the true number of groups — a `limit: 50` request makes `rowCount` equal 50, not the group count, and "top 50 of 50" is not what the widget means to say. Keeping bar-chart-backing queries unlimited (up to the 10,000 cap) is the visualization module's responsibility; this document guarantees only that `rowCount` and row order are trustworthy when it does.

---

## Summary Table

| Limit                                               | Value              | Enforced By                                                                                                                      | UI Behavior on Exceed                                                        |
| --------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Max rows returned**                               | 10,000 rows        | Query compiler uses `LIMIT min(requestedLimit, 10000) + 1`, drops extra row if present                                           | "Result truncated to 10,000 rows" (only when the 10,000 cap did the cutting) |
| **Statement timeout (interactive query execution)** | 30 seconds         | Interactive analytical pool `statement_timeout` or `SET LOCAL` — the import pool sets its own, longer timeout (decisions/06 #16) | "Query took too long (>30s)"                                                 |
| **Max concurrent executions**                       | 5 per organization | Postgres advisory transaction locks, two-argument `pg_try_advisory_xact_lock(key1, key2)` form (atomic, auto-release on COMMIT)  | "Too many concurrent queries" (fail fast, no queue)                          |

---

## Implications for Slice 1

The query compiler and execution spike must explicitly test:

1. **Row limit** compiles `LIMIT min(requestedLimit, 10000) + 1`, drops the extra row if present, and sets `truncated: true` ONLY when the 10,000 cap did the cutting. Required cases, each checked against `returnedRows`, `truncated`, and `hasMore`:
   - `limit: 0` → `returnedRows: []`, `hasMore` reflects whether any row exists, `truncated: false`
   - `limit: 1` → at most 1 row back; `truncated: false` even if `hasMore: true`
   - `limit: 50` on a 51+ row dataset → exactly 50 rows back, `hasMore: true`, `truncated: false`
   - `limit: 10000` (or no limit, which defaults to it) on a 10,001+ row dataset → exactly 10,000 rows back, `hasMore: true`, `truncated: true`
   - `limit: 50000` (above the cap) → still capped at 10,000 rows back; `effectiveLimit` is 10,000, not 50,000, so the same `truncated: true` case applies
   - Each case above must be run against a dataset with a deterministic default order (no explicit `orderBy`), since `truncated` and `hasMore` are only meaningful when which rows were kept is well-defined — see "Default Ordering" under (a)
2. **Statement timeout** is configured on the interactive analytical pool (or via `SET LOCAL`)
3. **Concurrency limit** uses the two-argument `pg_try_advisory_xact_lock(key1, key2)` form with 5 slots per organization
4. **UI error states** display clear, actionable messages for each limit type
5. **Count-all** (`field: null`) compiles to `COUNT(*)`
6. **`orderBy` validation** rejects bare field strings, arbitrary expressions, and column indexes — only the discriminated `{ kind: "dimension", columnId }` / `{ kind: "measure", alias }` references are accepted

These limits are core to the MVP's reliability and cannot be deferred.

---

## Notes on Future Adjustments

These limits are **MVP defaults** and can be adjusted based on usage data:

- **Max rows**: Increase to 25k or 50k if users consistently hit the limit and performance is acceptable
- **Statement timeout (interactive)**: Increase to 60s if interactive queries on 1M-row datasets consistently timeout — independent of the import pool's own timeout (decisions/06 #16)
- **Concurrency limit**: Increase to 10 if dashboards with 10+ widgets are common and the infrastructure can handle it

Any change to these limits should be:

- **Plan-aware** (higher limits for paid tiers)
- **Logged** (track how often limits are hit)
- **Communicated** (update UI messages and documentation)

For the MVP, these three numbers are the baseline.

---

## Implementation Notes

### Vercel Function Timeouts

Vercel function timeout limits have changed over time. Verify against current Vercel documentation when building the analytical pool rather than relying on stated limits in this document.

### rowCount Semantics

`rowCount` always equals `rows.length`. `hasMore` indicates that at least one additional row existed beyond `rowCount`, for any reason. `truncated` is the narrower claim that the 10,000-row product cap — not the caller's own `limit` — is why those rows are missing; see "Four Values, Not One" under (a).

### Advisory Lock Hashing

The `orgLockKeys` function hashes the organization ID with SHA-256 and splits the digest into two `int4` keys for the two-argument `pg_try_advisory_xact_lock(key1, key2)` form — `key1` from the first 4 bytes, `key2` from the next 4 bytes XORed with the slot number (1-5). This ensures:

- Consistent lock keys for the same organization
- The full 64 bits of the hash are in play, not 32 — two unrelated organizations now collide only if both independently-derived 32-bit halves collide, at a negligible rate for any realistic organization count, preserving the "5 per organization" guarantee this section states

### Duration Measurement

`durationMs` is measured with timestamps around the `client.query()` call, not from `result.commandDuration` (which does not exist on node-postgres).

### Column Type Mapping

Column types in the result are derived from the Dataset Version's column metadata (which uses Datalize's type vocabulary: `string`, `integer`, `decimal`, `boolean`, `date`, `timestamptz`), not from Postgres's `dataTypeID` OIDs.

### Performance Note

Acquiring an advisory lock requires up to 5 sequential round-trips per query (one per slot attempt). At MVP scale this is acceptable. If latency becomes a concern, a single statement over `generate_series(1, 5)` can collapse this into one round-trip.
