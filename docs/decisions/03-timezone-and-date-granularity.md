# Datalize Timezone and Date Granularity — MVP Behavior

This document defines how Datalize handles timezones, date grouping, and week boundaries for the MVP. It resolves Review #11's open contract item: _"explicit timezone and date-granularity behavior."_

---

## Decision Summary

| Question               | Decision                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Timezone scope**     | One timezone per organization (IANA name, default `UTC`). Applied to all date grouping in queries.          |
| **Default**            | `UTC` for all new organizations.                                                                            |
| **Per-query timezone** | Not in MVP. Deferred to later when multi-region consultant workflows justify the complexity.                |
| **Week start**         | **Monday** (ISO 8601). Stated in chart axis labels, not configurable.                                       |
| **UI transparency**    | Chart footer shows the resolved timezone (e.g., "Grouped by month (UTC)") so numbers are never unexplained. |

---

## The Problem

The MVP persona's first query is **total transaction amount by month, filtered to a single currency**. The `transactions_stripe.csv` fixture has `created_at` in ISO 8601 UTC.

A London-based analyst viewing a transaction at `2026-12-31T23:30:00Z`:

- In UTC: this is **December 31, 2026 at 23:30** — December.
- In GMT (London, winter): GMT is UTC+0, so this is the identical wall-clock time as UTC — **December 31, 2026 at 23:30**, still December. Winter London never moves the date; it is not the case that breaks trust.
- In EST (New York, UTC−5): this is **December 31, 2026 at 18:30** — five hours earlier, still December.

None of those cross a month boundary. The case that actually breaks trust is an instant close to midnight UTC, where a negative offset pushes the wall clock back across the boundary:

A transaction at `2026-12-01T00:30:00Z`:

- In UTC: **December 1, 2026**
- In EST (New York, UTC−5): **November 30, 2026 at 19:30** — **November** vs **December**, a different calendar month, not just a different clock time.

Without explicit timezone handling:

- `date_trunc('month', created_at)` uses the **server's timezone**, which may differ from the user's
- Two analysts in the same workspace (one in London, one in New York) can get **different monthly revenue numbers** from the same dataset
- Neither will know why — the UI shows no timezone, the query has no timezone parameter

This breaks trust in the product's core value proposition.

---

## Three Kinds of Date/Time Value

"Date" is not one thing. Datalize distinguishes three kinds, and the difference is not optional — conflating them is exactly how the November/December drift above happens.

| Kind                        | What it is                                                           | Timezone conversion                                                                     | Storage                                       |
| --------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Calendar date**           | A day on a calendar; no time-of-day, no instant                      | Never — a calendar date is never passed through `AT TIME ZONE`                          | `date`                                        |
| **Offset-bearing datetime** | An absolute instant; the source value already carries its own offset | Already unambiguous. `AT TIME ZONE org_tz` only changes how it is displayed/grouped     | `timestamptz`                                 |
| **Naive datetime**          | A wall-clock value with no offset in the source data                 | Interpreted in the import timezone ONCE, at import time, to produce an absolute instant | `timestamptz`, after that one-time conversion |

- A **calendar date** (`2026-12-31`, no time-of-day) never moves. It names a day, not a point in time, so there is no instant to convert — `date_trunc` and `AT TIME ZONE` do not apply to it, and no organization timezone changes which day it is. Decision 04's inferred column types are exactly six — `string | integer | decimal | boolean | date | timestamptz` — and a column that is genuinely date-only (e.g. `signup_date`) is inferred as `date`: running it through `AT TIME ZONE` as if it were a naive datetime would shift the day for no reason. "Datetime" names an input shape, never a column type — every datetime-shaped input, offset-bearing or naive, becomes `timestamptz`.
- An **offset-bearing datetime** (`2026-12-31T23:30:00Z`, `2026-12-31T18:30:00-05:00`) already names a single point in time. Import stores it as `timestamptz` directly. The organization timezone only changes how that instant is _displayed and grouped_, never what instant it is.
- A **naive datetime** (`2026-12-31 23:30:00`, no offset) has no instant until Datalize picks one. Import interprets it in the import timezone — the organization's timezone by default, or the user's per-import override when they set one in the preview (decision 04) — at the moment of import, and stores the resulting instant as `timestamptz`. Because that interpretation happens once, at import, changing the organization's timezone later does not reinterpret already-imported naive values — it only changes how already-absolute instants (from any source) are grouped going forward.

### `timezoneUsedForNaiveTimestamps` is never null

