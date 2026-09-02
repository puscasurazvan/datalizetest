# Datalize Full Documentation Audit

**Reviewed:** 2026-09-02  
**Scope:** `CONTEXT.md`, `docs/README.md`, all files under `docs/decisions/`, all files under `docs/adr/`, all files under `docs/reference/`, and the current application scaffold.  
**Status:** Advisory review. This file does not override the existing precedence rules and does not modify any existing document.

## Executive Verdict

The project has a strong foundation and the binding decisions are materially better than the two original reference documents. The chosen direction is appropriate for a product that may become commercial:

- Next.js modular monolith
- Better Auth for identity and membership
- Datalize-owned resource authorization
- PostgreSQL for application state and bounded MVP analytics
- One physical analytical table per Dataset Version
- Trigger.dev for asynchronous imports
- Structured queries instead of arbitrary SQL
- Explicit Dataset Version and timezone provenance

The documentation is not fully implementation-ready yet. The highest-risk gaps are not missing libraries; they are conflicting runtime contracts and missing lifecycle rules. Resolve those before loading real customer data:

1. The import load target conflicts with the 30-second analytical pool timeout.
2. Persisting a job row before dispatch does not make dispatch durable; an outbox or reconciler is still required.
3. The documented role model is not configured in the current Better Auth setup.
4. The ownership and migration path for Better Auth tables and the `timezone` column is contradictory.
5. The physical analytical mapping and schema bootstrap are absent from the application schema model.
6. The query result-limit rules produce more rows than a user-requested limit below 10,000.
7. The product examples promise MRR, revenue, and churn semantics that the MVP query model cannot yet provide, especially with multiple currencies.

The recommendation remains: use the improved architecture as the baseline, use the ADRs and decisions as binding, and treat the original document as a long-term product reference only.

## Authority And Drift

The stated precedence is correct:

```text
CONTEXT.md
  > docs/decisions/
  > docs/adr/
  > docs/reference/
```

The problem is discoverability. The reference files still contain unsafe or superseded examples, while the binding decisions are short and distributed across several files. A developer reading only a reference file can implement the wrong contract.

Recommended documentation convention for future changes:

- Add `Status`, `Date`, `Owner`, and `Supersedes` metadata to every ADR and binding decision.
- Put a visible `Reference only - not normative` banner at the top of every file in `docs/reference/`.
- Give every important contract one canonical location instead of repeating partial versions in several documents.
- Maintain a small decision register with `Open`, `Accepted`, `Superseded`, and `Revisit trigger` states.
- Give the current audit a link from the documentation index when existing-file edits are allowed.

## Critical Findings

### C1. Import Load Cannot Fit The Documented Analytical Pool

**Evidence:**

- `docs/decisions/06-slice-1-implementation-defaults.md`, item 15: load target of up to five minutes.
- The same document, item 16: DDL and row loading happen on the analytical pool.
- `src/db/analytical.ts`: the analytical pool sets `statement_timeout` to 30 seconds.
- `src/db/CLAUDE.md`: the 30-second timeout is a non-negotiable analytical-pool rule.

**Impact:** A 50 MB / 1,000,000-row load can be cancelled after 30 seconds even if the import implementation is otherwise correct. This makes the central benchmark and the implementation target mutually incompatible.

**Recommendation:** Define separate runtime contracts:

- Query pool: 30-second statement timeout and the five-query per-organization limit.
- Import pool or import transaction: an explicit load timeout appropriate for the benchmark, with a hard task-level maximum.
- Metadata pool: application writes only.

Document which pool creates the analytical schema/table, which pool performs `COPY` or batch loading, and how a timed-out load is cleaned up. Do not weaken the interactive query timeout to accommodate imports.

### C2. Job Durability Is Overstated

**Evidence:**

- `docs/adr/0001-triggerdev-as-job-runtime.md` says PostgreSQL owns job metadata and Trigger.dev owns execution.
- `src/modules/jobs/CLAUDE.md` says persisting the job before dispatch means a commit can never be separated from enqueueing.
- `docs/reference/Datalize-architecture-review.md` correctly recommends an outbox or retryable dispatcher, but this requirement has not become a binding decision.

**Impact:** The sequence below can leave a permanently queued job if the process fails after the database commit and before the Trigger.dev request succeeds:

