# src/modules/dashboards

Owns Dashboard and Dashboard Widget: a named, ordered layout of Saved Query
widgets rendered at one of three preset sizes on a 12-column grid (brief
4.8). This module never compiles SQL, never touches the analytical pool
(`@/db/analytical`), and never imports Recharts — it orchestrates
`@/modules/queries`' `executeSavedQuery` and reads/writes plain
`public`-schema rows through the application pool (`@/db/client`), exactly
like `queries/repository.ts` does for `query_executions`.

## One dashboard per Organization, for now

`getOrCreateDefaultDashboard` gives a workspace its one dashboard, named
literally `"Dashboard"`, on first visit. The `dashboards` table supports
more than one (`organizationId` + `name` unique, not a singleton column),
but multi-dashboard UI is deliberately out of this slice — don't build
picker/rename/create-additional affordances against this table; that's a
comment about scope, not a surprise for the next slice.

## Widgets execute sequentially, never `Promise.all` (docs/decisions/05(c))

An Organization is capped at 5 concurrent analytical executions. A
dashboard with 6+ widgets firing in parallel would exhaust its own budget
and refuse its own widgets with `CONCURRENCY_LIMIT` — the exact failure the
cap exists to prevent for everyone else. `loadDashboard` awaits each
widget's `executeSavedQuery` one at a time, in position order. The
`no-await-in-loop` disable on that loop is load-bearing, not boilerplate:
sequential is the requirement here, not an oversight to fix.

## Every widget fails independently

`loadDashboard` catches per widget: one broken widget (a removed/retyped
column resolving to `SCHEMA_INCOMPATIBLE`, a saved query whose dataset lost
its current version, any other `AppError`) becomes
`{ kind: "error", code, message }` for that widget only — its siblings
still render. Never let one widget's throw blank the whole page. An error
that is not an `AppError` is masked behind a generic message via the
existing `toSafeDto`, exactly like every other client-facing boundary in
this codebase — never leak a raw driver/library message.

`name`, `size`, and `position` for an error widget still come from the
repository join (`dashboard_widgets` → `saved_queries` → `datasets` →
`dataset_versions`), not from the failed execution — a widget that fails
to run is still a labeled, positioned thing on the grid, not a blank slot.

## `saveLayout`'s compare-and-set is one statement, not read-then-write

Brief 4.8 §5: a stale save must never silently overwrite a newer one.
`saveLayout` puts `expectedRevision` in the `UPDATE ... WHERE`'s own
predicate (`revision = $expectedRevision`), inside a transaction, and reads
back whether a row was actually touched — never a separate `SELECT`
followed by an `UPDATE`. Two concurrent callers with the same
`expectedRevision` can both observe the same `SELECT`ed revision at READ
COMMITTED; only one of them can win a single-statement conditional
`UPDATE`. The loser reads the dashboard's current revision (inside the same
transaction, after its own `UPDATE` found nothing to touch) to decide
`NOT_FOUND` (row doesn't exist / isn't this Organization's) from
`CONFLICT` (row exists, revision moved) — then throws accordingly. The
widget writes that follow ride the same transaction, so they're
serialized behind the row's lock too.

`addWidget` and `removeWidget` do **not** bump `revision` — only
`saveLayout`'s explicit reposition/resize does (brief 4.8 §5 ties the
stale-save guard to layout saves, not membership changes). A widget added
or removed concurrently with someone else's in-flight layout edit simply
keeps (or drops) its own row; `saveLayout`'s widget list only touches the
ids it's given, so it can never resurrect a widget someone else just
removed or silently drop one added after the caller's page loaded.

## Permissions

No dashboard-specific `Permission` exists in the closed list
(`src/modules/auth/policy.ts`) — brief 4.8 doesn't add one, and this module
doesn't own that file. `getOrCreateDefaultDashboard` and `loadDashboard`
assert `dataset:read` (every role, including `viewer`, can look at a
dashboard). `addWidget`, `removeWidget`, and `saveLayout` assert
`query:save` (the permission the closed list already reserves for
persisting a query artifact — `viewer` cannot edit a layout, `editor` and
above can). `executeSavedQuery` asserts its own `query:execute`
per widget internally; a `FORBIDDEN` there becomes an ordinary per-widget
error outcome, same as any other `AppError`.

## Tenancy

Every read and write is organization-scoped through `scopedWhere` /
`withOrganizationId`. A dashboard or widget id from another Organization
resolves to nothing in a scoped lookup, which this module turns into
`AppError("NOT_FOUND", ...)` itself — never `assertCan`'s resource
argument, since nothing here is fetched unscoped in the first place to
hand it one.