`timezoneUsedForNaiveTimestamps: string` is declared non-nullable on every Dataset Version. It stays non-null even for a version whose CSV had no naive columns at all — it always records the timezone actually applied at that import: the organization's timezone by default, or the user's per-import override when they set one in the preview (decision 04). A version with no naive columns simply has a value that nothing was applied to; there is no null case to special-case in the compiler or in audit tooling.

### Timezone validation accepts canonical IANA names only

`assertKnownTimezone` checks against a curated allowlist of canonical IANA zone identifiers only (`Europe/London`, `America/New_York`), not raw membership in `pg_timezone_names`. It must reject:

- **PostgreSQL's fixed-offset abbreviations** (`EST`, `PST`) — these name a fixed offset, not a zone, and do not observe DST the way the IANA zone of the similar name does.
- **PostgreSQL's legacy aliases for a real zone** (e.g. `Asia/Calcutta` for `Asia/Kolkata`) — the alias resolves to the same zone today, but is not the identifier IANA tzdata treats as canonical, so it is a second name for the same fact rather than a distinct one.

`pg_timezone_names` lists both alongside canonical names, so the allowlist is a curated list of canonical identifiers, not the raw view — checking "is this row present in `pg_timezone_names`" is not sufficient on its own.

---

## Decision — Organization Timezone

### Schema

Add a `timezone` column to the `organizations` table:

```ts
type Organization = {
  id: string
  name: string
  timezone: string // IANA timezone name, e.g. "UTC", "Europe/London", "America/New_York"
  createdAt: string
  updatedAt: string
}
```

**Default:** `UTC` for all new organizations.

---

### Query Compiler Behavior

All date grouping uses the organization's timezone:

```sql
-- Before (unsafe, uses server timezone implicitly)
SELECT date_trunc('month', created_at) AS month, SUM(amount)
FROM dataset_transactions
WHERE currency = 'USD'
GROUP BY month;

-- After (explicit, uses org timezone)
SELECT date_trunc('month', created_at AT TIME ZONE org_tz) AS month, SUM(amount)
FROM dataset_transactions
WHERE currency = 'USD'
GROUP BY month;
```

In the query compiler:

```ts
function compileDateGrouping(
  column: string,
  granularity: Granularity,
  orgTimezone: string,
): string {
  // Postgres does not accept a bind parameter in the AT TIME ZONE position, so the
  // value is allowlisted rather than parameterised. `organizations.timezone` is
  // validated against the canonical IANA allowlist on write, and re-checked here. An
  // unrecognised timezone fails the query; it never falls back to a default.
  assertKnownTimezone(orgTimezone)
  return `date_trunc('${granularity}', ${column} AT TIME ZONE '${orgTimezone}')`
}
```

This ensures:

- All users in the same organization see **consistent numbers**
- The timezone is **explicit and auditable**
- Changing the organization's timezone updates all future queries (but does not retroactively change historical `query_executions` — those recorded the timezone at execution time)

---

### Why Not Per-Query Timezone?

Per-query timezone is a real feature for consultants managing clients in multiple regions, but it:

- Multiplies the **cache key** (same query + different timezone = different result)
- Expands the **AI tool surface** (AI must understand and respect per-query timezone)
- Complicates the **result contract** (which timezone was this chart rendered in?)
- Adds UI complexity (timezone picker on every query builder)

For the MVP persona (one company, one primary location), **organization-level timezone** is the right abstraction. Per-query timezone can be added later if usage patterns justify it.

---

## Week Start — ISO 8601 (Monday)

### Decision

**Weeks start on Monday** (ISO 8601), which is what `date_trunc('week', ...)` does in Postgres by default.

**Do not** make this configurable in the MVP.

---

### UI Labeling

Chart axis labels explicitly state the week convention:

```text
Revenue by Week (Monday start)
```

or:

```text
Signups by Week (ISO week, starts Monday)
```

This prevents confusion for US-based analysts who might expect Sunday-start weeks.

---

### Why Not Configurable?

- Adds a **query parameter** that multiplies cache keys
- Requires **AI awareness** (AI must generate queries with the correct week start)
- Introduces **inconsistent expectations** across widgets in the same dashboard
- Low value for MVP: most SaaS companies can align on ISO weeks

If users request Sunday-start weeks post-MVP, handle it as an **organization-level setting** (like timezone), not a per-query option.

---

## Granularity Support

The MVP supports these granularities:

```ts
type Granularity = "day" | "week" | "month" | "quarter" | "year"
```

