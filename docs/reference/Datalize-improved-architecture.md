# Datalize

> **Turn operational data into clear, trustworthy decisions.**

Datalize is a multi-tenant analytics product that lets teams import or connect data, explore it safely, build dashboards, share reports, and use AI to ask questions about their data.

The product should feel focused: a lightweight analytics workspace for teams that need insight without adopting a full data warehouse or enterprise BI platform.

---

## Product Goal

The first version must make one workflow excellent:

```text
Create workspace
  ↓
Upload CSV
  ↓
Inspect data
  ↓
Build a query
  ↓
Create a chart
  ↓
Add it to a dashboard
  ↓
Ask AI to explain or refine it
```

Datalize is not initially:

- A general-purpose data warehouse
- A transformation platform
- A no-code ETL platform
- A full enterprise BI replacement
- An unrestricted SQL interface

---

## Product Principles

### Vertical slices first

Build complete, user-visible workflows rather than infrastructure layers in isolation.

A feature is valuable only when a user can complete an end-to-end task with it.

### Modular monolith first

Start with one deployable Next.js application and clear internal module boundaries. Extract services only when workload, ownership, or deployment needs demand it.

### PostgreSQL owns application state

PostgreSQL is authoritative for users, organizations, permissions, dashboards, saved queries, imports, audit logs, billing state, and job state.

### Analytical storage is replaceable

Imported data may start in PostgreSQL, but query execution and dataset storage must sit behind interfaces so larger workloads can move to DuckDB, Parquet, ClickHouse, or a customer warehouse later.

### AI is constrained application logic

AI uses authorized, typed tools. It never receives unrestricted database credentials or direct arbitrary SQL access.

### Security is enforced at every boundary

Every protected operation authenticates the caller, resolves the organization, verifies permission, validates input, and scopes resource access to the tenant.

---

## MVP Scope

### Include

- Email/password authentication
- Workspace creation and switching
- Roles: owner, admin, editor, viewer
- CSV upload and asynchronous import
- Dataset schema discovery and preview
- A constrained visual query builder
- Line, bar, area, KPI, and table widgets
- Dashboard creation, editing, autosave, and filters
- Read-only AI questions that generate safe structured queries
- Basic audit logs, error reporting, and critical end-to-end tests

### Defer

- Generic REST API connector
- Multiple external integrations
- Complex joins and arbitrary SQL
- Custom calculated-field language
- Scheduled reports
- Public dashboards
- API keys and public API
- Billing and entitlements
- Redis and distributed caching
- Advanced tracing and product analytics
- Enterprise SSO, SCIM, and advanced compliance features

---

## Core Architecture

```text
Browser
  ↓
Next.js App Router
  ├── Server Components: reads and composition
  ├── Server Actions: authenticated application mutations
  └── Route Handlers: webhooks, uploads, external APIs
  ↓
Auth and authorization policy
  ↓
Application services
  ↓
Repositories and query compiler
  ↓
PostgreSQL
  ├── Application metadata
  ├── Tenant and permission records
  ├── Job and audit state
  └── Initial small-to-medium datasets
  ↓
Object storage
  └── Raw uploads and generated exports
```

Long-running work is added behind a job interface:

```text
Import request
  ↓
Job record in PostgreSQL
  ↓
Worker or job platform
  ↓
Import, export, sync, or report execution
  ↓
Job status, progress, and result persisted in PostgreSQL
```

---

## Technology Choices

