# src/modules/queries

Owns QueryAst, validation, limits arithmetic, `executeQuery` orchestration,
result shaping, saved queries, and the execution audit trail. The SQL
compiler and the transaction/lock recipe live in `analytical-store`, not
here — see "Limits & execution" below.

## Query safety (CONTEXT.md, docs/decisions/05, 06 #9)

- Columns are named only by opaque Column ID — never by name. SQL
  identifiers come only from the analytical store's mapping, never the
  AST. All values are bind parameters.
- `orderBy` takes a discriminated ref only: `{kind:"dimension", columnId}`
  or `{kind:"measure", alias}` — never a bare string field.
- `aggregation: 'count'` with `field: null` means count-all → `COUNT(*)`.

## Limits & execution (docs/decisions/05, 06 #10, #16, #18)

- `rowLimits`/`finishRows` (internal/limits.ts) own the `LIMIT` arithmetic:
  `engineLimit = min(userLimit, 10000) + 1`; drop the extra row if present.
  `truncated: true` ONLY when the 10,000 cap cut the result — a smaller
  user `limit` honoured exactly keeps `truncated: false`. `service.ts`
  computes `engineLimit` and passes it to `store.execute` as a plain
  argument; the store binds it and never derives it.
- **The SQL text and the `BEGIN` → `SET LOCAL statement_timeout` → lock →
  query → `COMMIT` recipe live in `analytical-store`
  (`compile-query.ts`/`execute-query.ts`), not here** — its constraints
  (lock key shape, timeout scope, fail-fast behaviour) are documented once,
  in `analytical-store/CLAUDE.md` "Query execution": that is the file that
  auto-loads for whoever edits those files, so this file doesn't repeat
  them. This module owns AST → validation → limits → result → audit, and
  imports no pool: no `@/db/analytical`, no string-concatenated SQL, ever
  ("Query safety" above states the identifier/bind-parameter half of the
  same rule). `service.ts` calls
  `AnalyticalStore.execute(context, datasetVersionId, query, engineLimit)`
  with a `ResolvedQuery` — the only type that crosses the boundary — and
  gets back rows keyed by Column ID / measure alias, never a physical name.

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

## `rowCount` and the bar chart (build plan G12)

- `QueryResult.rowCount` is `finishRows`' `rows.length`: it equals the
  query's true group count only when nothing cut the result short, i.e.
  no `QueryAst.limit` was set. The route accepts `limit` on any request —
  this is a UI discipline, not a schema one. It holds today only because
  the shipped builder (`src/app/(app)/datasets/[id]/`) never exposes a
  limit control, so `BarVisualization`'s "of N" footer reading `rowCount`
  is honest for that UI. Add a limit control to a grouped query and this
  reader goes stale — audit it in the same change.