All use the organization's timezone:

```sql
-- Day
date_trunc('day', created_at AT TIME ZONE org_tz)

-- Week (ISO, Monday start)
date_trunc('week', created_at AT TIME ZONE org_tz)

-- Month
date_trunc('month', created_at AT TIME ZONE org_tz)

-- Quarter
date_trunc('quarter', created_at AT TIME ZONE org_tz)

-- Year
date_trunc('year', created_at AT TIME ZONE org_tz)
```

---

## UI Transparency

### Chart Footer

Every chart that uses date grouping displays the resolved timezone in the footer:

```text
Grouped by month (UTC)
```

or:

```text
Grouped by week (Europe/London, Monday start)
```

This ensures:

- Numbers are **never unexplained**
- Users can **audit** why a transaction appears in a given month
- Changing the organization's timezone has **visible effects**

---

### Organization Settings

The organization settings page includes:

- **Timezone picker** (IANA timezone names)
- **Current value** displayed prominently
- **Warning** on change: "Changing this will affect how all date-based charts group data. Historical query results are not retroactively updated."

---

## Query Execution Audit

Every `query_executions` row records the timezone at execution time. This field is required, not optional — every stated benefit below depends on it being present on every row:

```ts
type QueryExecution = {
  id: string
  savedQueryId?: string // absent for ad-hoc builder and AI-generated queries
  datasetVersionId: string
  organizationTimezone: string // Snapshot of org.timezone at execution time
  status: "success" | "failed"
  startedAt: string
  completedAt: string
  durationMs: number
  rowCount: number
  errorCode?: string
}
```

This enables:

- Debugging: "This chart showed November revenue because the org timezone was UTC at execution time"
- Auditing: "After we changed the org timezone from UTC to America/New_York, December revenue shifted"

---

## Migration Path

### Existing Organizations

If the MVP launches with organizations already created:

```sql
-- Default all existing organizations to UTC
UPDATE organizations SET timezone = 'UTC' WHERE timezone IS NULL;
```

Then add a `NOT NULL` constraint with a default:

```sql
ALTER TABLE organizations ALTER COLUMN timezone SET DEFAULT 'UTC';
ALTER TABLE organizations ALTER COLUMN timezone SET NOT NULL;
```

---

### Future Changes

If per-query timezone becomes necessary post-MVP:

1. Add `timezone` to `QueryAst` (optional, defaults to `null`)
2. Compiler uses query timezone if present, otherwise org timezone
3. Cache key includes timezone hash
4. AI tools accept optional timezone parameter

This is **not** an MVP requirement.

---

## Summary Table

| Scenario                                                                   | Behavior                                                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **New organization created**                                               | Timezone defaults to `UTC`                                                                                              |
| **User changes org timezone**                                              | All future queries use new timezone; historical executions record old timezone                                          |
| **Query with date grouping**                                               | Uses `org.timezone` in `date_trunc(... AT TIME ZONE org_tz)`                                                            |
| **Week granularity**                                                       | ISO 8601 (Monday start), stated in axis label                                                                           |
| **Chart footer**                                                           | Shows "Grouped by {granularity} ({timezone})"                                                                           |
| **Per-query timezone**                                                     | Not in MVP; deferred to later                                                                                           |
| **Two users in same org**                                                  | See identical monthly revenue numbers (same timezone)                                                                   |
| **Query execution record**                                                 | Always snapshots `organizationTimezone` for auditability                                                                |
| **Calendar date column**                                                   | Never passed through `AT TIME ZONE`; not shifted by org timezone                                                        |
| **Naive datetime column**                                                  | Interpreted in the import timezone (org default or per-import override) once, at import, then stored as a fixed instant |
| **Version with no naive columns**                                          | `timezoneUsedForNaiveTimestamps` still recorded, never null                                                             |
| **Timezone abbreviation or alias submitted** (e.g. `EST`, `Asia/Calcutta`) | Rejected — allowlist accepts canonical IANA names only                                                                  |

---

## Implications for Slice 1

The timezone and granularity spike must explicitly test:

1. **Query compiler** correctly applies `AT TIME ZONE` in all date grouping scenarios
2. **Organization settings** allow timezone changes with appropriate warnings
3. **Chart footers** display timezone and granularity clearly
4. **Query execution audit** always records `organizationTimezone`, on success and on failure
5. **Edge cases** (e.g., DST transitions, month boundaries) behave as expected

This is core to the MVP persona's trust in the product and cannot be deferred.