```text
commit job row -> dispatch to Trigger.dev
```

The job row is durable; the enqueue operation is not.

**Recommendation:** Choose one of these explicitly:

- A transactional outbox consumed by a retryable dispatcher.
- A durable provider call integrated with a reconciler that retries every undispatched job.
- A provider-specific transactional trigger if its delivery guarantees are proven and tested.

Define `created`, `dispatching`, `dispatched`, `running`, `succeeded`, `failed`, and `cancelled` transitions, plus the recovery behavior for every crash point. Job payloads should continue to carry IDs only.

### C3. Roles In Documentation Do Not Match Better Auth Configuration

**Evidence:**

- `docs/decisions/06-slice-1-implementation-defaults.md`, item 13, defines `owner`, `admin`, `editor`, and `viewer`.
- `src/modules/auth/auth.ts` enables the organization plugin but does not configure a custom access controller or these four roles.
- `src/db/schema/auth.ts` defaults `organization_members.role` to `member`.
- The auth module rules require resource authorization through `assertCan`, but no implementation contract for the permission matrix exists in `docs/`.

**Impact:** A fresh installation currently has a default `member` role while the application documentation promises `editor` and `viewer`. Permission checks cannot be implemented consistently from the current sources.

**Recommendation:** Decide and document one model:

- Configure Better Auth custom roles and permissions, then use Datalize resource policies for dataset/query/dashboard ownership; or
- Keep Better Auth's coarse membership roles and map them in exactly one Datalize policy module.

In either case, document the complete permission matrix. It must include dataset creation, refresh, delete, import confirmation, query save, query execution, dashboard read/create/update/delete, widget management, organization timezone updates, member management, audit-log access, and organization deletion.

Also define these invariants:

- Unique membership per `(organization_id, user_id)`.
- A user cannot remove or demote the last owner.
- Owner transfer is explicit and auditable.
- A pending invitation cannot be replayed after acceptance, expiry, or revocation.
- A user signing up gets a personal Organization exactly once.
- `activeOrganizationId` is re-verified against membership on every request.

### C4. Better Auth Schema Ownership And Migration Ownership Conflict

**Evidence:**

- `src/modules/organizations/CLAUDE.md` says Better Auth owns `organizations` and `timezone` is an `additionalFields` entry that cannot come from a Datalize migration.
- `src/modules/auth/auth.ts` configures `timezone` as an additional field.
- `src/db/schema/auth.ts` declares `organizations.timezone` in the Drizzle schema.
- `drizzle.config.ts` includes the public schema for Drizzle migrations.

**Impact:** A fresh environment does not have an unambiguous owner for creating or changing `organizations.timezone`. An implementation can either omit the column, generate a duplicate migration, or make Better Auth and Drizzle disagree after an upgrade.

**Recommendation:** Document and test one source of truth for each auth table:

- How Better Auth's generated schema is produced.
- Whether Datalize's Drizzle migration contains `timezone`.
- Which tool applies the initial schema in development, CI, preview, and production.
- How Better Auth upgrades are diffed and migrated.
- How a fresh database reaches the exact schema expected by `auth.ts`.

Run the process from an empty database in CI. Do not rely on a manually prepared local database.

### C5. Physical Analytical Metadata Is Missing

**Evidence:**

- `docs/adr/0002-one-postgres-table-per-dataset-version.md` names `analytical_tables` and `analytical_columns` as the mapping location.
- `docs/reference/Datalize-improved-architecture.md` lists `datasets`, `dataset_columns`, and imports, but not the physical mapping tables.
- `src/db/schema/index.ts` currently contains only auth exports.
- No document defines creation of the `analytical` PostgreSQL schema, privileges, mapping constraints, or garbage collection.

**Impact:** The most security-sensitive boundary in the system has no implementable metadata contract. It is unclear how a Dataset Version maps to a physical table, how a Column ID maps to a physical column, or how orphaned tables are found and removed.

**Recommendation:** Add a binding storage contract defining:

- The public metadata tables owned by `analytical-store`.
- The runtime-created `analytical` schema and its bootstrap migration.
- Server-generated physical names and PostgreSQL identifier-length handling.
- Unique constraints for Dataset Version and Column ID mappings.
- Ownership and permissions for the database role that can access physical tables.
- Physical table lifecycle on failed import, Dataset Version deletion, and organization deletion.
- Recovery and garbage collection for tables whose metadata commit failed.

