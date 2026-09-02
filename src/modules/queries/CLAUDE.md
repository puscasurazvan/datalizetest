# src/modules/queries

Owns QueryAst, validator, compiler, executor, saved queries, executions.

## Query safety (CONTEXT.md, docs/decisions/05, 06 #9)

- Columns are named only by opaque Column ID — never by name. SQL
  identifiers come only from the analytical store's mapping, never the
  AST. All values are bind parameters.
- `orderBy` takes a discriminated ref only: `{kind:"dimension", columnId}`
  or `{kind:"measure", alias}` — never a bare string field.
- `aggregation: 'count'` with `field: null` means count-all → `COUNT(*)`.

## Limits & execution (docs/decisions/05, 06 #10, #16, #18)

- Compile `LIMIT min(userLimit, 10000) + 1`; drop the extra row if present.
  Set `truncated: true` ONLY when the 10,000 cap cut the result — a smaller
  user `limit` honoured exactly keeps `truncated: false`.
- Order: `BEGIN` → `SET LOCAL statement_timeout = 30000` on the
  **interactive analytical pool** (scoped to interactive query execution —
  the import pool sets its own, much longer `statement_timeout` at pool
  construction; see src/db/CLAUDE.md) → the two-argument
  `pg_try_advisory_xact_lock` form across 5 slots, keying `key1`/`key2` on
  the Organization hash and the slot number as separate `int4` arguments,
  never a single truncated `bigint` (fail fast, `CONCURRENCY_LIMIT`, no
  queue) → query → `COMMIT`.

## Date grouping (docs/decisions/03)

- `date_trunc(granularity, col AT TIME ZONE <org tz>)` applies to
  `timestamptz` columns only — never a calendar `date`, which carries no
  instant and is never passed through `AT TIME ZONE`. `<org tz>` is
  allowlist-checked, not parameterised. Weeks start Monday (ISO), fixed.

## Audit & resolution (docs/decisions/03, adr/0003)

- Every execution writes a `query_executions` row recording the resolved
  `datasetVersionId` and the org timezone used — on failure too.
- Saved queries store `datasetId`, never a version, resolving to the
  current version at execution time. A removed/retyped column raises
  `SCHEMA_INCOMPATIBLE` naming the column — never a blank chart.