| Concern                | Initial choice                                      | Notes                                              |
| ---------------------- | --------------------------------------------------- | -------------------------------------------------- |
| Application runtime    | Next.js, React, TypeScript                          | App Router; server rendering by default            |
| Styling                | Tailwind CSS, shadcn/ui, Radix UI                   | One component foundation                           |
| Validation             | Zod                                                 | Validate all external and AI-provided input        |
| Forms                  | React Hook Form                                     | Use only for complex interactive forms             |
| Database               | PostgreSQL                                          | System of record and initial data store            |
| ORM and migrations     | Drizzle ORM and Drizzle Kit                         | Use committed migrations in production             |
| Authentication         | Better Auth                                         | Organizations and membership support               |
| Tables                 | TanStack Table and Virtual                          | Virtualize large previews                          |
| Charts                 | Apache ECharts                                      | Keep behind a Datalize chart adapter               |
| Dashboard interactions | dnd-kit                                             | Add keyboard-accessible alternatives               |
| Editor state           | Zustand                                             | Local editor state only                            |
| Server state           | Server Components first; TanStack Query selectively | Polling, optimistic updates, interactive execution |
| Object storage         | S3-compatible storage                               | Signed uploads and downloads                       |
| AI                     | Vercel AI SDK and Zod                               | Structured outputs and tool calls                  |
| Testing                | Vitest, Testing Library, Playwright                 | Unit, integration, and critical flows              |
| Error reporting        | Sentry                                              | Add early, before wider beta                       |

---

## Module Boundaries

```text
src/
├── app/
│   ├── (marketing)/
│   ├── (auth)/
│   ├── app/
│   │   ├── dashboards/
│   │   ├── datasets/
│   │   ├── imports/
│   │   ├── queries/
│   │   └── settings/
│   └── api/
│       ├── auth/
│       ├── uploads/
│       ├── webhooks/
│       └── v1/
├── modules/
│   ├── auth/
│   ├── organizations/
│   ├── datasets/
│   ├── imports/
│   ├── queries/
│   ├── dashboards/
│   ├── visualizations/
│   ├── ai/
│   ├── jobs/
│   └── audit/
├── db/
│   ├── schema/
│   ├── migrations/
│   └── client.ts
├── shared/
│   ├── validation/
│   ├── errors/
│   ├── observability/
│   └── types/
└── components/
    ├── ui/
    ├── dashboard/
    ├── dataset/
    ├── query-builder/
    └── charts/
```

Each module owns its:

- Domain types
- Validation schemas
- Policies and permission checks
- Services
- Repositories
- Server Actions and route-level adapters
- Tests

Avoid a large global `lib/` directory that becomes a second unowned application.

---

## Request Boundaries

### Server Components

Use for authenticated reads and page composition.

```text
Page
  ↓
Require session
  ↓
Resolve active organization
  ↓
Call service
  ↓
Render DTO
```

### Server Actions

Use for mutations originating from the application UI.

```text
Authenticate
  ↓
Validate input
  ↓
Resolve organization
  ↓
Authorize action
  ↓
Call service
  ↓
Revalidate affected paths
  ↓
Return safe result
```

### Route Handlers

Use for external HTTP boundaries only:

- Webhooks
- File upload negotiation
- OAuth callbacks
- Public API, when introduced
- Third-party integration callbacks

Route Handlers must use the same authentication, authorization, validation, rate-limit, and response-sanitization discipline as a public API.

---

## Authorization Model

The organization is the tenant boundary.

```text
User
  ├── Organization A
  │   ├── Members
  │   ├── Datasets
  │   ├── Dashboards
  │   └── Queries
  └── Organization B
      ├── Members
      ├── Datasets
      ├── Dashboards
      └── Queries
```

Roles:

```text
OWNER
ADMIN
EDITOR
VIEWER
```

Use explicit permissions rather than checking roles directly throughout application code.

```ts
assertCan(context, "dashboard:update", dashboard)
assertCan(context, "dataset:read", dataset)
assertCan(context, "dataset:manage", dataset)
```

Every tenant-owned query includes the organization scope:

```ts
getDashboard({ organizationId, dashboardId })
getDataset({ organizationId, datasetId })
executeQuery({ organizationId, userId, query })
```

Never authorize access merely because a request contains a valid resource ID.

---

## Data Model

### Application tables

```text
users
organizations
organization_members
invitations

datasets
dataset_columns
imports
import_errors

dashboards
dashboard_widgets
dashboard_filters

saved_queries
query_executions

jobs
audit_logs
```

### Deferred tables

```text
data_source_credentials
report_schedules
subscriptions
billing_events
api_keys
webhook_events
notifications
```

Every tenant-owned record contains `organization_id`. Use foreign keys, constraints, deliberate indexes, timestamps, and transactions for multi-step mutations.

