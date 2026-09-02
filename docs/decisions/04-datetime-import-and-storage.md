# Datalize Datetime Import and Storage — MVP Behavior

This document resolves Q6 and fixes three issues in the timezone doc (Q5). It defines:

- How datetime columns are stored in Postgres
- How naive timestamps (no offset) are interpreted at import time
- How the query compiler safely applies timezone-aware grouping
- What metadata is recorded for auditability

---

## Issues Fixed from Q5 Doc

### Issue 1 — String Interpolation into SQL

**Problem:** `AT TIME ZONE '${orgTimezone}'` uses string interpolation, contradicting the "parameterized queries only" security baseline.

**Fix:** Timezone is validated against a **curated allowlist of canonical IANA zone identifiers** on write to `organizations.timezone`, and re-validated at compile time. A rejected timezone **fails the query**, never falls through to a default.

`pg_timezone_names` is not that allowlist. It lists every zone name Postgres's tzdata build recognizes, including fixed-offset abbreviations (`EST`, `PST`) that carry no DST rules and legacy aliases (`Asia/Calcutta`, superseded by `Asia/Kolkata`) that are ambiguous or deprecated. Membership in that view is not sufficient validation on its own — both categories pass a `pg_timezone_names` membership check while being exactly the kind of value this allowlist exists to reject. The allowlist keeps only canonical IANA identifiers (`America/New_York`, `Asia/Kolkata`, ...) and is curated and shipped with the app, not queried live from Postgres.

**Implementation:**

```ts
// On organization update
async function updateOrganizationTimezone(orgId: string, timezone: string) {
  if (!CANONICAL_IANA_TIMEZONES.has(timezone)) {
    throw new ValidationError(`Invalid timezone: ${timezone}`)
  }

  await db.update(organizations).set({ timezone }).where(eq(organizations.id, orgId))
}
```

```ts
// In query compiler
function compileDateGrouping(
  column: string,
  granularity: Granularity,
  orgTimezone: string,
): string {
  // Re-validate at compile time (defensive, should already be validated)
  const validTimezones = getValidTimezones() // cached from the canonical IANA allowlist, not pg_timezone_names
  if (!validTimezones.has(orgTimezone)) {
    throw new QueryCompilationError(`Invalid organization timezone: ${orgTimezone}`)
  }

  // Safe: orgTimezone is validated against the canonical IANA allowlist, not user input
  return `date_trunc('${granularity}', ${column} AT TIME ZONE '${orgTimezone}')`
}
```

**Rationale:** Postgres does not accept bind parameters in the `AT TIME ZONE` position. The allowlist pattern ensures the interpolated value is **never user-controlled** — it comes from a validated organization setting, drawn from a curated set of canonical zone names rather than the raw, ambiguity-including `pg_timezone_names` view.

---

### Issue 2 — `timestamptz` vs `timestamp` Semantics

**Problem:** `AT TIME ZONE` inverts semantics depending on column type:

| Column Type               | Expression                                   | Meaning                                                                                         |
| ------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `timestamptz`             | `created_at AT TIME ZONE 'America/New_York'` | Convert UTC instant to local wall clock (correct for grouping)                                  |
| `timestamp` (no timezone) | `created_at AT TIME ZONE 'America/New_York'` | Treat naive value as already being New York time, return `timestamptz` (incorrect for grouping) |

The Q5 doc never stated which type the import writes, making the compiler snippet correct only under an unstated assumption.

**Fix:** All datetime columns are stored as **`timestamptz`** (timestamp with time zone). This makes the Q5 compiler snippet correct as written and ensures every stored value is a real instant.

---

### Issue 3 — `organizationTimezone` is Optional

**Problem:** Marking `organizationTimezone` as "optional" in `query_executions` undermines the stated benefits (debugging shifted months, auditing timezone changes).

**Fix:** `organizationTimezone` is **required** on every `query_executions` row. It costs a short string per execution and enables:

- Debugging: "This chart showed November revenue because the org timezone was UTC at execution time"
- Auditing: "After we changed the org timezone from UTC to America/New_York, December revenue shifted"
- Reproducibility: Re-running a historical query with the same timezone produces the same result

---

## Decision — Datetime Storage Type

### (a) Column Type: `date` for calendar dates, `timestamptz` for everything else

