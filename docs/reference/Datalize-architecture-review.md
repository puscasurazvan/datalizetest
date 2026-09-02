# Datalize Architecture Review

**Reviewed:** 2026-09-02  
**Sources:** `Datalize.md`, `Datalize-improved-architecture.md`

## Verdict

Use `Datalize-improved-architecture.md` as the starting point. Keep `Datalize.md` as a long-term product and production reference, not as the first implementation plan.

The improved document has the right overall direction: a modular monolith, PostgreSQL as the application source of truth, typed query generation, explicit tenant authorization, asynchronous imports, and read-only AI. It is not yet implementation-ready because several important contracts are described as interfaces or principles without defining the behavior that keeps data, tenants, jobs, and dashboard state safe.

The best approach for a potentially commercial product is a **commercial-lean MVP**:

- Validate the CSV-to-answer workflow before building integrations, billing, public sharing, or a general data platform.
- Keep boundaries where changing technology later is realistic: analytical storage, object storage, jobs, and AI providers.
- Do not add infrastructure merely because the architecture diagram contains it.
- Do not weaken tenant isolation, data retention, backups, or observability for the prototype.

## What The Improved Document Gets Right

- It makes one end-to-end workflow the first product goal.
- It correctly defers connectors, billing, public APIs, scheduled reports, Redis, and advanced analytical engines.
- It treats AI as a typed application capability rather than a database superuser.
- It puts authorization and organization scoping in the service boundary.
- It separates application metadata from analytical data and introduces an analytical-store interface.
- It makes imports asynchronous and calls out idempotency, retries, limits, auditability, and safe errors.
- It narrows the initial visualization set and requires loading, empty, error, accessibility, and responsive states.
- Its vertical-slice roadmap is much better than the original document's infrastructure-heavy phase ordering.

## Findings Before Coding

### High Priority

#### 1. Analytical storage is not specified precisely enough

`AnalyticalStore` is a good boundary, but the documents do not define how CSV rows are physically stored in PostgreSQL. A query compiler cannot be implemented safely until this is decided.

Recommended MVP choice:

- Store application metadata in normal PostgreSQL tables.
- Store each imported dataset version in a server-created physical table in a dedicated analytical schema. Do not use an untyped JSONB row blob.
- Keep a server-owned mapping from opaque column IDs to physical column names and PostgreSQL types.
- Use a separate analytical connection pool and strict statement and result limits.
- Start with explicit limits, such as a benchmarked file-size, row-count, and column-count ceiling. Do not promise unlimited CSV analytics.
- Keep the `AnalyticalStore` interface so a DuckDB/Parquet implementation can replace it when measured workload justifies that change.

Every analytical-store method must receive trusted request context, or an already-authorized dataset reference. The current examples accept only `datasetId`, which makes it too easy to accidentally create an unscoped access path.

```ts
type AnalyticalStoreContext = {
  organizationId: string
  datasetId: string
  datasetVersionId: string
}
```

Do not commit to DuckDB/Parquet before measuring the first workflow. It may be the right next engine, but it adds worker, object-storage, and query-runtime complexity immediately.

#### 2. Dataset versioning is missing

The documents use `dataset_version` in cache keys, AI provenance, and query execution records, but the data model has no dataset-version entity or lifecycle.

Define at least:

- `datasets`: stable identity, organization, display metadata, current version.
- `dataset_versions`: immutable import result, schema hash, content hash, row count, status, and timestamps.
- `dataset_columns`: version-specific column IDs, names, types, ordinal, and nullability.
- `imports`: source object key, idempotency key, job reference, counters, and failure details.

Decide whether saved queries target the latest compatible version or an explicit version. Record the resolved version on every execution. A dashboard must not silently use a changed schema without validation and a visible failure state.

#### 3. Tenant context must be impossible to omit

The security principles are correct, but the API examples still permit unsafe shapes:

- `getDataset({ datasetId })`
- `executeQuery({ query })`
- `AnalyticalStore.getSchema(datasetId)`
- AI tools that receive `organizationId` as tool input

The model or browser must never choose the organization context. Derive it from the authenticated session and membership lookup, then pass a server-created context through services and repositories. AI tools should close over this context rather than accept `userId` or `organizationId` from model-generated arguments.