Use JSONB only where flexibility is intrinsic, for example chart configuration and widget layout.

---

## Dataset Storage Strategy

Datalize needs two different data concerns:

```text
Application data
  → PostgreSQL is authoritative

Analytical dataset data
  → PostgreSQL initially, replaceable later
```

Create a stable interface:

```ts
interface AnalyticalStore {
  createDataset(input: CreateDatasetInput): Promise<Dataset>
  getSchema(datasetId: string): Promise<DatasetSchema>
  preview(datasetId: string, options: PreviewOptions): Promise<PreviewResult>
  execute(query: QueryAst): Promise<QueryResult>
  deleteDataset(datasetId: string): Promise<void>
}
```

Initial implementation:

```text
PostgresAnalyticalStore
```

Future implementations may include:

```text
DuckDB and Parquet for larger file-based analytics
ClickHouse for high-volume shared analytical workloads
Customer warehouse adapters for enterprise plans
```

Do not build these future engines before usage data requires them.

---

## CSV Import Pipeline

CSV imports are asynchronous and idempotent.

```text
User selects file
  ↓
Validate size, filename, content type, and signature where relevant
  ↓
Create signed upload URL
  ↓
Upload directly to object storage
  ↓
Create import record and job
  ↓
Worker streams file
  ↓
Detect headers, encoding, types, and invalid rows
  ↓
Persist dataset schema and data
  ↓
Mark import completed or failed
```

Import states:

```text
PENDING
QUEUED
RUNNING
COMPLETED
FAILED
CANCELLED
```

Type inference must be deterministic and user-overridable.

Initial supported types:

```text
string
integer
decimal
boolean
date
datetime
```

Define product limits from the start:

```text
Maximum file size
Maximum rows
Maximum columns
Maximum import duration
Maximum retained raw file size
```

---

## Query Engine

Queries are structured and validated. Neither users nor AI send arbitrary SQL to the database.

```ts
type QueryAst = {
  version: 1
  datasetId: string
  dimensions: Array<{
    field: string
    granularity?: "day" | "week" | "month" | "quarter" | "year"
  }>
  measures: Array<{
    field: string
    aggregation: "count" | "count_distinct" | "sum" | "avg" | "min" | "max"
    alias?: string
  }>
  filters: Array<{
    field: string
    operator:
      "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "between" | "in" | "is_null" | "is_not_null"
    value?: unknown
  }>
  orderBy?: Array<{
    field: string
    direction: "asc" | "desc"
  }>
  limit?: number
}
```

Execution path:

```text
Manual builder or AI tool
  ↓
Zod validation
  ↓
Dataset schema validation
  ↓
Authorization and tenant checks
  ↓
Complexity and plan-limit checks
  ↓
Parameterized SQL compiler
  ↓
Analytical store
  ↓
Structured result
```

Initial capabilities:

- Dimensions and date grouping
- Count, distinct count, sum, average, minimum, maximum
- Basic filters
- Sort and limit
- Tabular result and chart-ready result

Defer joins, window functions, calculated fields, nested queries, pivots, arbitrary SQL, cohort analysis, and retention analysis.

---

## Query Safety and Limits

Every execution records:

```text
query_execution_id
organization_id
user_id
dataset_id
query_hash
status
started_at
completed_at
duration_ms
row_count
error_code
```

Apply limits before execution:

```text
Maximum returned rows
Maximum execution time
Maximum concurrent executions per organization
Maximum dimensions and measures
Maximum filter complexity
Maximum export size
```

Query cache keys must include tenant and data version:

```text
organization_id + query_hash + dataset_version
```

Do not cache raw data across organization boundaries.

---

## Dashboard System

```text
Dashboard
  ├── Dashboard filters
  └── Widgets
      ├── Saved query or inline QueryAst
      ├── Visualization configuration
      ├── Layout
      └── Presentation settings
```

Widget model:

```ts
type DashboardWidget = {
  id: string
  dashboardId: string
  queryId?: string
  query?: QueryAst
  visualization: VisualizationConfig
  layout: WidgetLayout
}
```

The editor uses optimistic local interaction state:

