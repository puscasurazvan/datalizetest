# Datalize Dataset Versions — MVP Behavior

This document defines how Datalize handles re-uploads, dataset versions, and schema evolution for the MVP. It resolves Review #2's open question: _"Decide whether saved queries target the latest compatible version or an explicit version."_

---

## Decision Summary

| Question                   | Decision                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **(a) Re-upload behavior** | New dataset by default. Re-uploading into an existing dataset requires an explicit "add new version" action — never inferred from filename or schema hash.                                                                                                         |
| **(b) Query versioning**   | Saved queries reference the dataset, not a specific version. At execution time, the query resolves to the **current version** of that dataset. Every `query_executions` row records the resolved `dataset_version_id` for auditability.                            |
| **(c) Schema changes**     | Compatibility is checked at resolve time against the saved query's referenced column IDs. Additive changes are compatible. Removed or retyped columns that the query uses produce a structured `SCHEMA_INCOMPATIBLE` error — never silent failure or blank charts. |

---

## (a) Re-upload Behavior — Explicit Versioning

### Default: New Dataset

Every CSV upload creates a **new dataset** unless the user explicitly chooses to add a version to an existing one.

**Flow:**

```text
User uploads CSV
  ↓
Create new dataset record
  ↓
Create dataset_version (v1)
  ↓
Create dataset_columns
  ↓
Run import job
  ↓
Mark import completed
```

The user sees:

> "transactions_sept_2026.csv" imported as a new dataset.

---

### Explicit: Add New Version

To refresh an existing dataset (e.g., September's Stripe export replacing August's), the user must:

1. Navigate to the existing dataset
2. Click **"Add new version"** or **"Refresh data"**
3. Upload the new CSV
4. Confirm the action

**Flow:**

```text
User selects existing dataset
  ↓
Uploads new CSV
  ↓
Create new dataset_version (v2, v3, ...)
  ↓
Create/update dataset_columns
  ↓
Run import job
  ↓
Mark import completed
```

The user sees:

> "transactions" updated to version 2 (September 2026).

---

### Why Not Auto-Merge?

**Do not** infer "same dataset" from:

- Filename similarity
- Schema hash matching
- Column name overlap

Rationale:

- Users may upload related but distinct datasets (e.g., `transactions_stripe_aug.csv` vs `transactions_stripe_sept.csv` as separate historical snapshots)
- Accidental re-uploads should not overwrite or version existing data
- Explicit action reduces cognitive load: "I am refreshing this dataset" vs "I am uploading something new"

---

### Idempotency

The `imports` table uses an idempotency key to prevent double-submitting the **same upload request** from creating two versions. This does **not** make September's file collide with August's — they are separate uploads, even if the user intends them as versions of the same logical dataset.

---

## (b) Query Versioning — Follow Latest, Record Resolution

### Saved Query Model

```ts
type SavedQuery = {
  id: string
  datasetId: string // Not datasetVersionId
  queryAst: QueryAst
  createdAt: string
  updatedAt: string
}
```

A saved query references the **dataset**, not a specific version.

---

### Execution-Time Resolution

When a query executes (manually, via dashboard widget, or via AI):

```text
Resolve current dataset version
  ↓
Validate query against version's schema
  ↓
Execute query
  ↓
Record query_execution with resolved dataset_version_id
```

**Every `query_executions` row includes:**

```ts
type QueryExecution = {
  id: string
  savedQueryId?: string // Absent for ad-hoc builder queries and AI-generated queries
  datasetVersionId: string // Resolved at execution time
  organizationTimezone: string // Required on every row, success or failure
  status: "success" | "failed"
  startedAt: string
  completedAt: string
  durationMs: number
  rowCount: number
  errorCode?: string
}
```

This enables:

- Audit trails: "This chart showed August data because it ran before September import"
- Debugging: "This widget broke because version 3 changed `amount` from decimal to string"
- Future features: "Pin this widget to version 2" (if users request it later)
- Timezone reproducibility: re-running a historical query with the recorded `organizationTimezone` reproduces the same month/day grouping (see Decision 04)

---

### Why Follow Latest?

For the MVP persona (ops/finance analyst refreshing monthly):

- **Pinned versions** would make dashboards silently stale — the analyst uploads September data, but charts still show August
- **Following latest** ensures dashboards reflect current data by default
- **Recording resolution** provides transparency when things break or change

Pinning can be added later as an explicit user opt-in ("Lock this widget to version 2"), but it is the wrong default for monthly-refresh workflows.

---

## (c) Schema Evolution — Validate at Resolve Time

### Column Matching

Columns are matched between versions by **name**, but tracked internally by **opaque column ID**.

**When creating a new version:**

```text
For each column in new CSV:
  ↓
If column name matches existing column AND type matches:
  → Reuse the same column_id (continuity)
Else if column name matches but type differs:
  → Create new column_id (type change detected)
  → The old column_id is simply not carried into the new version.
    Previous versions are immutable and are never annotated or back-filled;
    the absence of the old column_id in the current version is the signal.
Else:
  → Create new column_id (new column)
```