The broad rule says every tenant-owned row carries `organization_id`, while the physical-table ADR does not say whether analytical rows carry it. Explicitly classify physical rows as an exception with a defense-in-depth reason, or include the organization identifier and enforce it.

### C6. User-Specified Query Limits Are Incorrect Below 10,000

**Evidence:** `docs/decisions/05-query-limits.md`, items 25-51, and `docs/decisions/06-slice-1-implementation-defaults.md`, item 10.

The compiler is described as emitting `min(userLimit, 10000) + 1`. The result code only removes a row when `rows.length > 10000`.

**Failure case:** A user requests `limit: 50`, the database returns 51 rows, and the implementation returns all 51 because the post-processing branch checks only for 10,000 rows. This violates “user limit is honoured exactly.”

**Recommendation:** Define separate values:

- `requestedLimit`: the user-visible maximum.
- `engineLimit`: `min(requestedLimit, 10000) + 1`.
- `returnedRows`: never more than `requestedLimit`.
- `truncated`: true only when the product cap, rather than the user's own limit, removed rows.
- `hasMore`: optional metadata when the engine found a row beyond the requested limit.

Add tests for limits `0`, `1`, `50`, `10,000`, and values above the cap. Require a deterministic ordering whenever truncation is meaningful.

### C7. Product Metrics Are Not Yet Trustworthy With The Current Query Model

**Evidence:**

- `docs/decisions/01-persona-hosting-and-vocabulary.md` uses “MRR,” “revenue,” and “churn” as representative tasks.
- The same decision's transaction fixture contains `USD`, `GBP`, and `EUR` rows.
- The QueryAst supports basic aggregation but has no currency conversion, metric definitions, joins, subscription events, or calculated fields.
- The improved architecture explicitly defers calculated fields, joins, cohort analysis, and retention analysis.

**Impact:** `SUM(amount)` across multiple currencies is not revenue. A transaction snapshot with a `status` column is not enough to calculate historical MRR or churn. An AI explanation of “why revenue fell” cannot be trustworthy if the system has no defined metric semantics or decomposition query.

**Recommendation:** Choose one honest MVP boundary:

- Restrict a Dataset Version to one currency and reject or require filtering for mixed-currency measures.
- Add normalized amount and reporting-currency metadata before using “revenue” in product examples.
- Rename the first examples to generic measures such as “total transaction amount.”
- Defer MRR/churn claims until a semantic metric model exists.
- Make “why” mean “which dimensions changed and by how much,” not causal explanation.

Document how the UI labels measures, how currency is displayed, and when AI must say that a conclusion is unavailable from the supplied data.

### C8. Local Trigger Fallback Conflicts With The Job ADR

**Evidence:**

- `.env.example` says Trigger.dev variables can be omitted locally to fall back to an inline dispatcher.
- `src/modules/jobs/CLAUDE.md` says `InlineDispatcher` is for tests and CI.
- `docs/adr/0001-triggerdev-as-job-runtime.md` selects Trigger.dev from the first asynchronous import.

**Impact:** If the inline dispatcher runs an import inside a request, it can turn a supposedly asynchronous 1M-row import into a request-bound operation and hit the same timeout problem the job platform was selected to avoid.

**Recommendation:** Document three distinct modes:

- Local integration mode: Trigger.dev development runtime with real task boundaries.
- Unit-test mode: inline fake dispatcher with no external services.
- CI E2E mode: an explicit test task/runtime, never an accidental inline production path.

If inline execution is retained for local convenience, cap its input and state clearly that it is not a production-like import path.

## High-Priority Contract Gaps

### H1. Date Types And Timezone Rules Are Incomplete

The documents disagree about whether the MVP has `date`, `datetime`, or only `timestamptz`:

- The improved reference supports `date` and `datetime`.
- ADR 0004 converts inferred datetime values to `timestamptz`.
- `src/modules/queries/CLAUDE.md` says date grouping applies to datetime columns and never a calendar `date`.

Define the distinction explicitly:

- Calendar date: no instant and no timezone conversion.
- Offset-bearing datetime: an absolute instant stored as `timestamptz`.
- Naive datetime: interpreted in the selected import timezone, then stored as `timestamptz`.