```text
User moves, resizes, or configures widget
  ↓
Local editor state updates immediately
  ↓
Debounced, serialized save
  ↓
Server-side validation and authorization
  ↓
Persisted dashboard revision
```

Start with:

```text
KPI
Line
Area
Bar
Table
```

Add pie, scatter, heatmap, funnel, gauge, treemap, and maps only after the chart configuration model is stable.

---

## Visualization Boundary

The application should not expose Apache ECharts configuration outside the visualization module.

```text
Query result
  ↓
Datalize VisualizationConfig
  ↓
Chart adapter
  ↓
Apache ECharts option
```

```ts
type VisualizationConfig = {
  type: "kpi" | "line" | "area" | "bar" | "table"
  x?: { field: string; label?: string }
  y?: Array<{ field: string; label?: string }>
  title?: string
  format?: "number" | "currency" | "percent"
}
```

Every widget must explicitly handle:

```text
Loading
Empty
Error
Data
```

It must also support responsive sizing, light and dark themes, reduced motion, and accessible text alternatives.

---

## AI System

AI starts as a read-only analytical assistant.

```text
User question
  ↓
Fetch only permitted dataset metadata
  ↓
Model chooses typed tool
  ↓
Generate QueryAst
  ↓
Validate tool arguments and query schema
  ↓
Authorize query
  ↓
Execute query within limits
  ↓
Return result, explanation, and provenance
```

Initial AI tools:

```text
getDatasets
getDatasetSchema
runQuery
suggestVisualization
explainQueryResult
```

AI response shape:

```ts
type AiAnalysisResponse = {
  query: QueryAst
  interpretation: string
  limitations: string[]
  provenance: {
    datasetId: string
    datasetVersion: string
    appliedFilters: QueryAst["filters"]
    generatedAt: string
  }
  result: QueryResult
}
```

AI must not:

- Access Drizzle directly
- Access raw credentials
- Generate arbitrary SQL
- Override permissions
- Imply causation when the data only shows correlation
- Create or change dashboards without an explicit user approval step

Mutation policy:

```text
Run a read-only query: automatic after validation
Suggest a chart: automatic after validation
Save a widget: explicit user action
Create a dashboard: explicit user action
Modify a dashboard: explicit user action
```

---

## Jobs and Background Work

Define a job abstraction before choosing a hosted platform.

```ts
interface JobDispatcher {
  enqueue(type: JobType, payload: JobPayload, options?: JobOptions): Promise<JobReference>
}
```

Initial jobs:

```text
CSV_IMPORT
CSV_EXPORT
```

Later jobs:

```text
DATA_SOURCE_SYNC
REPORT_GENERATION
SCHEDULED_REPORT
AI_LONG_RUNNING_ANALYSIS
WEBHOOK_PROCESSING
```

Each job requires:

- A durable job record
- Idempotency key
- Retry policy and exponential backoff
- Cancellation state
- Progress updates
- Safe structured logs
- A resource-ownership check at execution time

Superseded by `docs/adr/0001-triggerdev-as-job-runtime.md`: Trigger.dev is the job runtime from the first asynchronous import. A database-backed polling worker has no home on Vercel, and adopting a job platform later would mean rewriting the import pipeline mid-MVP.

---

## Integrations Roadmap

Build integrations through an adapter boundary:

```ts
interface DataSourceAdapter {
  testConnection(input: ConnectionInput): Promise<ConnectionResult>
  discoverSchema(source: DataSource): Promise<DatasetSchema[]>
  sync(input: SyncInput): Promise<SyncResult>
  disconnect(source: DataSource): Promise<void>
}
```

Recommended sequence:

```text
1. CSV upload
2. Read-only PostgreSQL connector
3. Stripe connector
4. Generic REST API connector
```

The generic REST API connector is deliberately later because pagination, authentication schemes, rate limiting, nested data, schema drift, incremental sync, and retry behavior make it a product of its own.

---

## Security Baseline

Every protected operation follows this order:

```text
Authenticate
  ↓
Resolve active organization
  ↓
Validate input
  ↓
Authorize permission on resource
  ↓
Execute service operation
  ↓
Return a safe DTO
```

Requirements:

