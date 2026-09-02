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

## Build order

- The write surface ships first. `execute()` is added after the load
  benchmark (docs/decisions/06 #15).