**Every datetime-like input — offset-bearing or naive — becomes `timestamptz` in Postgres.** A date-only input with no time-of-day component (e.g. `2026-09-01`) infers to the separate `date` type instead: a calendar date has no instant and no timezone, so it is never passed through `AT TIME ZONE` and is unaffected by which organization timezone is active.

**Rationale:**

- `timestamptz` stores an **absolute instant** (UTC internally)
- `AT TIME ZONE` on `timestamptz` returns the **local wall clock**, which is what date grouping needs
- Naive `timestamp` columns introduce ambiguity that compounds over time (DST, timezone changes, import errors)
- A pure calendar date (e.g. a signup date with no time-of-day) has no instant to convert — storing it as `timestamptz` would fabricate a time-of-day and subject it to a timezone conversion that doesn't apply to it. It is stored as Postgres `date` and read back unchanged, regardless of organization timezone.
- Consistency: every non-`date` temporal column behaves the same way in the query compiler

**Schema:**

```ts
type DatasetColumn = {
  id: string
  datasetId: string
  name: string
  type: "string" | "integer" | "decimal" | "boolean" | "date" | "timestamptz"
  nullable: boolean
  position: number
}
```

`datetime` is an input **shape** — what type inference detects in the CSV — not a column type. Every temporal input resolves to one of the six types above: `date` when it carries no time-of-day, `timestamptz` when it does (per the naive-timestamp rule below).

---

## Decision — Naive Timestamp Interpretation

### (b) Naive Values: Interpret in Organization Timezone at Import Time, Unless Overridden

**When a CSV value has no offset, interpret it in the organization's timezone as of import time — unless the user overrides the interpretation for this import in the preview.**

**Flow:**

```text
User uploads CSV with naive timestamp column
  ↓
Type inference detects datetime-like strings without offset
  ↓
Import preview shows:
  "timestamp has no timezone in this file — reading it as {org.timezone}"
  ↓
User can override column type, or override the timezone used for this import, before import commits
  ↓
Import parses naive values using the timezone actually applied — {org.timezone} by default,
or the per-import override the user set in the preview — and stores as timestamptz (UTC instant)
  ↓
Dataset version records the timezone actually applied for this import in column metadata
```

**Example:**

```text
Organization timezone: Europe/London

CSV row: 2026-09-01 09:15:00  (naive, no offset)
  ↓
Interpret as: 2026-09-01 09:15:00 Europe/London
  ↓
Store as: 2026-09-01 08:15:00 UTC  (timestamptz)
```

---

### Why Not Always Assume UTC?

**Alternative:** Always interpret naive timestamps as UTC.

**Problem:** An ops analyst exporting from an internal tool gets local wall-clock strings (e.g., `2026-12-31 23:30:00` with no offset). Silently calling them UTC stores an instant off by exactly the zone's own UTC offset — as much as 14 hours for the most extreme IANA zones (`Pacific/Kiritimati`, UTC+14) — reliably moving rows across day and month boundaries with no visible cause.

**Example failure:**

```text
Analyst in New York exports: 2026-12-31 19:00:00 (naive, actually EST)
  ↓
Correct interpretation: 2027-01-01 00:00:00 UTC  (EST is UTC-5, add 5h)
  ↓
Assume UTC instead: 2026-12-31 19:00:00 UTC  (5h earlier than correct — no offset was ever added)
```

Grouping always converts the stored instant back to Eastern time before truncating to a month (see "Query Compiler" below), so a 7pm transaction is far enough from local midnight that both readings still land in December — the visible damage here is a 5-hour swing in _when during the day_ the row appears to have happened, not which month.