Use resource-aware authorization, for example:

```ts
authorize(context, "dashboard:update", { dashboardId })
```

Do not expose a generic `can(user, permission)` function that lacks organization and resource context. Add cross-organization read, update, delete, query, export, and background-job tests before any external pilot.

#### 4. Background execution needs one concrete runtime

The improved document says to begin with a database-backed worker and adopt Trigger.dev later, while the original document assumes Trigger.dev from the start. This is an unresolved deployment decision, not a harmless abstraction.

For a Vercel-hosted commercial MVP, use Trigger.dev from the first asynchronous import, or explicitly choose Vercel Workflows and remove Trigger.dev from the plan. Do not run a polling worker inside a Vercel request or rely on an unawaited promise after returning a response.

Whichever runtime is selected:

- Persist the job/import row before dispatching.
- Use an outbox or a retryable dispatcher so a database commit cannot be separated permanently from enqueueing.
- Put only internal IDs in the job payload.
- Re-check organization ownership, state, and idempotency inside the worker.
- Persist progress and terminal state in PostgreSQL.
- Make retries safe at batch boundaries.

#### 5. Query execution should not be forced through Server Actions

Server Actions are appropriate for UI mutations, but interactive query execution has different needs: cancellation, independent widget requests, structured errors, and parallelism. Current Next.js documentation also states that client-dispatched Server Actions are processed sequentially per client.

Use:

- Server Components for initial authenticated reads and page composition.
- Server Actions for dashboard, query, and import mutations initiated by the application UI.
- A protected Route Handler for interactive query execution and polling when the browser needs independent, cancellable requests.
- The same service, authorization, validation, and query compiler below both entry points.

The route is still an internal application boundary; it must not bypass the security rules that apply to a public API.

#### 6. Dashboard persistence needs a conflict contract

Optimistic local editing and debounced saves are good UX, but they are not a persistence strategy by themselves. Define:

- A single canonical widget query reference. Do not allow both an optional saved query and an optional inline query without precedence rules.
- A dashboard revision or compare-and-swap token on every save.
- Server rejection of stale revisions rather than silent last-write-wins overwrites.
- A recovery path for failed saves and navigation with unsaved changes.
- Validation of layout bounds, widget configuration, and query references on the server.

For the MVP, make a widget reference one validated saved-query snapshot. Editing the query creates or selects a new snapshot; the widget never has two competing query definitions.

#### 7. The AI data and privacy boundary is incomplete

Typed tools and read-only behavior are necessary but not sufficient. The documents need explicit rules for:

- Maximum cells or bytes sent to a model.
- Sensitive-column handling and redaction.
- Untrusted dataset values that may contain prompt-injection text.
- Provider retention and training policy.
- Model, token, latency, and per-organization cost limits.
- Timeout, retry, and malformed-output behavior.
- What is stored in AI history and how it is deleted.

Treat column names, descriptions, and query results as untrusted data, not instructions. The model may propose a validated `QueryAst`; the server remains the only component that authorizes and executes it. Keep dashboard mutations behind explicit user actions as the improved document specifies.

### Medium Priority

#### 8. The MVP still contains two avoidable complexity traps

- **Dashboard layout:** dnd-kit provides drag-and-drop primitives, sensors, and sortable behavior; it is not a complete responsive grid and resize engine. For the first data-to-chart release, use a fixed 12-column layout with preset sizes and keyboard controls, or validate a dedicated grid library in a small spike before committing to free-form resize.
- **Global dashboard filters:** cross-widget filter propagation depends on compatible dataset columns, types, and query semantics. Start with per-widget filters. Add global filters after the query and visualization contracts are stable.

Defer undo/redo, duplicate, arbitrary resize, and complex cross-widget filter mapping unless early users demonstrate that they are essential to the first value moment.

#### 9. Authentication and organization ownership need a clear split

Better Auth can provide authentication and organization membership through its organization plugin. The project should not create a second organization or membership system with overlapping lifecycle rules.

Define which tables and workflows Better Auth owns, then add only Datalize-owned records and policies around them. Map `owner`, `admin`, `editor`, and `viewer` to one permission model. If Better Auth's access controller is used for coarse role permissions, resource ownership and tenant checks still belong in Datalize services.

