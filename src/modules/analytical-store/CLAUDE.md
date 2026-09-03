# src/modules/analytical-store

The ONLY owner of physical storage (docs/adr/0002).

## Storage model

- One physical table per Dataset Version, in the `analytical` schema.
- Table and column names are server-generated and never appear in anything
  this module returns.
- The Column ID → physical name mapping lives in `analytical_tables` /
  `analytical_columns` and nowhere else.

## Interface discipline

- Every method takes a server-created context, never a bare `datasetId`.
- All SQL is parameterised; identifiers come only from the stored mapping —
  never from a caller or a QueryAst.
- The interface exists so a columnar engine can replace the implementation
  later (docs/adr/0002) — do not leak Postgres specifics (types, error codes,
  SQL fragments) through it.

## Query execution (queries/CLAUDE.md "Limits & execution")

- `execute()` is the interface's one read of a `ResolvedQuery` — a
  type-only import from `@/modules/queries`. This module never imports the
  `QueryAst` Zod schema or anything else runtime from `queries/`, matching
  that module's promise to never import `@/db/analytical`: the module
  graph, not review discipline, keeps SQL out of `queries/` and Column IDs
  out of raw SQL here.
- `compile-query.ts` builds the parameterised SQL text — pure, no pool, no
  I/O. `execute-query.ts` runs it on one `analyticalPool` client, in this
  order: `BEGIN` → `SET LOCAL statement_timeout = 30000` (scoped to this
  transaction, on the **interactive analytical pool** — the import pool
  sets its own, much longer `statement_timeout` at pool construction; see
  src/db/CLAUDE.md) → up to 5 `pg_try_advisory_xact_lock` attempts
  (`execution-slots.ts`; fail fast on the 5th miss → `CONCURRENCY_LIMIT`,
  no queue) → the query → `COMMIT`, `ROLLBACK` in `catch`,
  `client.release()` in `finally`. `postgres-store.ts`'s `execute()`
  method is the only caller of either file: it resolves the Column ID →
  physical name mapping, calls `compileQuery`, then `execute-query.ts`'s
  runner.
- `execution-slots.ts`'s lock keys are the two-argument
  `pg_try_advisory_xact_lock` form, spending the full SHA-256 digest of
  `organizationId`: `key1` from its first 4 bytes (shared across that
  Organization's 5 slots), `key2` from its next 4 bytes XORed with the
  slot number — never the single-`bigint` form, which would only exercise
  32 of 64 bits and collide across organizations far more often than "5
  per Organization" assumes. An advisory **transaction** lock releases
  itself at `COMMIT`/`ROLLBACK`, so there is no manual unlock step an
  early return could skip.
- `engineLimit` arrives as a plain argument from `queries/service.ts`
  (`rowLimits`, queries/internal/limits.ts) — this module binds it into
  `LIMIT` and never derives it from a raw `limit`.

## Build order

- The write and read surfaces (`createVersionTable`, `loadRows`,
  `readRows`, `dropVersion`) shipped first; `execute()` shipped after the
  load benchmark (docs/decisions/06 #15) and is documented above.
