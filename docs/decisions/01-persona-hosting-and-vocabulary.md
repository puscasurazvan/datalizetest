# Datalize MVP Decisions

This document records binding decisions for Slice 0 and Slice 1. Treat these as fixed constraints unless new evidence forces an explicit change.

---

## Decision 1 — First Persona and Representative CSV

### Persona

**Ops/finance analyst at a 5–30 person SaaS company**, exporting CSV from tools like Stripe, Paddle, HubSpot, or internal exports.

Typical tasks:

- “Show me MRR by month”
- “Why did revenue dip last month?”
- “Which customers churned in the last quarter?”

They are comfortable with spreadsheets, not SQL.

---

### What Slice 1 Answers, and What It Doesn't Yet

The three tasks above are the product's aim, not what Slice 1 delivers. Slice 1 ships a query builder over one flat table per dataset — filters, group-by, and aggregates. It has no joins, no calculated fields, and no cohort tracking. Naming the gap for each task:

- **"Show me MRR by month"** is a subscription-state metric: active recurring revenue as of each month's boundary. A transaction snapshot has no subscription lifecycle, so Slice 1 answers the adjacent question the data actually supports instead: **total transaction amount by month, filtered to one currency** — `SUM(amount) GROUP BY month(created_at)` on `transactions_stripe.csv`, with `currency` filtered to a single value. That is not MRR and must not be labeled MRR in the UI.
- **"Why did revenue dip last month?"** needs a period-over-period comparison plus drill-down by dimension. Slice 1 supports the drill-down — group by plan, country, or customer, filtered to a date range — but has no built-in comparison between two periods; the analyst runs the query twice and compares by eye.
- **"Which customers churned last quarter?"** is answerable now as a filtered count directly against `customers_saaS.csv` (`status = churned`, `canceled_at` within the quarter), because that fixture carries subscription state as columns. Churn derived from the transactions fixture (customers who stopped paying) is not answerable — it needs subscription events, which Slice 1 does not ingest.

Real MRR, revenue-dip drill-down, and transaction-derived churn all need subscription events plus either joins or calculated fields across the three fixtures. Closing that gap is out of scope for Slice 0 and Slice 1 and is not committed to any slice here — it waits on a decision that defines subscription-event ingestion and cross-dataset joins.

---

### Representative CSV Fixtures

Design three canonical fixtures that cover ~90% of early use:

#### 1. `transactions_stripe.csv` — revenue/payments

**Columns:**

| Column          | Type              | Notes                             |
| --------------- | ----------------- | --------------------------------- |
| `id`            | string            | Transaction ID                    |
| `customer_id`   | string            | Customer reference                |
| `customer_name` | string            | May contain duplicates            |
| `amount`        | decimal           | Revenue measure                   |
| `currency`      | string            | e.g. `USD`, `GBP`                 |
| `status`        | string            | `succeeded`, `failed`, `refunded` |
| `created_at`    | datetime          | ISO 8601                          |
| `plan_name`     | string (nullable) | Product/plan dimension            |
| `country`       | string            | Geo dimension                     |

**Characteristics:**

- Time-series + categorical
- Clear measures (`amount`) and dimensions (`created_at`, `plan_name`, `country`)
- Good for revenue-by-period and revenue-by-dimension analyses; not sufficient alone for MRR or churn — see "What Slice 1 Answers, and What It Doesn't Yet" above
- Deliberately mixed-currency (`USD`, `GBP`, `EUR` rows): this is the fixture that exercises the currency rule below, not a dataset meant to be summed as-is

**Currency rule (MVP):** a measure over a monetary column (`amount`) requires a single-currency result. Either the dataset is single-currency, or the query filters `currency` to exactly one value. A query that would aggregate `amount` across more than one currency is refused with a structured error — e.g. "Cannot sum amount across multiple currencies — filter to one currency" — rather than silently summed. The UI surfaces this as a validation error at query-build time, before the query runs, not as a wrong number after it does.

---

#### 2. `customers_saaS.csv` — customer base

**Columns:**

| Column        | Type                | Notes                               |
| ------------- | ------------------- | ----------------------------------- |
| `id`          | string              | Customer ID                         |
| `name`        | string              |                                     |
| `email`       | string              |                                     |
| `plan`        | string              | e.g. `starter`, `pro`, `enterprise` |
| `status`      | string              | `active`, `churned`, `paused`       |
| `created_at`  | datetime            | Signup date                         |
| `canceled_at` | datetime (nullable) | Cancellation date                   |
| `mrr`         | decimal             | Monthly recurring revenue           |
| `country`     | string              |                                     |