Also resolve these issues:

- The London winter example in `docs/decisions/03-timezone-and-date-granularity.md` incorrectly treats late-December London as UTC+1; GMT is UTC+0 in winter.
- `timezoneUsedForNaiveTimestamps` should define whether it is `null` when no naive values exist.
- Ambiguous and nonexistent DST local times need a precise reject/choose policy, not only a promise that Node detects them.
- Timezone validation should distinguish canonical IANA names from PostgreSQL abbreviations and aliases.
- Query execution records should consistently require or omit `savedQueryId`; the current documents use both shapes.

### H2. There Is No Single Normative Query Contract

The reference AST uses bare string fields, while decision 06 changes `orderBy` to a discriminated reference. The reference result shape, decision 05 result shape, and execution audit shape also use different identifiers and meanings.

Create one canonical contract covering:

- QueryAst versioning and canonical serialization.
- Column ID references and schema resolution.
- Type-specific filter values, null behavior, case sensitivity, and inclusive boundaries.
- Count-all versus count-a-field.
- Dimension aliases and measure aliases.
- Deterministic ordering and tie-breaking.
- Query hash inputs, including timezone and resolved Dataset Version.
- Result columns, Datalize types, decimal serialization, row count, cell count, byte size, truncation, and execution ID.
- Structured errors and HTTP status mapping.
- Cancellation and client disconnect behavior.

The current `QueryResult.queryId` is especially ambiguous: it is generated after execution in decision 05, while `query_executions` needs a durable execution identifier and the rest of the docs use `queryId` for a saved query. Use distinct names.

### H3. Row Count Is Not Enough To Bound Result Size

The hard limit of 10,000 rows can still produce a very large response when a result has many columns or long strings. The query docs also mention maximum dimensions, measures, filter complexity, and export size without defining values.

Add limits for:

- Maximum result cells.
- Maximum serialized response bytes.
- Maximum dimensions and measures.
- Maximum filters and `IN` values.
- Maximum query AST bytes.
- Maximum group cardinality.
- Connection acquisition time.
- Model input cells and bytes when AI is involved.

Define whether these failures are compile-time or execution-time and expose safe, actionable messages.

### H4. Import State Machine Is Split Across Documents

`AWAITING_CONFIRMATION` appears in decision 06 but not in the main import state list, the glossary, or the dataset-version decision. The two-phase import also raises unaddressed cases:

- Profile succeeds and the user never confirms.
- Confirmation races with cancellation or another confirmation request.
- The proposed schema expires.
- A user changes the Organization timezone between profile and confirmation.
- A duplicate job starts while a load is already running.
- The load partially creates a table and then fails.
- The number of unparseable cells exceeds a useful threshold.

Document the complete state machine, transition authority, expiry policy, retry policy, and user-visible behavior. Make schema confirmation conditional on an import revision or compare-and-swap token.

### H5. CSV Parsing Rules Need More Than Type Inference

The docs define sampling and a 95% threshold, but not the complete CSV dialect or parser behavior. Decide at least:

- UTF-8 and BOM behavior.
- Delimiter and quote rules.
- Newline handling.
- Header-only and empty files.
- Duplicate and blank headers.
- Invalid UTF-8 and embedded null bytes.
- Maximum field length.
- Boolean and decimal formats.
- Date parser precedence when a value matches more than one type.
- Whether a malformed row is kept, rejected, or causes the import to fail.
- Maximum `import_errors` rows and aggregate error behavior.

The current fixture comments mention `tests/fixtures/README.md`, but that file does not exist. The representative CSV outputs are generated code, not checked-in fixtures, so the documented fixture contract is not yet reproducible by a new contributor.

### H6. Two-Pool Recovery Can Race And Leak Physical Tables

Decision 06 uses deterministic names, `CREATE TABLE IF NOT EXISTS`, and `TRUNCATE` to make retries converge. That is not enough if two dispatches for the same import run concurrently: one can truncate while the other is loading.

Define:

- A per-import lease or database lock.
- The owner and generation of a physical table.
- How a retry distinguishes its own table from a previous successful table.
- How orphaned tables are detected and removed.
- Whether a Dataset Version becomes current only after row loading, mapping metadata, and application metadata all succeed.
- Whether a failed Dataset Version remains visible to the user.