**Example:**

| Version 1 Columns        | Version 2 Columns                                   |
| ------------------------ | --------------------------------------------------- |
| `id` (string)            | `id` (string) ← same column_id                      |
| `amount` (decimal)       | `amount` (decimal) ← same column_id                 |
| `customer_name` (string) | `customer_name` (string) ← same column_id           |
| `plan` (string)          | `plan_name` (string) ← new column_id (name changed) |
| —                        | `country` (string) ← new column_id (added)          |

---

### Compatibility Check at Query Execution

When a saved query resolves to the current dataset version:

```text
Load saved query's QueryAst
  ↓
Load current dataset_version's columns
  ↓
For each dimension/measure/filter in QueryAst:
  → Verify referenced column_id exists in this version
  → Verify column type is compatible (e.g., decimal still numeric)
  ↓
If all checks pass:
  → Execute query
Else:
  → Return SCHEMA_INCOMPATIBLE error
```

---

### Error Handling — Structured, Not Silent

**If a column is removed or retyped incompatibly:**

- The query **fails** with a structured error:

```ts
type SchemaIncompatibleError = {
  code: "SCHEMA_INCOMPATIBLE"
  datasetId: string
  datasetVersionId: string
  savedQueryId?: string
  issues: Array<{
    columnName: string
    issue: "COLUMN_REMOVED" | "TYPE_CHANGED" | "TYPE_INCOMPATIBLE"
    expectedType?: string
    actualType?: string
  }>
}
```

- The dashboard widget renders an **error state**:

> "This dataset changed. The column `plan` was removed or renamed. Update your query or contact the dataset owner."

**Never:**

- Silently drop a filter or dimension
- Show a blank chart with no explanation
- Guess at column mappings

---

### Additive Changes — Compatible

If the new version only **adds columns** or **adds rows**:

- All existing saved queries remain valid
- Queries execute normally against the new version
- Users can optionally update queries to use new columns

**Example:**

```text
Version 1: id, amount, created_at
Version 2: id, amount, created_at, country  ← additive

Saved query: "SUM(amount) GROUP BY created_at"
  → Still valid, executes on version 2
```

---

## Type Inference Stability — Slice 1 Spike

The type-inference rule from Decision 1 must be stable enough that one dirty row does not flip `amount` from `decimal` to `string` and break every dashboard.

**Slice 1 spike must validate:**

- Inference reports a small number of unparseable rows to `import_errors` rather than widening the column type
- Thresholds for type widening are explicit (e.g., "95% of rows must parse as decimal to infer decimal")
- Users can manually override inferred types before import completes

**Example:**

```text
CSV: 1,000,000 rows, amount = "10.00" everywhere except one row = "N/A"
  ↓
Type inference samples the first 10,000 rows (per Decision 06 #2); the "N/A" row falls inside that sample
  ↓
Inference: 9,999 of 10,000 sampled rows parse as decimal → decimal (99.99% confidence, ≥95% threshold)
  ↓
Import: the full load pass logs the 1 unparseable row to import_errors as "unparseable: expected decimal"
  ↓
Column type: decimal (not widened to string)
```

Type inference only samples the first 10,000 rows — a dirty row past that point never affects the confidence calculation and is instead caught at load time, where the full pass logs it to `import_errors` per Decision 06 #4 without touching the inferred type.

This prevents a single bad row from breaking all downstream queries.

---

## Summary Table

| Scenario                                | Behavior                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| **User uploads new CSV**                | Creates new dataset (default)                                                             |
| **User clicks "Add new version"**       | Creates new `dataset_version` under existing dataset                                      |
| **Saved query execution**               | Resolves to current dataset version at execution time                                     |
| **Query execution record**              | Stores resolved `dataset_version_id` and required `organizationTimezone` for auditability |
| **Additive schema change (new column)** | Compatible — existing queries run unchanged                                               |
| **Column removed**                      | Queries referencing it fail with `SCHEMA_INCOMPATIBLE`                                    |
| **Column type changed**                 | Queries referencing it fail with `SCHEMA_INCOMPATIBLE`                                    |
| **One dirty row in CSV**                | Logged to `import_errors`, does not widen column type (if within threshold)               |
| **Widget rendering**                    | Shows data, loading, or structured error — never blank or silently wrong                  |

---

## Implications for Slice 1

The dataset version spike must explicitly test:

1. **Import pipeline** handles versioned datasets correctly
2. **Type inference** is stable and reports unparseable rows
3. **Query resolution** validates against current schema at execution time
4. **Error states** render correctly for `SCHEMA_INCOMPATIBLE`
5. **Audit trail** records `dataset_version_id` and `organizationTimezone` in every `query_execution`

These behaviors are core to the MVP persona's workflow (monthly refresh) and cannot be deferred.
