# Datalize

> **Turn your data into something you can understand.**

Datalize is a production-grade, multi-tenant analytics platform for connecting data sources, exploring datasets, building interactive dashboards, generating reports, and using AI to understand and manipulate data.

The project is designed to demonstrate modern full-stack engineering with Next.js while maintaining an architecture that could realistically evolve into a commercial SaaS product.

---

# Table of Contents

- [1. Product Vision](#1-product-vision)
- [2. Product Principles](#2-product-principles)
- [3. Core User Experience](#3-core-user-experience)
- [4. Feature Scope](#4-feature-scope)
- [5. Technology Stack](#5-technology-stack)
- [6. Architecture](#6-architecture)
- [7. Architectural Rules](#7-architectural-rules)
- [8. Project Structure](#8-project-structure)
- [9. Authentication](#9-authentication)
- [10. Authorization & RBAC](#10-authorization--rbac)
- [11. Multi-Tenancy](#11-multi-tenancy)
- [12. Database](#12-database)
- [13. Data Sources](#13-data-sources)
- [14. Data Ingestion](#14-data-ingestion)
- [15. Query Engine](#15-query-engine)
- [16. Dashboard System](#16-dashboard-system)
- [17. Visualization Engine](#17-visualization-engine)
- [18. Dashboard Builder](#18-dashboard-builder)
- [19. AI System](#19-ai-system)
- [20. Background Jobs](#20-background-jobs)
- [21. Caching](#21-caching)
- [22. File Storage](#22-file-storage)
- [23. Billing](#23-billing)
- [24. Email](#24-email)
- [25. API](#25-api)
- [26. API Keys](#26-api-keys)
- [27. Sharing](#27-sharing)
- [28. Reports & Exports](#28-reports--exports)
- [29. Notifications](#29-notifications)
- [30. Audit Logs](#30-audit-logs)
- [31. Security](#31-security)
- [32. Reliability](#32-reliability)
- [33. Observability](#33-observability)
- [34. Performance](#34-performance)
- [35. Accessibility](#35-accessibility)
- [36. Testing](#36-testing)
- [37. CI/CD](#37-cicd)
- [38. Environment Management](#38-environment-management)
- [39. Deployment](#39-deployment)
- [40. Data Privacy](#40-data-privacy)
- [41. Development Standards](#41-development-standards)
- [42. Git Workflow](#42-git-workflow)
- [43. Implementation Roadmap](#43-implementation-roadmap)
- [44. Definition of Done](#44-definition-of-done)
- [45. Production Checklist](#45-production-checklist)

---

# 1. Product Vision

Datalize allows users to connect external data and transform it into useful information.

The fundamental workflow is:

```text
Connect Data
     ↓
Discover Dataset
     ↓
Explore Data
     ↓
Build Query
     ↓
Visualize
     ↓
Build Dashboard
     ↓
Share / Export / Schedule
     ↓
Analyze with AI
```

Example:

```text
Connect Stripe
     ↓
Discover transactions
     ↓
Create revenue dataset
     ↓
Query monthly revenue
     ↓
Generate visualization
     ↓
Add to Revenue Dashboard
     ↓
Ask AI:
"Why did revenue fall last month?"
```

Datalize should feel like a simplified combination of:

- Analytics platform
- BI tool
- Dashboard builder
- Data explorer
- AI data analyst

It should not attempt to become a full enterprise data warehouse.

---

# 2. Product Principles

## 2.1 Production first

The application should be designed as if real users and real data depend on it.

This means:

- Explicit authorization
- Tenant isolation
- Validation
- Idempotency
- Retries
- Observability
- Error handling
- Testing
- Secure secret management
- Database migrations
- Backups
- Performance considerations

---

## 2.2 Modular monolith

Datalize should initially be a modular monolith.

Do not introduce microservices simply for architectural appearance.

```text
Next.js
│
├── Authentication
├── Authorization
├── Dashboards
├── Queries
├── Data Sources
├── Billing
├── AI
├── Reports
└── Shared Services
       │
       ├── PostgreSQL
       ├── Redis
       ├── Object Storage
       └── Background Jobs
```

The modules should have strong boundaries so individual services can be extracted later if necessary.

---

## 2.3 Server by default

Prefer Server Components.

Client Components exist only where required by:

- Interaction
- Browser APIs
- Local state
- Drag and drop
- Animation
- Client-side subscriptions
- Complex interactive visualizations

---

## 2.4 PostgreSQL is the source of truth

Redis, object storage, caches and job systems are secondary infrastructure.

The canonical application state lives in PostgreSQL.

---

## 2.5 AI is an application feature, not a second backend

AI interacts with Datalize through typed application tools.

AI never receives unrestricted database access.

---

# 3. Core User Experience

A new user should be able to:

```text
Sign up
   ↓
Create workspace
   ↓
Connect data
   ↓
Inspect dataset
   ↓
Create query
   ↓
Create visualization
   ↓
Create dashboard
   ↓
Invite teammate
   ↓
Share dashboard
   ↓
Ask AI a question
```

The first-run experience should guide users toward this workflow.

---

# 4. Feature Scope

## MVP

### Authentication

- Email/password
- Email verification
- Password reset
- Session management
- Profile

### Organizations

- Workspace creation
- Workspace switching
- Invitations
- Members
- Roles

### Data

- CSV upload
- Dataset discovery
- Dataset schema
- Data preview
- Query builder

### Dashboards

- Dashboard CRUD
- Widget CRUD
- Drag/drop
- Resize
- Reorder
- Filters
- Charts
- Tables
- KPI widgets

### AI

- Natural-language queries
- Query generation
- Chart generation
- Dashboard generation

### Production

- Tests
- Sentry
- Logging
- Audit logs
- Rate limiting
- CI/CD

---

# 5. Technology Stack

## Core

```text
Next.js 16+
React 19+
TypeScript
Node.js LTS
pnpm
```

Use the latest stable versions when implementation begins rather than pinning assumptions about future minor releases.

Next.js App Router is the primary application architecture because it provides the current React Server Component model and full-stack application capabilities.

---

## Styling

```text
Tailwind CSS v4
shadcn/ui
Radix UI
Lucide
```

shadcn is the UI foundation.

Do not introduce another component library.

---

## Forms

```text
React Hook Form
Zod
```

Zod validates all untrusted input.

---

## Database

```text
PostgreSQL
Drizzle ORM
Drizzle Kit
```

Drizzle has native PostgreSQL support and a version-controlled migration workflow.

---

## Authentication

```text
Better Auth
```

Better Auth has dedicated Next.js integration and supports authentication, organizations, members and roles.

---

## Server State

```text
TanStack Query
```

Use selectively.

Do not turn every server request into a TanStack Query.

---

## Client State

```text
Zustand
```

Use for complex local application state such as the dashboard editor.

---

## Tables

```text
TanStack Table
TanStack Virtual
```

TanStack Table handles table logic.

TanStack Virtual handles large datasets without rendering thousands of DOM nodes.

---

## Visualization

```text
Apache ECharts
```

ECharts is the primary visualization engine because Datalize is fundamentally a visualization product. ECharts provides a much broader interactive visualization surface than a basic chart library.

Supported visualization types:

```text
KPI
Line
Area
Bar
Stacked Bar
Pie
Donut
Scatter
Funnel
Heatmap
Treemap
Gauge
Table
```

---

## Dashboard interaction

```text
dnd-kit
```

Used for:

- Dragging widgets
- Reordering
- Resizing
- Layout manipulation

---

## Animation

```text
Motion
```

Use for purposeful transitions and micro-interactions.

---

## Dates

```text
date-fns
```

Persist timestamps in UTC.

Convert to user timezone only at the presentation layer.

---

## Command Interface

```text
cmdk
```

Used for global command/search functionality.

---

## Notifications

```text
Sonner
```

---

## AI

```text
Vercel AI SDK
Zod
```

Used for:

- Streaming
- Tool calling
- Structured outputs
- AI-generated queries
- AI-generated visualizations

---

## Background Jobs

```text
Trigger.dev
```

Used for:

- Data synchronization
- CSV processing
- Report generation
- Large exports
- Scheduled jobs
- AI processing

---

## Cache / Ephemeral Infrastructure

```text
Redis
```

Used for:

- Rate limiting
- Short-lived cache
- Locks
- Temporary query results
- Coordination

Redis is never the source of truth.

---

## Storage

```text
S3-compatible object storage
```

Used for:

- CSV uploads
- Generated reports
- Exports
- User assets

---

## Billing

```text
Stripe
```

---

## Email

```text
Resend
```

---

## Error Tracking

```text
Sentry
```

---

## Product Analytics

```text
PostHog
```

---

## Distributed Tracing

```text
OpenTelemetry
```

---

## Testing

```text
Vitest
React Testing Library
Playwright
```

---

## Code Quality

```text
ESLint
Prettier
Husky
lint-staged
```

---

## Hosting

```text
Vercel
Neon PostgreSQL
Redis provider
S3-compatible storage
Trigger.dev
```

Providers remain abstracted behind application interfaces where practical.

---

# 6. Architecture

```text
                           Browser
                              │
                              ▼
                       ┌─────────────┐
                       │   Next.js   │
                       │             │
                       │ RSC         │
                       │ Actions     │
                       │ Routes      │
                       │ API         │
                       └──────┬──────┘
                              │
                 ┌────────────┼────────────┐
                 │            │            │
                 ▼            ▼            ▼
             Auth Layer   Service Layer   AI Layer
                 │            │            │
                 │            │            │
                 └────────────┼────────────┘
                              │
                       Repository Layer
                              │
                              ▼
                       ┌─────────────┐
                       │ PostgreSQL  │
                       └─────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
            Redis         Storage        External APIs

                         Trigger.dev
                              │
                         Background Jobs
```

---

# 7. Architectural Rules

## Rule 1 — UI does not own business logic

Components render state and dispatch actions.

Business rules belong in services.

---

## Rule 2 — Database access is isolated

UI components never directly access Drizzle.

```text
Component
   ↓
Server Action / Server Component
   ↓
Service
   ↓
Repository
   ↓
Drizzle
   ↓
PostgreSQL
```

---

## Rule 3 — Server Actions remain thin

A Server Action should:

```text
Authenticate
Validate
Authorize
Call service
Return result
```

It should not contain a large business workflow.

---

## Rule 4 — Authorization occurs server-side

Never rely on:

```text
disabled button
hidden menu
client-side role
```

as security.

---

## Rule 5 — Every tenant query is tenant scoped

Every tenant-owned database operation must include the organization boundary.

---

## Rule 6 — External input is untrusted

Validate:

- Request bodies
- Query parameters
- Forms
- Files
- Webhooks
- API keys
- AI tool arguments

---

# 8. Project Structure

```text
datalize/
│
├── src/
│   │
│   ├── app/
│   │   ├── (marketing)/
│   │   │   ├── page.tsx
│   │   │   ├── pricing/
│   │   │   └── about/
│   │   │
│   │   ├── (auth)/
│   │   │   ├── sign-in/
│   │   │   ├── sign-up/
│   │   │   ├── verify-email/
│   │   │   └── reset-password/
│   │   │
│   │   ├── app/
│   │   │   ├── overview/
│   │   │   ├── dashboards/
│   │   │   ├── data-sources/
│   │   │   ├── datasets/
│   │   │   ├── queries/
│   │   │   ├── reports/
│   │   │   ├── settings/
│   │   │   └── billing/
│   │   │
│   │   ├── share/
│   │   │
│   │   └── api/
│   │       ├── auth/
│   │       ├── webhooks/
│   │       ├── integrations/
│   │       ├── exports/
│   │       └── v1/
│   │
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── dashboard/
│   │   ├── charts/
│   │   ├── data-source/
│   │   ├── dataset/
│   │   ├── query-builder/
│   │   ├── reports/
│   │   └── ai/
│   │
│   ├── db/
│   │   ├── schema/
│   │   ├── relations.ts
│   │   └── index.ts
│   │
│   ├── server/
│   │   ├── actions/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── queries/
│   │   └── permissions/
│   │
│   ├── lib/
│   │   ├── auth/
│   │   ├── ai/
│   │   ├── billing/
│   │   ├── storage/
│   │   ├── integrations/
│   │   ├── cache/
│   │   ├── rate-limit/
│   │   ├── observability/
│   │   └── validation/
│   │
│   ├── hooks/
│   ├── stores/
│   ├── types/
│   └── tests/
│
├── drizzle/
│   └── migrations/
│
├── scripts/
│
├── public/
│
├── .env.example
├── drizzle.config.ts
├── next.config.ts
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── eslint.config.*
├── prettier.config.*
└── README.md
```

---

# 9. Authentication

Authentication uses Better Auth.

Initial capabilities:

```text
Email/password
Email verification
Password reset
Session management
Profile management
Organization membership
Roles
```

Future:

```text
Google
GitHub
Passkeys
2FA
SSO
SCIM
```

Do not implement custom authentication infrastructure unless the product requires it.

Better Auth's current Next.js integration uses a route handler and supports server-side session access.

---

# 10. Authorization & RBAC

Roles:

```text
OWNER
ADMIN
EDITOR
VIEWER
```

Permissions should be explicit.

Example:

```text
dashboard:read
dashboard:create
dashboard:update
dashboard:delete

widget:create
widget:update
widget:delete

dataset:read
dataset:manage

data_source:create
data_source:read
data_source:update
data_source:delete

organization:manage
members:invite
members:remove

billing:manage
```

Authorization API:

```ts
can(user, "dashboard:update")
```

or:

```ts
assertPermission(context, "dashboard:update")
```

Never duplicate role logic throughout components.

---

# 11. Multi-Tenancy

The organization is the tenant boundary.

```text
User
 │
 ├── Organization A
 │      ├── Data
 │      ├── Dashboards
 │      ├── Reports
 │      └── Members
 │
 └── Organization B
        ├── Data
        └── Dashboards
```

Every tenant-owned record contains:

```text
organization_id
```

Example:

```text
dashboards
├── id
├── organization_id
├── name
└── ...
```

All reads and writes must scope by organization.

---

## Tenant Isolation Requirement

This must be tested explicitly.

A user from Organization A must never be able to:

- Read Organization B data
- Update Organization B dashboards
- Delete Organization B resources
- Execute Organization B queries
- Access Organization B exports
- Access Organization B credentials

IDs alone are never sufficient authorization.

---

# 12. Database

Core entities:

```text
users
organizations
organization_members
invitations

data_sources
datasets
dataset_columns
dataset_syncs

dashboards
dashboard_widgets
dashboard_filters

saved_queries
query_executions

reports
report_schedules

subscriptions
billing_events

notifications
audit_logs

api_keys
webhook_events
```

---

# Database Relationships

```text
Organization
│
├── Members
│
├── Invitations
│
├── Data Sources
│      │
│      ├── Datasets
│      │      └── Columns
│      │
│      └── Syncs
│
├── Dashboards
│      │
│      ├── Widgets
│      │      └── Queries
│      │
│      └── Filters
│
├── Reports
│
├── API Keys
│
├── Audit Logs
│
└── Subscription
```

---

# Database Principles

Use:

- Foreign keys
- Unique constraints
- Check constraints
- Indexes
- Transactions
- Explicit timestamps

Every table should have a deliberate lifecycle.

Avoid storing arbitrary JSON where a relational structure is more appropriate.

JSONB is acceptable for genuinely flexible configuration, such as visualization configuration.

---

# Indexing

Index based on actual access patterns.

Expected indexes include:

```text
organization_id
organization_id + created_at
organization_id + updated_at
foreign keys
unique business identifiers
sync status
job status
scheduled execution time
```

Do not blindly index every column.

---

# Migrations

Local experimentation may use:

```bash
pnpm drizzle-kit push
```

Production uses versioned migrations:

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

Drizzle explicitly supports both rapid local schema iteration and generated/applied migration workflows. Production schema changes must use version-controlled migrations.

---

# Transactions

Use transactions whenever multiple database operations must succeed together.

Example:

```text
Create dashboard
    ↓
Create dashboard
    ↓
Create default filters
    ↓
Create default widget
```

All operations belong to one transaction.

---

# 13. Data Sources

Initial integrations:

```text
CSV
PostgreSQL
REST API
Stripe
```

Future:

```text
GitHub
Google Analytics
Notion
MySQL
Shopify
HubSpot
```

Each integration implements a common adapter interface.

```ts
interface DataSourceAdapter {
  testConnection(): Promise<Result>
  discoverSchema(): Promise<DatasetSchema>
  sync(): Promise<SyncResult>
  disconnect(): Promise<void>
}
```

This prevents integration-specific logic from leaking into the rest of the application.

---

# 14. Data Ingestion

Data ingestion is asynchronous.

```text
User
 ↓
Connect source
 ↓
Validate credentials
 ↓
Create data source
 ↓
Queue sync
 ↓
Background worker
 ↓
Discover schema
 ↓
Fetch data
 ↓
Validate
 ↓
Transform
 ↓
Persist
 ↓
Mark sync complete
```

Sync states:

```text
PENDING
RUNNING
COMPLETED
FAILED
CANCELLED
```

A sync must be retryable.

---

# CSV Processing

Large CSV files must not be parsed entirely inside a request handler.

```text
Upload
 ↓
Object storage
 ↓
Create import job
 ↓
Trigger.dev
 ↓
Stream/process file
 ↓
Validate rows
 ↓
Transform
 ↓
Persist
```

Handle:

- Encoding
- Headers
- Missing values
- Invalid rows
- Duplicate columns
- Type inference
- Large files
- Partial failures

---

# Data Type Inference

Supported types:

```text
string
integer
decimal
boolean
date
datetime
```

Type inference must be deterministic and overridable.

---

# 15. Query Engine

Queries are represented as structured objects.

Example:

```ts
{
  dataset: "transactions",

  dimensions: [
    "month"
  ],

  measures: [
    {
      field: "amount",
      aggregation: "sum"
    }
  ],

  filters: [
    {
      field: "status",
      operator: "equals",
      value: "paid"
    }
  ],

  orderBy: [
    {
      field: "month",
      direction: "asc"
    }
  ]
}
```

---

# Query Operations

Support:

```text
SELECT
FILTER
GROUP BY
ORDER BY
LIMIT
OFFSET
AGGREGATE
```

Aggregations:

```text
COUNT
COUNT DISTINCT
SUM
AVG
MIN
MAX
```

Filters:

```text
equals
not equals
contains
starts with
ends with
greater than
less than
between
in
is null
is not null
```

---

# Query Safety

Never concatenate arbitrary user input into SQL.

The query builder produces a typed intermediate representation.

```text
User input
 ↓
Zod validation
 ↓
Query AST
 ↓
Query compiler
 ↓
Parameterized SQL
 ↓
PostgreSQL
```

---

# Query Execution

Every query execution should have:

```text
query_id
organization_id
user_id
started_at
completed_at
duration
row_count
status
error
```

Never log raw customer data unnecessarily.

---

# Query Limits

Protect the system from pathological queries.

Potential limits:

```text
Maximum execution time
Maximum returned rows
Maximum concurrent queries
Maximum query complexity
Maximum export size
```

Limits should be plan-aware eventually.

---

# Query Caching

Cache expensive deterministic queries where appropriate.

Cache key:

```text
organization_id
+
query_hash
+
dataset_version
```

Never create a cache key that can collide across tenants.

---

# 16. Dashboard System

A dashboard contains widgets.

```text
Dashboard
│
├── Widget
│   ├── Query
│   ├── Visualization
│   ├── Layout
│   └── Configuration
│
├── Widget
│
└── Widget
```

Widget properties:

```ts
{
  ;(id, dashboardId, queryId, type, configuration, layout)
}
```

---

# Widget Types

```text
KPI
LINE
AREA
BAR
STACKED_BAR
PIE
DONUT
SCATTER
FUNNEL
HEATMAP
TABLE
```

Future:

```text
GAUGE
TREEMAP
MAP
COHORT
RETENTION
```

---

# Dashboard Filters

Dashboard-level filters should be able to affect multiple widgets.

Example:

```text
Date: Last 30 days
Region: Europe
Status: Paid
```

The dashboard filter state is transformed into query filters.

---

# 17. Visualization Engine

Use Apache ECharts as the primary visualization engine.

Create an internal abstraction:

```text
Query Result
      ↓
Visualization Config
      ↓
Chart Adapter
      ↓
ECharts
```

The rest of Datalize should not depend directly on ECharts APIs.

Example:

```ts
type VisualizationConfig = {
  type: "line"

  xAxis: {
    field: string
  }

  series: [
    {
      field: string
      label: string
    },
  ]
}
```

---

# Visualization Requirements

Every visualization must support:

```text
Loading
Empty
Error
Data
```

Charts must respond to:

```text
Light theme
Dark theme
Responsive sizing
Reduced motion
```

---

# 18. Dashboard Builder

The editor supports:

```text
Drag
Drop
Resize
Reorder
Duplicate
Delete
Configure
Undo
Redo
Autosave
```

Architecture:

```text
User interaction
 ↓
Local editor state
 ↓
Immediate UI update
 ↓
Debounced persistence
 ↓
Server mutation
 ↓
Database
```

The interface should not wait for the server before visually moving a widget.

---

# Editor State

Zustand may manage:

```text
selectedWidget
activePanel
layout
history
redoStack
isDirty
dragState
```

Server data remains server state.

---

# Autosave

Autosave should:

- Debounce writes
- Avoid duplicate mutations
- Handle failures
- Show save status
- Recover from temporary network failures

Possible state:

```text
Saved
Saving...
Unsaved changes
Save failed
```

---

# Keyboard Support

```text
Cmd/Ctrl + K
Command menu

Cmd/Ctrl + S
Save

Cmd/Ctrl + Z
Undo

Cmd/Ctrl + Shift + Z
Redo

Escape
Close active editor
```

Every pointer interaction should have an appropriate keyboard/accessibility alternative.

---

# 19. AI System

AI capabilities:

```text
Ask questions about data
Generate queries
Generate charts
Generate dashboards
Explain trends
Summarize dashboards
Suggest visualizations
```

Example:

```text
"Show revenue by month this year"
```

AI flow:

```text
User prompt
 ↓
AI model
 ↓
Tool selection
 ↓
Zod validation
 ↓
Application service
 ↓
Query engine
 ↓
Structured result
 ↓
Visualization
```

---

# AI Tools

Initial tools:

```text
getDatasets
getDatasetSchema
getDashboard
getWidget
runQuery
createQuery
createWidget
updateWidget
createDashboard
```

AI does not directly access Drizzle.

---

# AI Authorization

Every tool receives:

```text
userId
organizationId
permissions
```

Every tool independently verifies authorization.

Prompt instructions cannot override permissions.

---

# AI SQL Safety

Never allow:

```text
AI → arbitrary SQL → database
```

Use:

```text
AI
 ↓
Typed query object
 ↓
Validation
 ↓
Query compiler
 ↓
Parameterized SQL
```

---

# AI Streaming

AI responses should stream where appropriate.

For long operations:

```text
Thinking
 ↓
Inspecting dataset
 ↓
Building query
 ↓
Running query
 ↓
Generating visualization
```

The UI should display progress rather than appearing frozen.

---

# AI Failure Handling

Handle:

```text
Provider timeout
Rate limits
Invalid tool arguments
Malformed output
Query failure
No matching dataset
Insufficient permissions
```

The application must remain functional when AI is unavailable.

---

# 20. Background Jobs

Use Trigger.dev for long-running work.

Jobs include:

```text
Data synchronization
CSV imports
Large exports
Report generation
Scheduled reports
AI analysis
Webhook processing
```

Every job should support:

```text
Retry
Exponential backoff
Idempotency
Cancellation
Logging
Progress
Failure state
```

---

# Job States

```text
QUEUED
RUNNING
COMPLETED
FAILED
CANCELLED
```

---

# Job Idempotency

A retry must not create duplicate data.

Examples:

```text
Sync ID
Import ID
Webhook event ID
Export ID
Report execution ID
```

Use database uniqueness constraints where possible.

---

# 21. Caching

Redis may be used for:

```text
Rate limits
Short-lived query results
Locks
Temporary state
Job coordination
```

PostgreSQL remains authoritative.

---

# Cache Rules

Every cache key containing tenant-owned data must include:

```text
organizationId
```

Example:

```text
datalize:
org:{organizationId}:
query:{queryHash}
```

Cache invalidation should be explicit.

---

# Distributed Locks

Use Redis locks for operations where concurrent execution could corrupt state.

Examples:

```text
Dataset sync
Report generation
Scheduled task
```

Locks must have expiration.

Never create permanent locks.

---

# 22. File Storage

Use S3-compatible storage.

Application interface:

```ts
interface StorageProvider {
  upload()
  download()
  delete()
  createSignedUrl()
}
```

Large uploads should bypass the application server where possible using signed uploads.

---

# File Security

Validate:

```text
Size
Content type
Extension
File signature where applicable
Filename
```

Never trust client-provided MIME types.

Files must not become executable content.

---

# 23. Billing

Use Stripe.

Billing architecture:

```text
Stripe
 ↓
Webhook
 ↓
Signature verification
 ↓
Persist event
 ↓
Background processing
 ↓
Update subscription
 ↓
Update entitlements
```

Client-side billing state is never authoritative.

---

# Entitlements

Do not scatter:

```ts
if (plan === "pro")
```

throughout the codebase.

Create an entitlement layer:

```ts
getEntitlements(organization)

canUseFeature(organization, "ai_dashboard_generation")
```

Possible entitlements:

```text
maxDashboards
maxDataSources
maxMembers
maxRows
maxExports
aiEnabled
scheduledReports
apiAccess
```

---

# 24. Email

Use Resend.

Emails:

```text
Verify email
Reset password
Workspace invitation
Report ready
Scheduled report
Security notification
```

Email sending should be asynchronous when appropriate.

---

# 25. API

Use Next.js Server Actions for internal application mutations.

Use Route Handlers for:

```text
Webhooks
Public API
Integration callbacks
External consumers
File upload endpoints
```

Do not add tRPC.

The application already has:

```text
TypeScript
Server Actions
Route Handlers
Zod
Services
Drizzle
```

Adding another RPC layer would increase abstraction without solving an important problem.

---

# Public API

Future API structure:

```text
/api/v1/dashboards
/api/v1/datasets
/api/v1/queries
/api/v1/reports
```

Public API responses must never expose internal database models directly.

Create API DTOs.

---

# 26. API Keys

Organizations can create API keys.

Keys must:

- Be shown once
- Be hashed at rest
- Have scopes
- Have creation timestamps
- Have last-used timestamps
- Be revocable

Scopes:

```text
dashboard:read
dashboard:write
dataset:read
query:read
query:execute
```

Never store raw API keys after creation.

---

# 27. Sharing

Dashboard visibility:

```text
PRIVATE
ORGANIZATION
PUBLIC
```

Public dashboards require a separate access mechanism.

Never expose a dashboard solely because its database ID is known.

Public access tokens must be cryptographically secure.

---

# Shared Dashboard Security

Public dashboards must expose only explicitly public data.

No internal:

```text
query IDs
dataset IDs
organization metadata
user metadata
credentials
```

unless intentionally required.

---

# 28. Reports & Exports

Supported exports:

```text
CSV
PDF
```

Large exports run asynchronously.

```text
Request export
 ↓
Create job
 ↓
Generate file
 ↓
Upload to storage
 ↓
Create signed URL
 ↓
Notify user
```

Signed URLs should expire.

---

# Scheduled Reports

Users can configure:

```text
Daily
Weekly
Monthly
Custom schedule
```

Scheduled jobs must:

- Be tenant scoped
- Be idempotent
- Have retry logic
- Have execution history
- Respect subscription limits

---

# 29. Notifications

Notification types:

```text
SYNC_COMPLETED
SYNC_FAILED
REPORT_READY
REPORT_FAILED
INVITATION
BILLING
SECURITY
AI_JOB_COMPLETED
```

Notifications should have:

```text
id
organizationId
userId
type
title
message
readAt
createdAt
```

---

# 30. Audit Logs

Audit security-sensitive operations.

Examples:

```text
USER_INVITED
USER_REMOVED
ROLE_CHANGED

DATA_SOURCE_CREATED
DATA_SOURCE_DELETED
DATA_SOURCE_UPDATED

DASHBOARD_CREATED
DASHBOARD_SHARED
DASHBOARD_DELETED

API_KEY_CREATED
API_KEY_REVOKED

BILLING_CHANGED
```

Audit log:

```text
actor
organization
action
resource
timestamp
metadata
```

Never store secrets in audit metadata.

---

# 31. Security

Security is part of the architecture rather than a final checklist.

---

## Authentication

Use:

- Secure cookies
- Session expiration
- Email verification
- Password reset
- Secure session invalidation

---

## Authorization

Every protected operation performs:

```text
Authentication
 ↓
Tenant resolution
 ↓
Permission check
 ↓
Business operation
```

---

## Input Validation

Validate all trust boundaries with Zod.

---

## SQL Injection

Never construct SQL using string concatenation with user input.

Use parameterized queries.

---

## XSS

Never render untrusted HTML.

Sanitize content if rich HTML becomes necessary.

---

## CSRF

Follow the protections provided by the framework/authentication architecture and explicitly review mutation endpoints.

---

## Rate Limiting

Rate-limit:

```text
Authentication
AI
Public API
Exports
Data source creation
File uploads
Password reset
Invitation endpoints
```

---

## Secrets

Never expose:

```text
DATABASE_URL
AUTH_SECRET
STRIPE_SECRET_KEY
WEBHOOK_SECRET
AI_PROVIDER_KEY
STORAGE_SECRET
```

to the client.

Never use `NEXT_PUBLIC_*` for server secrets.

---

# Data Source Credentials

Credentials must be encrypted at rest where applicable.

They must never appear in:

```text
Logs
Analytics
Errors
Client responses
Audit logs
```

---

# Webhooks

Every webhook:

```text
Receive
 ↓
Verify signature
 ↓
Persist event
 ↓
Return success
 ↓
Process asynchronously
```

Webhook events must be idempotent.

---

# 32. Reliability

Design for:

```text
Network failure
Database failure
External API failure
Timeouts
Rate limits
Duplicate requests
Duplicate webhooks
Job retries
Partial sync
Browser retries
```

---

# Idempotency

Operations that can safely be retried must be idempotent.

Examples:

```text
Webhook processing
Data synchronization
Exports
Subscription updates
Invitations
```

---

# Graceful Degradation

If Redis fails:

```text
Core PostgreSQL functionality should remain available
```

If AI fails:

```text
Dashboards and queries should remain available
```

If PostHog fails:

```text
Application functionality should remain available
```

Analytics and convenience infrastructure must not become hard dependencies for core product functionality.

---

# 33. Observability

## Sentry

Track:

```text
Server errors
Client errors
API failures
Background job failures
Webhook failures
```

---

## Structured Logging

Logs should contain structured metadata.

Example:

```json
{
  "event": "query_execution_failed",
  "organizationId": "...",
  "queryId": "...",
  "requestId": "...",
  "error": "timeout"
}
```

Never log raw customer datasets.

---

# Request IDs

Every significant request should have a correlation/request ID.

Use it across:

```text
Request
 ↓
Service
 ↓
Database
 ↓
Background job
```

---

# OpenTelemetry

Instrument important operations:

```text
HTTP request
Database query
Query execution
External API request
Background job
AI request
```

Example trace:

```text
Dashboard request
│
├── Auth              8ms
├── PostgreSQL       32ms
├── Query             280ms
├── ECharts payload   8ms
└── Response          5ms
```

---

# PostHog

Track product events such as:

```text
signup_completed
workspace_created
data_source_connected
dataset_created
dashboard_created
widget_created
query_executed
ai_query_started
ai_query_completed
report_created
invitation_sent
```

Never send customer dataset contents to analytics.

---

# 34. Performance

Performance should be treated as a system property.

---

## Server Performance

Prefer:

```text
Server Components
Parallel data fetching
Selective database fields
Pagination
Caching
Streaming
```

Avoid:

```text
Unnecessary client components
Sequential requests
N+1 queries
Large server payloads
```

---

# Client Performance

Use:

```text
Dynamic imports
Virtualization
Memoization where justified
Debouncing
Efficient chart rendering
Minimal hydration
```

---

# Large Tables

Never render:

```text
10,000 DOM rows
```

Use:

```text
TanStack Table
+
TanStack Virtual
```

---

# Database Performance

Monitor:

```text
Slow queries
Missing indexes
Connection pool saturation
Large scans
Query frequency
```

Do not optimize based solely on theoretical assumptions.

---

# 35. Accessibility

Target WCAG 2.2 AA principles.

Requirements:

- Keyboard navigation
- Focus management
- Semantic HTML
- Accessible labels
- Screen reader support
- Visible focus
- Sufficient contrast
- Reduced motion
- Accessible dialogs
- Accessible menus

---

# Dashboard Accessibility

Drag-and-drop cannot be the only interaction mechanism.

Provide:

```text
Move widget
Resize widget
Delete widget
Configure widget
```

through keyboard-accessible controls.

---

# 36. Testing

Testing strategy:

```text
Unit
 ↓
Integration
 ↓
E2E
```

---

# Unit Tests

Vitest tests:

```text
Validation
Permissions
Query compiler
Data transformation
Entitlements
Billing rules
Utility functions
```

---

# Integration Tests

Test:

```text
Repositories
Services
Database transactions
Authentication
Authorization
Webhooks
Data-source adapters
```

---

# Component Tests

Testing Library tests:

```text
Query builder
Widget editor
Filters
Dialogs
Forms
Interactive controls
```

---

# E2E Tests

Playwright covers critical user journeys.

---

## Critical Journey 1

```text
Signup
 ↓
Create workspace
 ↓
Connect CSV
 ↓
Create dataset
 ↓
Create dashboard
 ↓
Create widget
 ↓
Save
 ↓
Reload
 ↓
Verify persistence
```

---

## Critical Journey 2

```text
Owner invites member
 ↓
Member accepts
 ↓
Owner changes role
 ↓
Member attempts restricted operation
 ↓
Operation rejected
```

---

## Critical Journey 3

```text
User asks AI question
 ↓
AI selects tools
 ↓
Query executes
 ↓
Visualization generated
 ↓
Widget saved
```

---

## Critical Journey 4

```text
Stripe event
 ↓
Webhook verification
 ↓
Event persistence
 ↓
Background processing
 ↓
Subscription updated
```

---

# Test Rules

Every bug fix should include a regression test.

Every security boundary requires automated coverage.

Critical flows require E2E coverage.

---

# 37. CI/CD

Every pull request:

```text
Install dependencies
 ↓
Lint
 ↓
Typecheck
 ↓
Unit tests
 ↓
Integration tests
 ↓
Build
 ↓
E2E tests
```

Production deployment occurs only after required checks pass.

---

# CI Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

---

# Dependency Management

Use:

```text
pnpm
```

Commit:

```text
pnpm-lock.yaml
```

Dependencies should be reviewed before upgrading.

Major dependency upgrades require tests.

---

# 38. Environment Management

Environments:

```text
Development
Preview
Production
```

Each environment has separate configuration.

---

# Environment Validation

Create typed environment validation.

Required variables should fail fast if missing.

Example categories:

```text
DATABASE_URL

BETTER_AUTH_SECRET

STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET

AI_PROVIDER_KEY

REDIS_URL

STORAGE_ACCESS_KEY
STORAGE_SECRET_KEY

SENTRY_DSN

POSTHOG_KEY
```

---

# Environment Rules

Never:

```text
Commit .env
Share production secrets locally
Expose server secrets
Use production data in development
```

---

# 39. Deployment

Primary deployment:

```text
Vercel
```

Architecture:

```text
                       Vercel
                         │
              ┌──────────┼──────────┐
              │          │          │
           Next.js     Actions    Routes
              │
       ┌──────┼───────┐
       ▼      ▼       ▼
     Neon   Redis   Storage
       │
       ▼
 PostgreSQL
```

Background work:

```text
Trigger.dev
```

---

# Database Deployment

Production migration process:

```text
Developer
 ↓
Migration generated
 ↓
Migration committed
 ↓
CI validation
 ↓
Preview database
 ↓
Production migration
```

Never manually modify production schema without recording the migration.

---

# Backups

Production PostgreSQL must have:

```text
Automated backups
Point-in-time recovery where available
Defined retention
Recovery procedure
```

A backup that has never been restored is not a proven backup strategy.

---

# 40. Data Privacy

Datalize may process customer data.

Therefore:

- Minimize retained data
- Avoid unnecessary copies
- Avoid logging data
- Avoid sending raw data to analytics
- Avoid sending raw data to AI providers unless explicitly required
- Define retention periods
- Support deletion workflows

---

# Account Deletion

Deleting an organization must define the lifecycle of:

```text
Dashboards
Datasets
Data source credentials
Files
Reports
Audit logs
API keys
Subscriptions
```

Deletion should be deliberate and auditable.

---

# 41. Development Standards

## TypeScript

Use strict TypeScript.

Avoid:

```ts
any
```

unless explicitly justified.

Prefer:

```ts
unknown
```

with validation.

---

# Error Handling

Use typed application errors.

Example:

```text
AuthenticationError
AuthorizationError
ValidationError
NotFoundError
ConflictError
RateLimitError
ExternalServiceError
```

Map internal errors to safe user-facing responses.

---

# Loading States

Every asynchronous interface should define:

```text
Loading
Success
Empty
Error
```

---

# Empty States

Examples:

```text
No dashboards yet
No datasets yet
No data sources connected
No reports yet
```

Empty states should explain the next meaningful action.

---

# Error States

User-facing errors should be understandable.

Never expose:

```text
SQLSTATE
stack traces
internal database schema
API credentials
provider internals
```

---

# 42. Git Workflow

Use short-lived branches.

```text
main
 │
 ├── feature/dashboard-builder
 ├── feature/query-engine
 ├── feature/stripe
 └── fix/tenant-isolation
```

Commit examples:

```text
feat: add dashboard widget persistence
feat: add CSV ingestion pipeline
fix: scope query cache by organization
test: cover dashboard authorization
refactor: extract query execution service
```

---

# 43. Implementation Roadmap

## Phase 0 — Project Foundation

```text
[ ] Create Next.js project
[ ] Configure TypeScript
[ ] Configure pnpm
[ ] Configure Tailwind
[ ] Configure shadcn
[ ] Configure ESLint
[ ] Configure Prettier
[ ] Configure Husky
[ ] Configure lint-staged
[ ] Configure Vitest
[ ] Configure Playwright
[ ] Configure CI
```

---

# Phase 1 — Database & Authentication

```text
[ ] PostgreSQL
[ ] Drizzle
[ ] Migration system
[ ] Better Auth
[ ] User model
[ ] Organization model
[ ] Membership model
[ ] Invitations
[ ] Roles
[ ] Permission system
```

---

# Phase 2 — Application Shell

```text
[ ] Marketing site
[ ] Authentication UI
[ ] Application shell
[ ] Sidebar
[ ] Workspace switcher
[ ] Command menu
[ ] User menu
[ ] Settings
[ ] Dark mode
[ ] Responsive layout
```

---

# Phase 3 — Dashboard Core

```text
[ ] Dashboard CRUD
[ ] Widget CRUD
[ ] Widget layout
[ ] dnd-kit
[ ] Resize
[ ] Reorder
[ ] Undo/redo
[ ] Autosave
[ ] Dashboard filters
```

---

# Phase 4 — Data Platform

```text
[ ] CSV upload
[ ] Object storage
[ ] Dataset creation
[ ] Schema discovery
[ ] Data preview
[ ] Data types
[ ] Query builder
[ ] Query compiler
[ ] Query execution
```

---

# Phase 5 — Visualization

```text
[ ] ECharts integration
[ ] KPI
[ ] Line
[ ] Area
[ ] Bar
[ ] Stacked bar
[ ] Pie
[ ] Donut
[ ] Scatter
[ ] Funnel
[ ] Heatmap
[ ] Table
```

---

# Phase 6 — Background Processing

```text
[ ] Trigger.dev
[ ] Sync jobs
[ ] Import jobs
[ ] Retry
[ ] Idempotency
[ ] Job status
[ ] Progress
[ ] Failure handling
```

---

# Phase 7 — Integrations

```text
[ ] PostgreSQL
[ ] REST API
[ ] Stripe
[ ] Integration abstraction
[ ] Connection testing
[ ] Schema discovery
[ ] Synchronization
```

---

# Phase 8 — AI

```text
[ ] AI SDK
[ ] AI assistant
[ ] Tool architecture
[ ] Dataset inspection
[ ] Query generation
[ ] Visualization generation
[ ] Dashboard generation
[ ] Streaming
[ ] AI authorization
[ ] AI limits
```

---

# Phase 9 — SaaS

```text
[ ] Stripe
[ ] Plans
[ ] Entitlements
[ ] Usage limits
[ ] Billing portal
[ ] API keys
[ ] Public API
[ ] Invitations
[ ] Audit logs
```

---

# Phase 10 — Reports

```text
[ ] CSV export
[ ] PDF export
[ ] Background export
[ ] Scheduled reports
[ ] Email delivery
[ ] Report history
```

---

# Phase 11 — Production Hardening

```text
[ ] Sentry
[ ] PostHog
[ ] OpenTelemetry
[ ] Redis
[ ] Rate limiting
[ ] Security review
[ ] Tenant isolation tests
[ ] Performance profiling
[ ] Database indexes
[ ] Backup strategy
[ ] Recovery procedure
[ ] Data retention
```

---

# 44. Definition of Done

A feature is not complete because it works locally.

A feature is complete when:

```text
[ ] TypeScript passes
[ ] Lint passes
[ ] Tests exist
[ ] Authorization exists
[ ] Tenant isolation exists
[ ] Validation exists
[ ] Error handling exists
[ ] Loading state exists
[ ] Empty state exists
[ ] Mobile behavior is defined
[ ] Accessibility is considered
[ ] Observability exists where appropriate
[ ] Database migration exists
[ ] No secrets are exposed
[ ] Performance is acceptable
[ ] Critical E2E flow exists
```

---

# 45. Production Checklist

## Application

```text
[ ] Production build succeeds
[ ] Environment variables validated
[ ] Error boundaries implemented
[ ] Loading states implemented
[ ] Not-found states implemented
[ ] Logging configured
```

## Authentication

```text
[ ] Secure sessions
[ ] Email verification
[ ] Password reset
[ ] Session invalidation
[ ] Authentication E2E tests
```

## Authorization

```text
[ ] RBAC implemented
[ ] Server-side permission checks
[ ] Tenant isolation tests
[ ] API authorization
[ ] Background job authorization
[ ] AI tool authorization
```

## Database

```text
[ ] Production migrations tested
[ ] Indexes reviewed
[ ] Foreign keys reviewed
[ ] Transactions reviewed
[ ] Backups enabled
[ ] Recovery process documented
```

## Data

```text
[ ] File validation
[ ] Credential encryption
[ ] Sync retry
[ ] Sync idempotency
[ ] Large import processing
[ ] Data retention
```

## AI

```text
[ ] Tool validation
[ ] Tool authorization
[ ] Query limits
[ ] Provider timeout
[ ] Provider error handling
[ ] Usage limits
[ ] No unrestricted SQL
```

## Billing

```text
[ ] Stripe production keys
[ ] Webhook signature verification
[ ] Webhook idempotency
[ ] Subscription reconciliation
[ ] Entitlement checks
```

## Security

```text
[ ] Rate limiting
[ ] CSRF review
[ ] XSS review
[ ] SQL injection review
[ ] Secret review
[ ] Dependency audit
[ ] API key hashing
[ ] Public dashboard security
```

## Observability

```text
[ ] Sentry
[ ] Structured logs
[ ] Request IDs
[ ] OpenTelemetry
[ ] PostHog
[ ] Background job monitoring
```

## Testing

```text
[ ] Unit tests
[ ] Integration tests
[ ] E2E tests
[ ] Authentication tests
[ ] Authorization tests
[ ] Tenant isolation tests
[ ] Billing tests
[ ] Webhook tests
[ ] Data ingestion tests
```

## Performance

```text
[ ] Database query profiling
[ ] Large table virtualization
[ ] Chart performance
[ ] Server rendering review
[ ] Client bundle review
[ ] Cache strategy
[ ] Rate limits
```

## Accessibility

```text
[ ] Keyboard navigation
[ ] Focus management
[ ] Screen reader review
[ ] Contrast
[ ] Reduced motion
[ ] Dashboard keyboard controls
```

---

# Final Architecture

The intended production architecture is:

```text
                                DATALIZE
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                 Next.js                       React
                    │
          ┌─────────┼─────────┐
          │         │         │
         RSC      Actions    Routes
          │         │         │
          └─────────┼─────────┘
                    │
              Service Layer
                    │
       ┌────────────┼────────────┐
       │            │            │
      Auth        Query         AI
       │          Engine         │
       │            │            │
       └────────────┼────────────┘
                    │
              Repository Layer
                    │
                    ▼
              PostgreSQL
                    │
       ┌────────────┼────────────┐
       │            │            │
     Redis       Storage     Background
                              Jobs
                               │
                          Trigger.dev
                               │
              ┌────────────────┼────────────────┐
              │                │                │
            Sync             Reports           AI
              │                │                │
              └────────────────┴────────────────┘


Frontend
────────────────────────────────────────────────

shadcn/ui
Tailwind
Radix
Lucide
Motion
Zustand
TanStack Query
TanStack Table
TanStack Virtual
dnd-kit
Apache ECharts


Infrastructure
────────────────────────────────────────────────

Vercel
Neon PostgreSQL
Redis
S3-compatible Storage
Trigger.dev
Stripe
Resend


Observability
────────────────────────────────────────────────

Sentry
OpenTelemetry
PostHog


Testing
────────────────────────────────────────────────

Vitest
Testing Library
Playwright
```

---

# Engineering Principle

The purpose of Datalize is not to demonstrate that many libraries can be installed into one Next.js project.

The purpose is to demonstrate that each technology exists at the correct architectural boundary.

```text
Next.js
→ application runtime

React Server Components
→ server rendering and composition

Server Actions
→ application mutations

Route Handlers
→ external HTTP interfaces

Better Auth
→ authentication

RBAC
→ authorization

PostgreSQL
→ source of truth

Drizzle
→ typed persistence

Redis
→ ephemeral state and caching

Trigger.dev
→ asynchronous work

ECharts
→ visualization

TanStack Table
→ tabular data

TanStack Virtual
→ large datasets

dnd-kit
→ dashboard interaction

Zustand
→ complex local editor state

TanStack Query
→ client-side server state where required

Zod
→ trust-boundary validation

Vercel AI SDK
→ AI orchestration

Stripe
→ billing

S3
→ object storage

Sentry
→ errors

OpenTelemetry
→ tracing

PostHog
→ product analytics

Playwright
→ user-level correctness
```

The result should be a **modular, observable, secure, type-safe Next.js application** that could plausibly become a real SaaS product without replacing its architecture once the prototype becomes successful.