Do not use `TRUNCATE` as the sole concurrency safety mechanism.

### H7. Dashboard Persistence Is Still Underspecified

The binding notes mention a revision token and a saved-query snapshot, but do not define the actual data contract. Clarify:

- Whether “snapshot” means a query-definition snapshot or a pinned Dataset Version.
- Whether a widget always has a `saved_query_id` or can contain inline AST JSON.
- Layout units, breakpoints, minimum/maximum dimensions, and collision behavior.
- Whether a query edit changes every widget using it.
- Autosave ordering, stale revision response, retry, and navigation with unsaved changes.
- Dashboard-level filter compatibility across widgets and datasets.

For the first release, a fixed grid with preset sizes and per-widget filters is safer than free-form resize plus global filters.

### H8. The Bar-Chart “Top 50 Of N” Rule Has No Data Contract

The visualization rules require a top-50 cap and a “showing top 50 of N” note. The query result contract does not provide `N`, and the query engine does not specify whether the top categories are selected by measure descending or by the user's order.

Choose one behavior:

- The query engine returns a `totalGroups` count and orders by the selected measure.
- The visualization displays only “showing 50 categories” without claiming `N`.
- The product runs a separate count query with explicit cost limits.

Never call a result “top 50” without a deterministic ranking rule.

### H9. Storage Uploads Need A Finalization Contract

Signed upload URLs are named, but the documents do not specify the finalize step. The server must not trust a client claim that an object is complete or has the expected content.

Define:

- Server-generated object key format and organization scoping.
- URL expiry and allowed method/content length.
- Server-side verification of object existence, size, checksum, and content type.
- What happens to abandoned uploads.
- Object deletion on cancelled/failed imports and Dataset Version deletion.
- Download content disposition and `nosniff` behavior.
- Local development storage. `docker-compose.yml` provides PostgreSQL but no S3-compatible service, and the storage module rules promise an in-memory test implementation only.

### H10. AI Is Still An Open Product And Privacy Decision

`docs/README.md` correctly marks the AI provider, retention, redaction, and budget as open. This is acceptable before Slice 4, but the current product examples and representative `customers_saaS.csv` data include PII-shaped fields such as email addresses.

Before AI implementation, decide:

- Which result cells and metadata may leave the system.
- How sensitive columns are classified and redacted.
- How dataset values are isolated from prompt instructions.
- Provider retention and training terms.
- Conversation/history retention and deletion.
- Per-user and per-Organization token, cost, and request limits.
- Tool-call count, timeout, retry, and malformed-output behavior.
- How AI explains uncertainty and missing data.

The AI should propose a QueryAst and explanation; only the server executes queries and only explicit user actions mutate dashboards.

### H11. Security Requirements Need Operational Detail

The security baseline is directionally correct but still too general for a commercial data product. Add contracts for:

- Trusted origins and cookie attributes.
- Server Action body limits and deployment encryption-key stability.
- Security headers, CSP, and framing policy.
- Authentication, upload, query, import, and AI rate-limit implementation.
- Database role permissions for application and analytical pools.
- Encryption at rest and key rotation for future connector credentials.
- PII classification and logging redaction.
- Public object/download access.
- Organization deletion and raw-file retention.
- Incident response when a tenant-isolation test fails.

Do not defer rate limiting merely because Redis is deferred; use a bounded first implementation.

### H12. Backups And Recovery Cover Only PostgreSQL Conceptually

The original reference mentions PostgreSQL backups but does not define recovery for the full product. A usable recovery plan must include:

- PostgreSQL metadata.
- Runtime-created analytical tables.
- Raw files and generated exports in object storage.
- Trigger.dev task state or replay strategy.
- Secret and encryption-key recovery.
- Restore ordering and validation.
- RPO and RTO targets.

The first external pilot should not depend on a backup that has never been restored.

## Medium-Priority Improvements

### M1. Complete The Permission Matrix Before Building UI

The current matrix is too small for the documented features. Avoid a broad `dataset:manage` permission if it hides materially different actions such as delete, refresh, and sharing. Define resource/action permissions and document which operations viewers may perform, including query execution and preview access.

### M2. Make Provider Boundaries Deliberate