- Scope every tenant-owned query by `organization_id`
- Use parameterized queries only
- Validate requests, files, webhooks, API keys, and AI arguments with Zod
- Encrypt third-party credentials at rest
- Never return credentials, internal IDs, or raw database models unnecessarily
- Verify webhook signatures before processing
- Persist webhook IDs and enforce idempotency
- Use secure, expiring signed URLs for files
- Do not log customer datasets, raw credentials, or secrets
- Rate limit authentication, imports, exports, AI calls, and external APIs
- Review every public dashboard or API as a separate security boundary

Add PostgreSQL Row-Level Security as defense in depth once data access patterns and connection behavior are fully understood; application-level tenant scoping remains mandatory.

---

## Observability

Add error tracking early, then expand observability when usage justifies it.

### MVP

```text
Sentry
Structured logs
Request IDs
Import and query execution records
```

### Later

```text
OpenTelemetry traces
Redis-backed caching metrics
Product analytics
Job-platform monitoring
Slow-query dashboards
```

Never include raw dataset rows, credentials, access tokens, or secrets in logs, errors, analytics, or traces.

---

## Testing Strategy

### Unit tests

```text
Validation schemas
Permission policies
Query AST validation
Query compiler
Data type inference
Visualization mapping
Entitlement rules when introduced
```

### Integration tests

```text
Tenant-scoped repositories
Service workflows
Database transactions
CSV import pipeline
Authorization failures
Job idempotency
```

### End-to-end tests

```text
Signup → workspace → CSV import → dataset → query → chart → dashboard → reload

User in organization A attempts to access organization B resource → rejected

AI question → validated QueryAst → authorized execution → chart suggestion
```

Every bug fix adds a regression test. Tenant isolation and permission boundaries are not optional test coverage.

---

## Delivery Roadmap

### Slice 0: Foundation

```text
Next.js application
TypeScript and linting
PostgreSQL and migrations
Authentication
Organization membership
Permission policy
Application shell
CI pipeline
```

### Slice 1: Data to chart

```text
Signed CSV upload
Import job record
CSV processing
Dataset schema and preview
QueryAst and compiler
Table and bar chart
Saved query
```

### Slice 2: Dashboard loop

```text
Dashboard CRUD
Widget CRUD
Widget layout
Autosave
Dashboard filters
KPI, line, and area charts
Keyboard-accessible editing controls
```

### Slice 3: Reliability

```text
Import retry and idempotency
Query limits
Audit events
Sentry
Tenant-isolation tests
Critical Playwright journeys
```

### Slice 4: AI assistance

```text
Dataset metadata tools
AI-generated QueryAst
Validation and authorization
Result explanation
Visualization suggestions
Provenance display
```

### Slice 5: Product expansion

```text
PostgreSQL connector
Exports
Invitations
Additional roles and controls
Stripe billing and entitlements
Scheduled reports
```

### Slice 6: Scale based on evidence

```text
Redis
Dedicated job platform
DuckDB/Parquet or columnar analytical storage
Additional integrations
Public API
Advanced tracing
```

---

## Definition of Done

A feature is complete when it has:

```text
Validated input
Server-side authorization
Tenant-scoped data access
Safe error handling
Loading, empty, and error UI states
Appropriate tests
Database migration when needed
Accessible interaction model
Mobile behavior where relevant
No secret exposure
Observability proportional to risk
```

For sensitive or asynchronous features, completion also requires:

```text
Idempotency
Retry strategy
Audit event
Cancellation or recovery behavior
Operational status visibility
```

---

## Target Architecture

The target architecture remains intentionally evolutionary:

```text
Next.js modular monolith
  ↓
Authentication and authorization policy
  ↓
Domain services
  ↓
Repositories, query compiler, and analytical-store interface
  ↓
PostgreSQL for application state
  ↓
Object storage for files
  ↓
Background jobs for long-running work
  ↓
Optional Redis, dedicated workers, and advanced analytical storage as real usage demands
```

The purpose of Datalize is not to demonstrate how many services can be connected to a Next.js application. It is to provide a trustworthy, fast path from customer data to an understandable answer, while preserving clean boundaries for future scale.