The same defect misfiles the month for a transaction closer to local midnight. A naive `2027-01-01 02:00:00` (2am on New Year's Day, Eastern) correctly parses to `2027-01-01T07:00:00Z`, which groups back to January. Assumed as UTC instead, it is stored as `2027-01-01T02:00:00Z`, which groups back to `2026-12-31 21:00:00` Eastern — December. **January revenue is understated, December is overstated** — the reverse of what naive intuition suggests, and just as invisible to the analyst.

The organization-timezone interpretation matches the persona's mental model: "This export came from my local tool, so these times are in my local timezone."

---

### Dataset Version Metadata

Every dataset version records the timezone actually applied to naive-timestamp interpretation for that import — the organization's timezone by default, or the user's per-import override when they set one in the preview. This field is **never null**: naive values always get interpreted by some zone, and the version records which one.

```ts
type DatasetVersion = {
  id: string
  datasetId: string
  versionNumber: number
  createdAt: string
  importedAt: string
  timezoneUsedForNaiveTimestamps: string // IANA name of the zone actually applied at import —
  // org.timezone by default, or the per-import override. Never null.
  rowCount: number
  status: "PENDING" | "COMPLETED" | "FAILED"
}
```

This is **immutable** per the versioning decision (Q4). A later organization timezone change never retroactively moves already-imported rows, and neither does a later change to which zone a _future_ import's override uses.

---

## Import Preview UX

The import preview must explicitly state how naive timestamps will be interpreted:

```text
⚠️ timestamp has no timezone in this file

We will read naive timestamps as Europe/London (your workspace timezone).

Example:
  CSV value: 2026-09-01 09:15:00
  Interpreted as: 2026-09-01 09:15:00 Europe/London
  Stored as: 2026-09-01 08:15:00 UTC

[Change timezone for this import]  [Override column type]  [Continue]
```

This prevents surprises and gives the user control before data is committed.

---

## Query Compiler — Correct Semantics

With `timestamptz` storage and organization timezone validated against the canonical IANA allowlist, the compiler snippet is correct:

```ts
function compileDateGrouping(
  column: string,
  granularity: Granularity,
  orgTimezone: string,
): string {
  // Validate orgTimezone against the canonical IANA allowlist (cached)
  if (!isValidTimezone(orgTimezone)) {
    throw new QueryCompilationError(`Invalid organization timezone: ${orgTimezone}`)
  }

  // Correct for timestamptz: convert UTC instant to local wall clock for grouping
  return `date_trunc('${granularity}', ${column} AT TIME ZONE '${orgTimezone}')`
}
```

**Semantics:**

- `created_at` is `timestamptz` (UTC instant)
- `AT TIME ZONE 'America/New_York'` converts UTC to local wall clock
- `date_trunc('month', ...)` groups by local month (correct for Slice 1's "total transaction amount by month", not MRR — see Decision 01)

---

## Query Execution Audit

Every `query_executions` row **must** record the organization timezone:

```ts
type QueryExecution = {
  id: string
  savedQueryId?: string // Absent for ad-hoc builder queries and AI-generated queries
  datasetVersionId: string
  organizationTimezone: string // Required, not optional
  status: "success" | "failed"
  startedAt: string
  completedAt: string
  durationMs: number
  rowCount: number
  errorCode?: string
}
```

This enables:

- Debugging shifted months
- Auditing timezone changes
- Reproducibility of historical queries

---

## Summary Table

| Scenario                       | Behavior                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Date-only column (no time)** | `date`, never passed through `AT TIME ZONE`                                                               |
| **Datetime-like column type**  | `timestamptz`, always — `datetime` is an input shape, not a column type                                   |
| **CSV with explicit offset**   | Parsed as-is, stored as UTC instant                                                                       |
| **CSV with naive timestamp**   | Interpreted in the timezone actually applied (org default, or per-import override), stored as UTC instant |
| **Import preview**             | States timezone used for naive timestamps, allows a per-import override                                   |
| **Dataset version metadata**   | Records `timezoneUsedForNaiveTimestamps` — the zone actually applied, never null (immutable)              |
| **Query compiler**             | Uses `AT TIME ZONE org_tz` on `timestamptz` column (validated against the canonical IANA allowlist)       |
| **Query execution audit**      | `organizationTimezone` required on every row, success or failure                                          |
| **Org timezone change**        | Affects future queries, not historical imports or executions                                              |

---

## Implications for Slice 1

The datetime import and compiler spike must explicitly test:

1. **Type inference** correctly distinguishes date-only input from naive and offset-bearing datetime-like input
2. **Import parsing** interprets naive values using the timezone actually applied — org timezone by default, or the per-import override — and stores as `timestamptz`
3. **Import preview** displays timezone interpretation clearly with override options
4. **Dataset version metadata** records `timezoneUsedForNaiveTimestamps` immutably, never null
5. **Query compiler** validates org timezone against the canonical IANA allowlist and generates correct SQL
6. **Query execution audit** requires `organizationTimezone` on every row, success or failure
7. **Edge cases**: DST transitions, naive timestamps at midnight, nullable datetime columns, date-only columns

This is the last blocking decision for the Slice 1 compiler and import pipeline.