The documents list Vercel, Neon, Trigger.dev, S3, Resend, Stripe, Sentry, PostHog, and OpenTelemetry. That is a reasonable eventual stack, but “abstract where practical” is not an implementation rule.

Abstract only boundaries that are likely to change or are easy to test:

- Storage provider.
- Job dispatcher.
- AI provider.
- Analytical store.
- Email sender.

Do not create generic adapters for integrations, billing, notifications, or caching before a second implementation exists.

### M3. Clarify Server Component, Action, And Route Responsibilities

The reference says Route Handlers are for external HTTP only, while the current application rules correctly designate `/api/queries/execute` for interactive query execution. Make the current rule authoritative in a future contract document:

- Server Components: initial authenticated reads and composition.
- Server Actions: UI mutations.
- Protected query Route Handler: interactive, parallel, cancellable query execution.
- Upload Route Handlers: presign and finalize.
- Auth callbacks and webhooks: external boundaries.

All paths must call the same service layer and request-context factory.

### M4. Add A Semantic Result And Presentation Contract

The visualization layer needs more than chart type. Define:

- Decimal and timestamp serialization.
- Null display.
- Currency and percent formatting rules.
- Locale and Organization timezone display.
- Empty versus all-null result behavior.
- Table column labels and accessible captions.
- Chart text alternatives and data-table fallback.
- Light/dark contrast and reduced-motion behavior.

Accessibility should be tested with keyboard navigation, screen reader output for chart summaries, focus restoration in dialogs, and automated axe checks, not only listed as a principle.

### M5. Replace The 32-Bit Advisory-Lock Collision With A Deliberate Policy

Decision 05 explicitly accepts cross-Organization lock-key collisions from a 32-bit hash. That does not leak data, but it violates the stated “five per Organization” concurrency guarantee by allowing unrelated Organizations to throttle one another.

Use a collision-resistant two-key advisory lock, a database semaphore keyed by the full Organization ID, or a provider-level concurrency limit. If the 32-bit approach remains for the MVP, document the availability tradeoff and monitor collision-related contention.

### M6. Define Query Cancellation And Pool Acquisition Limits

The route design promises cancellation, but the query documents only define statement timeout. Add:

- Connection acquisition timeout.
- Abort signal propagation from the HTTP request.
- PostgreSQL cancellation behavior.
- Cleanup when the browser disconnects.
- A distinction between queued pool wait and query execution time.

### M7. Add Lifecycle And Retention Tables To The Domain Model

The application table list should distinguish stable records from operational records. Define retention and deletion for:

- Dataset Versions.
- Imports and import errors.
- Query executions.
- Audit logs.
- AI history.
- Job records.
- Raw files.
- Failed and orphaned physical tables.

Every retained record needs an owner and a deletion policy.

### M8. Add Product Success Metrics, Not Only Technical Exit Criteria

The docs define technical completion but not whether the product is useful. Track pilot outcomes such as:

- Time from signup to first successful chart.
- Import completion rate.
- Percentage of users reaching a persisted dashboard.
- Query p50/p95 latency by result shape.
- Frequency of schema incompatibility and truncation.
- Percentage of AI answers accepted or corrected by users.
- AI cost per active Organization.
- Weekly return rate for the target analyst.

These metrics should decide whether to add connectors, richer analytics, or scale infrastructure.

## Documentation-To-Scaffold Drift

The current repository is an early scaffold, not an implementation of the full architecture. That is acceptable, but the gaps should be explicit.

### Current Application Gaps

- `src/app/page.tsx` and `src/app/layout.tsx` are still the create-next-app starter, including “Create Next App” metadata.
- `src/db/schema/index.ts` contains only Better Auth tables; Dataset, Import, Query, Dashboard, Job, and audit schemas do not exist yet.
- `src/modules/auth/auth.ts` has no configured custom roles, personal-Organization signup hook, email delivery, or membership re-verification request-context implementation.
- `src/db/schema/auth.ts` has no unique composite constraint for Organization membership and no `updatedAt` field even though the timezone decision's example type includes it.
- `src/db/analytical.ts` exposes a 30-second pool timeout without a separate import-load contract.
- `src/shared/env.ts` permits partially configured storage and Trigger.dev variables. A production validation rule should require all variables for an enabled provider together.
- `.env.example` has no local S3-compatible service configuration and documents an inline dispatcher that the job rules limit to tests and CI.
- `drizzle.config.ts` reads `process.env` directly even though the repository rule says `src/shared/env.ts` is the only application environment reader. Decide whether tooling configuration is an explicit exception and document it.
- There is no `playwright.config.ts` or E2E test suite yet.
- `tests/fixtures/README.md` and `scripts/fixtures/README.md` are referenced by fixture comments but are absent.
- The top-level `README.md` is still the generated Next.js README and does not explain local PostgreSQL ports, migrations, docs precedence, fixture generation, or test commands.

