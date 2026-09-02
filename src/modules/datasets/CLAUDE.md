# src/modules/datasets

Owns Dataset, Dataset Version, Dataset Column — the LOGICAL model only. No physical
storage concerns; see `src/modules/analytical-store` for that.

## Immutability (CONTEXT.md, docs/decisions/02)

- Dataset Versions are immutable: never edited, annotated, or back-filled after import.
- A re-upload never auto-merges into an existing dataset (no filename/schema-hash
  matching); a new version is created only via an explicit user action.

## Column ID continuity (CONTEXT.md, docs/decisions/02)

- A Column ID carries forward to the next version only when both name AND type are
  unchanged. A rename or retype creates a new Column ID.
- The absence of an old Column ID in the current version IS the signal that a saved
  query no longer fits — do not add a separate "removed" flag or annotation.

## No physical leakage (docs/adr/0002, CONTEXT.md)

- This module never sees or returns a physical table or column name. Columns are
  named only by Column ID. Physical names live solely in `analytical-store`.

## Saved Query resolution (docs/adr/0003, docs/decisions/02)

- A Saved Query references the Dataset (`datasetId`), never a `datasetVersionId`.
- It resolves to the Dataset's current version at execution time; compatibility is
  checked then against the query's Column IDs, and a removed/retyped column fails
  with a structured `SCHEMA_INCOMPATIBLE` error — never a blank chart or dropped filter.

## Tenancy

- Every read is organization-scoped.