Email verification, password reset, session invalidation, trusted origins, and invitation expiry require an email provider and should be included before inviting real customer users, even if they are not needed for a solo local demo.

#### 10. Rate limiting, retention, deletion, and recovery are not optional commercial extras

Redis can remain deferred as a general cache. Rate limiting cannot be deferred until after a public beta. Use a small rate-limit adapter with a database or managed-provider implementation first, then introduce Redis based on observed contention.

Before storing external customer data, define:

- Raw-file retention and deletion behavior.
- Organization and account deletion cascades.
- Backup retention and a tested restore procedure.
- Sentry/log redaction rules.
- AI provider data-processing terms.
- Signed URL expiry and object-key ownership.
- CSV export formula-injection handling.

#### 11. The query and visualization contracts need tighter types

The improved `QueryAst` is a strong start, but `field: string` and `value: unknown` leave critical validation to convention. Add:

- Opaque column IDs resolved through the dataset schema.
- Type-specific filter values and operator compatibility.
- A defined representation for count-all versus count-a-field.
- A clear rule for ordering by dimensions, measures, and aliases.
- Hard bounds on dimensions, measures, filters, limit, and returned cells.
- Explicit timezone and date-granularity behavior.

Define a result contract that includes result columns and types, rows, truncation, row/cell counts, query hash, and resolved dataset version. Use a discriminated `VisualizationConfig` per chart type and validate it against the query result before rendering.

## Reconciliation Of The Two Documents

| Area             | Original document                                                                                            | Improved document                                   | Recommendation                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| Product scope    | CSV, PostgreSQL, REST, and Stripe are initial integrations; reports, billing, sharing, and API are prominent | CSV-first and most expansion features deferred      | Use the improved scope                                                        |
| Delivery order   | Dashboard work precedes the data platform                                                                    | Data-to-chart precedes dashboards                   | Use the improved vertical slices                                              |
| Infrastructure   | Redis and Trigger.dev are assumed early                                                                      | Redis is deferred; job runtime remains undecided    | Defer cache; choose one concrete job runtime before coding                    |
| Data model       | Includes future billing, API, reports, notifications, and credentials                                        | Defers most of them                                 | Do not create deferred tables early                                           |
| Query AST        | Informal field strings, `equals`, and `OFFSET`                                                               | Versioned AST with explicit operators and no offset | Use the improved AST, then tighten its types                                  |
| AI               | Includes create/update dashboard tools in the initial tool list                                              | Read-only tools and explicit user approval          | Use the improved read-only policy                                             |
| Visualization    | Large chart list and `xAxis`/`series` configuration                                                          | Small chart set and `x`/`y` configuration           | Use one discriminated schema from the improved document                       |
| Dashboard widget | `queryId` is effectively required                                                                            | `queryId` and inline `query` are both possible      | Make one validated saved-query snapshot canonical                             |
| Data sources     | Connector abstraction is part of the initial design                                                          | Adapter is roadmap material                         | Do not build a generic adapter until the first external connector is approved |
| Jobs             | Trigger.dev is the assumed worker                                                                            | Database worker first, hosted platform later        | Select and document one runtime; do not leave this ambiguous                  |

The original document also contains a duplicated `Create dashboard` step in its transaction example and has several sections that describe production expansion as MVP scope. Those are documentation defects, not reasons to use it as the build plan.

## Recommended Target Architecture

```text
Browser
  |
  +-- Server Components: authenticated reads and composition
  +-- Server Actions: validated application mutations
  +-- Protected Route Handlers: interactive query execution and uploads
  |
  v
Request context
  - authenticated user
  - resolved organization membership
  - explicit permission
  |
  v
Application services
  - datasets and imports
  - query validation/compiler
  - dashboards and revisions
  - AI tools
  |
  +-- Repositories --> PostgreSQL application schema
  +-- AnalyticalStore --> bounded PostgreSQL dataset tables
  +-- StorageProvider --> S3-compatible object storage
  +-- JobDispatcher --> one durable job runtime
  |
  v
Validated DTOs and structured errors
```

Keep `organizationId` in every tenant-owned record and require it in every repository and analytical-store operation. Keep physical dataset identifiers and storage keys server-generated. Do not expose Drizzle models, physical table names, raw credentials, or arbitrary SQL to the browser or model.