### Checks Run During This Audit

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: passed, 2 files and 5 tests.
- `pnpm build`: passed; only starter routes currently exist.
- `pnpm format:check`: failed on the pre-existing `.oxlintrc.json`; the audit file itself was not reported.
- `pnpm test:e2e -- --list`: failed. Playwright discovered Vitest files because no Playwright configuration/test boundary exists; the command reported the Vitest CommonJS import error and then `No tests found`.

The passing checks validate the scaffold, not the Dataset, Import, Query, Dashboard, tenant-isolation, or AI contracts. No integration suite currently exercises those domains.

## Recommended Documentation Set

The existing documents can remain, but these canonical contracts would remove most ambiguity before Slice 1:

1. `docs/contracts/request-context-and-authorization.md`
   - Request-context creation, active Organization verification, complete permission matrix, ownership rules, and safe DTOs.
2. `docs/contracts/dataset-and-import.md`
   - Logical schema, physical mapping, import state machine, CSV dialect, type inference, retries, and deletion.
3. `docs/contracts/query.md`
   - Versioned QueryAst, filter semantics, compiler allowlist, limits, result shape, cancellation, and error mapping.
4. `docs/contracts/dashboard.md`
   - Widget query references, revision conflict policy, layout model, filters, save status, and visualization validation.
5. `docs/contracts/storage-and-retention.md`
   - Signed upload finalization, object keys, checksums, retention, deletion, and local/test providers.
6. `docs/contracts/operations.md`
   - Environment modes, migrations, Trigger.dev deployment, backups, restore, monitoring, RPO/RTO, and incident handling.
7. `docs/decisions/07-ai-data-policy.md`
   - Provider, data sent to the model, redaction, retention, costs, limits, and prompt-injection handling.

These are recommendations for future documentation organization, not files created by this audit.

## Recommended Build Gate

Do not begin the full roadmap in `docs/reference/Datalize.md`. Use this order:

### Gate 0: Product truth

- Confirm the first persona and one measurable workflow.
- Resolve the mixed-currency and MRR/churn claims.
- Generate reproducible fixtures, including invalid CSV, schema-change, DST, and concurrency cases.

### Gate 1: Runtime and schema truth

- Resolve Better Auth schema/migration ownership.
- Configure the four roles or their single mapping layer.
- Define the analytical schema, mapping metadata, import pool, and cleanup strategy.
- Implement durable job dispatch and local/test modes.

### Gate 2: Query truth

- Publish one canonical QueryAst and QueryResult contract.
- Fix requested-limit semantics.
- Add cell/byte/complexity limits, deterministic ordering, cancellation, and timeout behavior.
- Test timezone, date-only values, DST, decimals, nulls, and schema evolution.

### Gate 3: User-visible loop

- Ship import profile/confirmation/load.
- Ship schema preview, table results, and bar results.
- Ship a bounded dashboard grid with revision-checked saves.
- Test the complete flow and Organization A versus Organization B isolation.

### Gate 4: Pilot readiness

- Add rate limits, deletion, retention, backup restore, audit events, operational metrics, and error redaction.
- Add team invitations only if the pilot needs them.
- Add Playwright configuration and critical browser journeys.

### Gate 5: AI

- Resolve the AI data policy and provider.
- Add read-only tools, bounded result context, provenance, cost limits, and explicit user approval for mutations.

## Final Recommendation

No architectural reset is needed. The right implementation is still a bounded PostgreSQL-backed modular monolith with Trigger.dev imports and a strict typed query boundary. The next improvement is documentation closure, not adding more services.

The project should be considered ready for Slice 1 only after C1-C8 are resolved in binding documents and covered by tests. The original reference document should remain available for future product expansion, but it should not drive current implementation decisions.