**Characteristics:**

- Cohort and churn analysis
- Aggregations by plan, country, status

---

#### 3. `events_product.csv` — usage/events

**Columns:**

| Column          | Type              | Notes                            |
| --------------- | ----------------- | -------------------------------- |
| `event_id`      | string            |                                  |
| `user_id`       | string            |                                  |
| `event_type`    | string            | e.g. `page_view`, `feature_used` |
| `timestamp`     | datetime          |                                  |
| `session_id`    | string (nullable) |                                  |
| `metadata_json` | string/JSON       | Optional structured payload      |

**Characteristics:**

- High row count, many duplicates
- Good for testing import limits and query performance

---

### MVP Ceilings (Design Targets)

Use these as the **design targets** in Slice 0, then validate and adjust in the Slice 1 performance spike.

| Dimension        | Target                         | Rationale                                                                                                 |
| ---------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **File size**    | **50 MB** max per CSV          | Large enough to force streaming import, small enough for Postgres tables to be perfectly fine in MVP      |
| **Row count**    | **1,000,000 rows** per dataset | Forces streaming, chunking, and query limits; still very manageable in Postgres with proper indexing      |
| **Column count** | **100 columns** max            | Wide enough to test type inference, UI preview, and query builder UX without becoming a generic data lake |

These become your **hard product limits** for MVP:

- Import pipeline must handle up to these limits.
- Query result caps can be much smaller (e.g. 10k–50k rows returned to UI).
- Storage strategy: one Postgres table per dataset is acceptable at this scale.

The Slice 1 spike must explicitly benchmark:

> “Import and query performance for CSVs up to 50 MB / 1M rows / 100 columns on Postgres. Adjust limits if import > X minutes or simple aggregations > Y ms.”

---

## Decision 2 — Job Runtime and Hosting

### Hosting

**Vercel** is the default hosting platform for Datalize.

This implies:

- Serverless/edge functions with timeouts
- No long-lived background processes
- Need for external job orchestration for long-running work

---

### Job Platform

**Use Trigger.dev from the first asynchronous import.**

Rationale:

- A polling database worker has no natural home on Vercel.
- Imports can exceed function timeouts.
- “Add Trigger.dev later” means rewriting the import pipeline mid‑MVP.
- The original Datalize.md already assumes Vercel + Trigger.dev; keep that consistent.

**Implications:**

- Import jobs, exports, and later scheduled reports all run on Trigger.dev.
- The application stores job metadata and status in PostgreSQL, but execution and retries are managed by Trigger.dev.
- Remove the “database-backed worker first” ambiguity from the architecture docs.

If hosting assumptions change in future (e.g. moving to Railway, Fly, or Render with long-lived processes), revisit this decision explicitly.

---

## Decision 3 — “Workspace” vs “Organization”

To avoid split-brain terminology between code and UI:

- **Code, schema, types:** `organization`, `organization_id`, `Organization`
- **UI copy:** “workspace” (friendlier, less corporate)

### Concrete Rules

- Database table: `organizations`
- Membership table: `organization_members`
- Foreign keys: `organization_id` on all tenant-owned records
- TypeScript types: `Organization`, `OrganizationMember`, etc.
- UI labels:
  - “Create workspace”
  - “Switch workspace”
  - “Workspace settings”
  - “Invite to workspace”

This keeps a single source of truth in the data model while using more user-friendly language in the interface.

Add this as the first entry in the project glossary (e.g. `CONTEXT.md`):

> **Organization (code) / Workspace (UI)**  
> The tenant boundary. All dashboards, datasets, queries, and members belong to exactly one organization. The UI calls this a “workspace”; the code and schema use “organization”.

---

## Summary

| Question                           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Q1 — First persona and CSV**     | Ops/finance analyst at a 5–30 person SaaS company. Fixtures: `transactions_stripe.csv`, `customers_saaS.csv`, `events_product.csv`. Ceilings: **50 MB / 1M rows / 100 columns** as MVP design targets, validated in Slice 1. Slice 1 answers total transaction amount by month (single currency), not MRR or transaction-derived churn — see "What Slice 1 Answers, and What It Doesn't Yet". Mixed-currency aggregates are refused, not summed. |
| **Q2 — Job runtime**               | **Vercel + Trigger.dev from the first import.** Remove “DB worker first” ambiguity.                                                                                                                                                                                                                                                                                                                                                              |
| **Q3 — Workspace vs organization** | **Organization** in code/schema/types; **workspace** in UI copy only.                                                                                                                                                                                                                                                                                                                                                                            |

Treat these as fixed constraints for Slice 0 and Slice 1 implementation.