## Revised Build Order

### Slice 0: Product and technical foundation

- Define the first customer persona, representative CSV fixtures, and the first-value workflow.
- Create the Next.js, TypeScript, PostgreSQL, migration, environment, and CI foundation.
- Configure Better Auth and its organization schema ownership.
- Implement one request-context and permission policy path.
- Add error reporting with sensitive-data scrubbing.

### Slice 1: CSV to trustworthy query result

- Complete the analytical-storage spike and record its benchmark and limits.
- Add signed upload, import records, durable job dispatch, streaming CSV parsing, deterministic type inference, and versioned datasets.
- Add schema and preview DTOs.
- Implement the versioned QueryAst, schema validator, allowlisted compiler, statement timeout, and result contract.
- Ship table and bar visualizations.

### Slice 2: Dashboard loop

- Add dashboard and widget CRUD with server-side authorization.
- Use saved-query snapshots and revision-checked persistence.
- Start with a bounded grid, preset sizes, keyboard controls, and explicit save status.
- Add KPI, line, and area visualizations only after the adapter contract is tested.

### Slice 3: Reliability and pilot readiness

- Add import/query idempotency, retry and cancellation behavior, audit events, rate limits, backups, restore testing, deletion flows, and tenant-isolation tests.
- Add critical Playwright coverage for signup/workspace/import/query/chart/dashboard/reload.
- Add metrics for import success, query latency, query failures, job failures, and storage usage.
- Add invitations and member management if the pilot includes teams.

### Slice 4: Read-only AI assistance

- Add metadata tools, validated QueryAst generation, authorized execution, bounded result explanation, visualization suggestions, provenance, usage limits, and provider failure handling.
- Keep saving a widget or changing a dashboard as a separate explicit user action.

### Slice 5: Evidence-based expansion

- Add global filters, richer layout editing, exports, the first external connector, billing/entitlements, scheduled reports, Redis, and alternate analytical storage only when customer evidence or measured workload requires them.

## MVP Exit Criteria

The first release is ready for controlled external use when all of the following are true:

- A new user can sign up, create a workspace, upload a representative CSV, inspect the schema, build a query, view a chart, add it to a dashboard, reload, and see the saved result.
- Repeating the same import does not duplicate the dataset version or rows.
- Every protected read, write, query, export, and job execution is organization-scoped and covered by an authorization test.
- Query compilation cannot use an unrecognized dataset column or physical identifier.
- Queries and imports have hard resource limits and safe user-facing errors.
- A stale dashboard save is rejected or reconciled visibly; it cannot silently overwrite a newer revision.
- Raw rows, credentials, tokens, and secrets are absent from logs and error reports.
- AI failure leaves CSV, queries, charts, and dashboards usable.
- Backups have been restored successfully in a non-production environment.
- Critical browser flows pass in CI.

## Decisions Required Before Implementation

1. Initial analytical storage shape and benchmark limits.
2. Dataset-version and saved-query version semantics.
3. Better Auth versus Datalize ownership of organization tables and role definitions.
4. One durable job runtime and its dispatch/retry mechanism.
5. Route boundary for interactive query execution.
6. Dashboard conflict policy and minimum editor feature set.
7. AI provider, data-retention policy, redaction rules, and usage budget.
8. First customer persona, sample datasets, and measurable pilot success criteria.

Once these decisions are recorded, the improved document can serve as the architecture baseline and a separate implementation plan can be written. Until then, starting with the original document would create too much infrastructure and too many product surfaces before the core workflow is proven.

## Current Reference Material

These implementation details should be verified again when dependencies are installed:

- Next.js Server Actions security, body limits, and sequential client dispatch: <https://nextjs.org/docs/app/guides/server-actions>
- Better Auth organization plugin and custom permissions: <https://better-auth.com/docs/plugins/organization>
- Trigger.dev Vercel integration and atomic task deployments: <https://trigger.dev/docs/vercel-integration>
- dnd-kit capabilities and extension model: <https://dndkit.com/>
- Vercel function and background-work constraints: <https://vercel.com/kb/guide/how-to-run-background-jobs-in-nextjs-on-vercel>
