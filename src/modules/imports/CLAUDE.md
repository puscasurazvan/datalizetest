# src/modules/imports

Owns the import lifecycle (docs/decisions/06).

## Two phases, not one

- `import.profile`: stream the object, infer schema, enforce ceilings, write
  `imports.proposed_schema`, set status `AWAITING_CONFIRMATION`.
- `import.load`: create the physical table, load rows against
  `imports.confirmed_schema`, commit metadata last.
- Split exists so the user can override column type/timezone before commit
  (docs/decisions/04). Never collapse the two into one.

## Ceilings — enforced before any DDL

- 50 MB / 1,000,000 rows / 100 columns (docs/decisions/01, 06).

## Type inference — deterministic

- Samples the first 10,000 rows; a type is inferred when ≥95% of non-empty
  sampled values parse as it, else `string`.

## Row/error handling

- An unparseable value → `NULL` + an `import_errors` row; the row is KEPT
  (dropping it would desync `row_count` from the file).
- `import_errors` records row number, column name, error code — never the raw
  cell value (no customer data in an application table).
- An empty cell (including `""`) is `NULL`, marking the column nullable.

## Naive datetimes (docs/adr/0004, docs/decisions/04)

- Converted to instants in Node, not Postgres, using the organization
  timezone, so ambiguous/nonexistent DST local times are detected/reported.
- `timezoneUsedForNaiveTimestamps` is stamped immutably on the Dataset Version.

## Idempotency & job payload

- Idempotency key is derived server-side from object key + dataset ID, never supplied by the client.
- Job payload carries the import ID only — never the file, never a presigned URL.
