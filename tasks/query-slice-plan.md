# Query slice — implementation plan

Goal: open a Dataset → build a grouped query → get a trustworthy table or bar chart. No SQL, no saved queries.

## Corrections to the agreed ordering (research overrides the brief)

1. **Step 4 is a Route Handler, not a Server Action.** `src/app/CLAUDE.md:9-12` mandates `src/app/api/queries/execute` for interactive execution. Ordering otherwise unchanged.
2. **The surface is called "query builder", not "Explore".** "Explore" appears nowhere in `CONTEXT.md` or `docs/`; `docs/decisions/01:25` and `05:202` say query builder. File and copy names follow.
3. **Compilation and execution live in `src/modules/analytical-store`, not `src/modules/queries`.** `analytical-store/CLAUDE.md` "Build order" says `execute()` is added to that module, and "identifiers come only from the stored mapping — never from a caller or a QueryAst". A compiler in `queries/` would have to be handed physical names, which `docs/adr/0002` forbids. `queries/` keeps QueryAst, validator, version/column resolution, authorization, audit and the DTO. `analytical-store` imports `ResolvedQuery` **type-only** (`import type`) — erased at build, no runtime cycle; `.oxlintrc.json` has no `import/no-cycle` rule.

---

## Step 0 — Record the ownership decision (docs only)

- Create `docs/adr/0005-query-compilation-lives-in-the-analytical-store.md` (~10 lines): statement + the two-line consequence (physical names never cross a module boundary; `queries` hands in a `ResolvedQuery` and gets back Column-ID-keyed rows).
- `src/modules/queries/CLAUDE.md` line 3: "Owns QueryAst, validator, compiler, executor…" → "Owns QueryAst, validator, version resolution, execution audit, saved queries. Compilation and execution live in `src/modules/analytical-store` (docs/adr/0005)."
- `src/modules/analytical-store/CLAUDE.md` "Build order": `execute()` now ships; note it takes a `ResolvedQuery` and returns Column-ID/alias-keyed rows.
- Root `CLAUDE.md` "Where to look": `src/modules/queries/` row → "QueryAst, validator, version resolution, execution audit"; `src/modules/analytical-store/` row → "Physical tables, AnalyticalStore boundary, query compilation and execution (docs/adr/0005)". This is the always-loaded brief — leaving it stale is what the next agent reads first.
- Amend `docs/decisions/05` "Result Contract": the identifier field is `executionId`, not `queryId` (`queryId` already means a saved query). A one-line amendment, because `docs/reference/` cannot override a decision and neither can a plan.
- Fix the stale comment at `src/modules/analytical-store/postgres-store.ts:12-13` ("`analyticalPool` never touched by this module" — `readRows` already touches it, and `execute` will).

**verify:** `pnpm lint && pnpm format`

---

## Step 1 — `query_executions` table + migration 0005

Create `/Users/razvanpuscasu/orca/projects/datalizer/src/db/schema/queries.ts`. Copy the column idioms verbatim from `src/db/schema/datasets.ts` (`randomUUID()` `$defaultFn`, `withTimezone: true`, open-vocabulary `text` error code as at `datasets.ts:273-277`).

```ts
export const queryExecutionStatusEnum = pgEnum("query_execution_status", ["success", "failed"])

export const queryExecutions = pgTable(
  "query_executions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    datasetVersionId: text("dataset_version_id")
      .notNull()
      .references(() => datasetVersions.id, { onDelete: "restrict" }),
    organizationTimezone: text("organization_timezone").notNull(),
    status: queryExecutionStatusEnum("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    rowCount: integer("row_count"), // NULL on failure — not the same fact as 0 matched rows
    errorCode: text("error_code"), // an AppErrorCode; NULL on success. No errorMessage column.
  },
  (table) => [index("query_executions_organization_id_idx").on(table.organizationId)],
)
```

- No `savedQueryId`, no `executedByUserId`, no second index (out of scope, see below).
- No `defaultNow()` on the timestamps — the row is inserted after the query finishes; the executor supplies both stamps.
- Add `export * from "./queries"` to `src/db/schema/index.ts` **before** generating, or drizzle-kit silently skips the table.

```bash
docker compose up -d
pnpm db:generate --name add_query_executions      # -> 0005_add_query_executions.sql + meta
pnpm db:migrate
DATABASE_URL="postgresql://datalize:datalize@localhost:5434/datalize_test" pnpm db:migrate
```

The second `db:migrate` is required — nothing migrates the 5434 test DB for you, and every new integration test would fail on a missing relation.

**verify:** `pnpm typecheck && pnpm test:integration` (existing suite still green against the freshly migrated 5434 DB)

---

## Step 2 — Dataset schema read without the preview

`src/modules/datasets/repository.ts`: tighten `DatasetColumnSummary.type` from `string` to `(typeof datasetColumnTypeEnum.enumValues)[number]`. The pgEnum already lists exactly the six canonical types, so the select returns that union — this deletes a widening, needs no guard and no cast.

`src/modules/datasets/service.ts` — add, and refactor `getDatasetDetail` to call it (two callers, not a single-use abstraction):

```ts
export interface DatasetSchema {
  readonly datasetVersionId: string
  readonly columns: readonly DatasetColumnSummary[]
}
export async function getDatasetSchema(
  context: RequestContext,
  datasetId: string,
): Promise<DatasetSchema>
```

`assertCan(toPolicyContext(context), "dataset:read")`; throws `AppError("NOT_FOUND", …)` when the Dataset is absent or has no current version. Export from `src/modules/datasets/index.ts`. Reason it exists: `executeQuery` must not pay for `readRows`' 50-row preview on every execution, and cross-module `repository.ts` imports are forbidden.

Also export `CANONICAL_IANA_TIMEZONES` from `src/modules/organizations/index.ts` (one line) — the compiler needs the sync allowlist; `assertKnownTimezone` is private and async.

**verify:** `pnpm typecheck && pnpm test`

---

## Step 3 — Compiler: `ResolvedQuery` → parameterised SQL (pure)

Create `/Users/razvanpuscasu/orca/projects/datalizer/src/modules/analytical-store/compile-query.ts`.

```ts
import type { ResolvedQuery } from "@/modules/queries" // type-only, see Step 0

interface SelectItem {
  readonly expr: string // un-cast SQL expression: reused by GROUP BY and ORDER BY
  readonly name: string // Column ID (dimension) or measure alias
  readonly type: AnalyticalColumnType
}

export interface CompiledQuery {
  readonly text: string
  readonly values: readonly (string | number | boolean)[]
  readonly columns: readonly QueryResultColumn[] // { name, type }, from types.ts
  readonly effectiveLimit: number
}

export function compileQuery(
  query: ResolvedQuery,
  datasetVersionId: string,
  physicalNameByColumnId: ReadonlyMap<string, string>,
  organizationTimezone: string,
): CompiledQuery
```

Emission rules:

- Identifiers only via `quoteIdentifier` / `physicalColumnName` / `qualifiedTableName` from `./physical-names`. Never concatenate.
- SELECT item: `` `${item.expr}::text AS ${quoteIdentifier(item.name)}` ``. Dimensions first, then measures.
- **`GROUP BY` and `ORDER BY` use `item.expr`, never the `::text` cast and never a positional index** — `ORDER BY 2` over a text-cast `SUM(...)` sorts lexicographically and puts "9" after "100".
- Dimension expr: the quoted physical column, or `date_trunc('<granularity>', <col> AT TIME ZONE '<tz>')` when `granularity` is present. Granularity is a closed enum; `tz` is checked against `CANONICAL_IANA_TIMEZONES` and throws `AppError("VALIDATION", "Workspace timezone is not a recognised IANA timezone.")` on a miss — never a UTC fallback (`docs/decisions/03`).
- **Re-check granularity against the column type here**, in addition to the validator's check: `granularity` on a column whose type is not `timestamptz` throws `AppError("VALIDATION", …)`. The validator's guarantee stops at the module boundary — `compileQuery` is exported from `analytical-store` and any caller can hand-build a `ResolvedQuery`. A calendar `date` is never passed through `AT TIME ZONE` or `date_trunc` (`docs/decisions/03`, "Three Kinds of Date/Time Value").
- Measure expr: `column === null` → `COUNT(*)`; else `COUNT(x)` / `COUNT(DISTINCT x)` / `SUM|AVG|MIN|MAX(x)`.
- Measure result type: `count`/`count_distinct` → `integer`; `sum`/`avg` → `decimal` (Postgres `SUM(bigint)` is `numeric`); `min`/`max` → the column's own type.
- `GROUP BY` all dimension exprs whenever `dimensions.length > 0` (this also gives DISTINCT for a dimension-only query). Omitted when there are no dimensions.
- Filters → `WHERE` with `$n` bind parameters for every value. `between` → `BETWEEN $n AND $m`; `in` → `IN ($n, …)`; `is_null`/`is_not_null` → no parameter. Narrow with `switch (filter.operator)` on the preserved discriminated union — no casts.
- **Filter value ↔ column type check lives here** (deferred to the compiler by `query-ast.ts:39-43`): `string`/`date`/`timestamptz` require a string; `integer` a number; `decimal` a number or a string (precision); `boolean` a boolean. Applied per element for `in` and `between`, so mixed-type arrays and tuples are caught. Mismatch → `AppError("VALIDATION", …)` naming the column's logical name.
- **Explicit `orderBy` (non-empty) is emitted in order and overrides the default entirely** (`docs/decisions/05`): resolve `{kind:"dimension", columnId}` and `{kind:"measure", alias}` to the matching `SelectItem.expr` — never the `::text` cast, never a positional index — then `ASC`/`DESC`. An unresolvable ref throws `AppError("VALIDATION", …)`; the validator already resolves them, this is the boundary re-check.
- Default ordering applies only when `orderBy` is absent or empty: first measure DESC, else first dimension ASC.
- `requestedLimit = query.limit ?? 10000` (`??`, never `||` — `limit: 0` is a legal existence probe); `effectiveLimit = Math.min(requestedLimit, 10000)`; `LIMIT $n` bound to `effectiveLimit + 1`.

Colocate `compile-query.test.ts`. Required cases: `COUNT(*)` for count-all; `date_trunc(…, col AT TIME ZONE '<tz>')` on a `timestamptz` dimension; a `date` dimension (no granularity) emits the bare quoted physical column — no `date_trunc`, no `AT TIME ZONE`; granularity on a non-`timestamptz` column throws; unknown tz throws; every filter operator's SQL and parameter list; **ORDER BY names the un-cast expr**; explicit `orderBy` — dimension ASC, measure DESC, and a mixed two-entry list; default ordering both branches; `limit: 0` → `LIMIT $n = 1`; `limit: 50` → `51`; absent limit → `10001`; a hand-built `ResolvedQuery` with `limit: 50000` → `effectiveLimit` 10000 (the AST schema caps at 10000, so this case can only be reached at this boundary); filter-type mismatches throw.

**verify:** `pnpm test src/modules/analytical-store/compile-query.test.ts && pnpm typecheck`

---

## Step 4 — Executor on the interactive analytical pool

**4a. Deduplicate the mapping read.** `postgres-store.ts` contains the `select({columnId, physicalName}).where(scopedWhere(...)).orderBy(asc(ordinal))` verbatim twice (`:250-266`, `:319-335`). Extract a private `loadColumnMapping(context, datasetVersionId): Promise<Map<string, string>>` and route `loadRows`, `readRows` and `execute` through it — three copies otherwise.

**4b. Slot keys.** Create `src/modules/analytical-store/execution-slots.ts`:

```ts
export function orgLockKeys(organizationId: string): readonly { key1: number; key2: number }[]
```

`hash = createHash("sha256").update(organizationId).digest()`; `key1 = hash.readInt32BE(0)`; `key2 = hash.readInt32BE(4) ^ slot` for slot 1..5. Signed `readInt32BE` — `int4` overflows above 2^31-1. Not exported from the barrel; the integration test deep-imports it (precedent: `pipeline.integration.test.ts:9` deep-imports `physical-names.ts`).

**4c. Execute.** Create `src/modules/analytical-store/execute-query.ts` (`postgres-store.ts` is already ~400 lines; the class method delegates here).

```ts
// added to AnalyticalStore in types.ts
execute(context: RequestContext, datasetVersionId: string, query: ResolvedQuery): Promise<ExecuteResult>

export interface ExecuteResult {
  readonly columns: readonly QueryResultColumn[]
  readonly rows: readonly AnalyticalRow[]
  readonly rowCount: number
  readonly truncated: boolean
  readonly hasMore: boolean
  readonly durationMs: number
}
export interface QueryResultColumn { readonly name: string; readonly type: AnalyticalColumnType }
```

Sequence, exactly: `assertVersionInOrganization` → `loadColumnMapping` → `compileQuery` → `analyticalPool.connect()` → `BEGIN` → `SET LOCAL statement_timeout = ${ANALYTICAL_STATEMENT_TIMEOUT_MS}` → for each of the 5 slots `SELECT pg_try_advisory_xact_lock($1::int4, $2::int4)` until one returns true, else throw `AppError("CONCURRENCY_LIMIT", "Too many queries running at once. Please wait a moment and try again.")` → `startedAt = Date.now()` → `client.query({ text, values, rowMode: "array" })` → `durationMs = Date.now() - startedAt` → `COMMIT`. `ROLLBACK` in the catch, `client.release()` in `finally` — the `postgres-store.ts:346-359` shape.

- `rowMode: "array"` + the `::text` projection + `typeof value === "string" ? value : null`, exactly as `postgres-store.ts:61-79`. Rows are `Readonly<Record<string, string | null>>` keyed by Column ID / alias — decimal stays a string (`docs/decisions/06 #11`), and this shape satisfies decision 05's `Record<string, unknown>`.
- `hasMore = raw.length > effectiveLimit`; `rows = raw.slice(0, effectiveLimit)`; `rowCount = rows.length`; `truncated = hasMore && effectiveLimit === 10000`.
- Timeout mapping: `error instanceof Error && "code" in error && error.code === "57014"` → `AppError("QUERY_TIMEOUT", "Query exceeded 30 second timeout. Refine your query or contact support.", { cause: error })`. Every other pg error goes through the existing `safeStoreError` (`postgres-store.ts:95-109`) so `relation "analytical.dv_..." does not exist` never becomes a thrown `.message`.

Colocate `execute-query.integration.test.ts` (5434 DB, `src/shared/context/testing.ts` for the context). Cases:

- grouped `SUM` by month with an `AT TIME ZONE` dimension: correct buckets, DST transition and month boundary rows in the fixture.
- decimal comes back as a string, not a number.
- row keys are Column IDs / aliases; no `c_0` anywhere in keys or `result.fields`.
- limit matrix on a fixture whose measure values cross a digit boundary (9, 10, 100 — proves ordering is numeric): `limit: 0` → `[]` with `hasMore` reflecting existence, `truncated: false`; `limit: 1`; `limit: 50` on 51 rows → 50 rows, `hasMore: true`, `truncated: false`; 10,001-row fixture with no limit → 10,000 rows, `hasMore: true`, `truncated: true`. Build the 10,001-row fixture with `loadRows` over a generated async iterable — no new harness.
- `CONCURRENCY_LIMIT`: hold all 5 slots on 5 separate `analyticalPool` clients in open transactions using `orgLockKeys`, assert the 6th execution throws immediately; release.
- cross-tenant `datasetVersionId` → `NOT_FOUND`.

No integration test for `QUERY_TIMEOUT` — it costs 30s of wall clock. The `57014` mapping is unit-tested in `execute-query.test.ts` against a fake `{ code: "57014" }`.

**verify:** `pnpm test:integration src/modules/analytical-store/execute-query.integration.test.ts && pnpm test src/modules/analytical-store/execute-query.test.ts`

---

## Step 5 — `queries` module: service, repository, barrel

**5a. Result contract.** `src/modules/queries/schema/query-result.ts`:

```ts
export const queryResultSchema = z.strictObject({
  columns: z.array(z.strictObject({ name: z.string(), type: z.enum(ANALYTICAL_COLUMN_TYPES) })),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.null()]))),
  rowCount: z.number().int(),
  truncated: z.boolean(),
  hasMore: z.boolean(),
  durationMs: z.number().int(),
  executionId: z.string(),
  executedAt: z.string(),
})
export type QueryResult = z.infer<typeof queryResultSchema>
```

A Zod schema rather than a bare interface because the client must parse `res.json()` cast-free — two uses, not one. Named `executionId`, not `queryId`, per the Step 0 amendment to `docs/decisions/05` — `queryId` already means a saved query (`docs/full-documentation-audit.md:267`).

**5b. Repository.** `src/modules/queries/repository.ts`:

```ts
export async function recordQueryExecution(
  context: RequestContext,
  row: NewQueryExecution,
): Promise<string>
```

`db.insert(queryExecutions).values(withOrganizationId(context, row)).returning({ id })` — application pool, after the analytical transaction has committed or rolled back. Never inside it.

**5c. Service.** `src/modules/queries/service.ts`:

```ts
export async function executeQuery(context: RequestContext, ast: QueryAst): Promise<QueryResult>
```

1. `assertCan(toPolicyContext(context), "query:execute")`
2. `getDatasetSchema(context, ast.datasetId)` → `{ datasetVersionId, columns }`. A failure here (NOT_FOUND / FORBIDDEN) writes **no** audit row — the table's `datasetVersionId` is NOT NULL and there is nothing to record.
3. `startedAt = new Date()`, then **open the `try`** — everything below runs inside it. The version is resolved, so every failure from here down is auditable.
4. `validateQueryAgainstDataset(ast, columns.map((c) => ({ id: c.columnId, name: c.name, type: c.type, nullable: c.nullable })))`. On `!ok`, throw `AppError("SCHEMA_INCOMPATIBLE", ...)` with the raw issues in `internal`. The message names the offending column: `TYPE_INCOMPATIBLE` carries a human `columnName`, but `COLUMN_REMOVED` carries only the `columnId` — the column is gone from the current version, so no human name is recoverable without the previous version's columns (`validator.ts` documents that as a future added parameter). ADR 0003's "never a blank chart" is met either way; the Column-ID case is recorded under "Not built in this slice".
5. `result = await new PostgresAnalyticalStore().execute(context, datasetVersionId, validation.query)`. No `deps` object — one caller, and `getDatasetDetail` already instantiates the store directly.
6. `catch`: `recordQueryExecution` with `status: "failed"`, `errorCode: toSafeDto(error).code`, `rowCount: null`, `completedAt: new Date()`, then rethrow. **One `catch` covers all of it** — `SCHEMA_INCOMPATIBLE`, `CONCURRENCY_LIMIT`, `QUERY_TIMEOUT` and unexpected alike (`queries/CLAUDE.md`: "on failure too"; `docs/decisions/03` implications #4). The only path writing no audit row is a **pre-resolution** failure at 1–2, where `dataset_version_id` is NOT NULL and no version exists to record.
7. Success: `recordQueryExecution` with `status: "success"`, `rowCount`, then return the `QueryResult` carrying the returned `executionId`.

`organizationTimezone` on every row comes from `context.organizationTimezone` (already on `RequestContext`) — the same value the compiler interpolates. Two `durationMs` definitions, both deliberate: the **audit column** is service wall clock (it includes lock wait, which is what an ops reader wants); **`QueryResult.durationMs`** is the store's measurement around `client.query()` per `docs/decisions/05`.

**5d. Barrel.** `src/modules/queries/index.ts`: `executeQuery`, `queryAstSchema`, `queryResultSchema`, and types `QueryAst`, `QueryResult`, `ResolvedQuery` (the last for `analytical-store`'s type-only import). Nothing else escapes `./internal`.

Colocate `service.integration.test.ts`: a success writes one `success` row with the right `datasetVersionId` and timezone; a query naming a dropped Column ID throws `SCHEMA_INCOMPATIBLE` **and** writes a `failed` row with that error code; a missing dataset throws `NOT_FOUND` and writes no row.

**verify:** `pnpm test:integration src/modules/queries/service.integration.test.ts && pnpm typecheck`

---

## Step 6 — Route Handler

Move `statusForErrorCode` out of `src/app/api/uploads/route.ts:45-62` into `src/shared/errors/index.ts` and import it in both places — two identical 20-line exhaustive switches otherwise.

Create `/Users/razvanpuscasu/orca/projects/datalizer/src/app/api/queries/execute/route.ts`:

```ts
export async function POST(request: Request): Promise<NextResponse>
```

`createRequestContext()` → `queryAstSchema.safeParse(await request.json())`, on failure throw `AppError("VALIDATION", "Invalid query.")` (a bare `.parse` would surface a `ZodError` that `toSafeDto` masks as `INTERNAL`/500) → `executeQuery(context, parsed.data)` → `NextResponse.json(result)`. Catch → `toSafeDto` + `statusForErrorCode`, exactly the uploads shape.

**verify:** `pnpm typecheck && pnpm lint`

---

## Step 7 — Query builder surface

**7a. AST construction (pure, testable).** `src/components/data/query-builder-ast.ts`:

```ts
export interface QueryBuilderState {
  readonly dimensionColumnId: string | null
  readonly granularity: Granularity | null
  readonly measureColumnId: string | null
  readonly aggregation: Aggregation
  readonly filter: {
    readonly columnId: string
    readonly operator: "eq" | "neq"
    readonly value: string
  } | null
}
export function buildQueryAst(datasetId: string, state: QueryBuilderState): QueryAst
```

Fixed aliases: the charted measure is `"value"` and is **first**; a `{ field: null, aggregation: "count", alias: "rows" }` measure is second. First-measure-DESC default ordering therefore ranks by the charted value, which is what makes `bar-chart.tsx`'s "top N" wording honest, and `"rows"` feeds the required `BarDatum.rowCount`. No slugify, no alias collisions, no `orderBy` and no `limit` in the AST — an unlimited (to the 10,000 cap) query is required for `groupCount` to mean anything.

The single optional filter row exists because the product's own headline query is `SUM(amount) by month filtered to one currency` (`docs/decisions/01:62`).

**The currency rule ships here, at query-build time**, as `docs/decisions/01:62` requires — a `SUM`/`AVG`/`MIN`/`MAX` measure over a column named `amount` on a dataset that also carries a `currency` column keeps submit disabled until an `eq` filter pins `currency` to one value, with the reason shown inline. `transactions_stripe.csv` is deliberately mixed-currency (USD/GBP/EUR), so without this the first screen produces exactly the wrong number that fixture exists to expose. `ponytail:` name-based heuristic — the general rule needs a monetary/currency column tag no schema carries yet; swap the heuristic for the tag when one exists.

Colocate `query-builder-ast.test.ts`: measure-only, dimension-only, granularity only offered on `timestamptz`, alias ordering, filter present/absent.

**7b. Client leaf.** `src/components/data/query-builder.tsx` (`"use client"`, ~140 lines): `NativeSelect`s for dimension / granularity / measure / aggregation / view (`table | bar`) plus the optional filter row, a `Button` submit, `useState` for state and for `{status: "idle" | "loading" | "error" | "done"}`. One `fetch("/api/queries/execute", { method: "POST", body: JSON.stringify(buildQueryAst(...)) })`; parse the response with `queryResultSchema` on 2xx and with the safe-error shape otherwise. Follows `import-sample-buttons.tsx` (disabled while busy, `role="alert"` on the error). No `AbortController` — one builder, one request at a time.

Branch the error copy on the safe DTO's `code` (`docs/decisions/05` §(b)/§(c) specify the wording):

- `QUERY_TIMEOUT`: "This query took too long (>30s). Try adding filters, reducing the date range, or aggregating at a higher granularity (e.g., month instead of day)."
- `CONCURRENCY_LIMIT`: "Too many queries running at once. Please wait a moment and try again."
- anything else: the safe DTO's own message.

**7c. Result view.** `src/components/data/query-result-view.tsx` (~120 lines): early returns for idle / loading / error / empty, then `switch (view)`.

- `"bar"`: build the `BarVisualizationConfig` and run `validateVisualizationConfig(config, result)` first — a mismatch (no dimension picked, non-numeric measure) is an error state, not a crash. Map rows to `BarDatum[]`: `label = row[dimensionColumnId] ?? "—"`, `value = Number(row.value)`, `rowCount = Number(row.rows)`. `groupCount = result.truncated ? "10000+" : result.rowCount`. `granularityNote = granularity ? granularityFooterText(granularity, timezone) : \`Grouped by ${dimensionName}\``. Render `BarVisualization`.
- `"table"`: a result-shaped table over `result.columns` (`{name, type}`) and `Record<string, string | null>` — `DatasetPreviewTable` takes `DatasetColumnSummary[]` and does not fit. Reuse its cell conventions (right-aligned `tabular-nums` for `integer`/`decimal`, `—` for null, sticky header).
- When `result.truncated`, render exactly: "This result was truncated to 10,000 rows. Refine your query or export the full dataset."

Colocate `query-result-view.test.tsx` — one case per state (idle, loading, error, empty, table data, bar data, config mismatch), in the `dataset-schema-table.test.tsx` style.

**7d. Page.** `src/app/(app)/datasets/[id]/page.tsx`: one more `Sheet` titled "Query builder", rendered only when `version !== null`, passing `datasetId`, `columns` and `context.organizationTimezone` into `<QueryBuilder />`. The page stays a Server Component.

**verify:** `pnpm test src/components/data/query-builder-ast.test.ts src/components/data/query-result-view.test.tsx && pnpm typecheck && pnpm lint && pnpm test:e2e`

---

## Constraint coverage

Satisfied by a step: Column-ID-only naming and `AS "<columnId>"` aliasing (3); identifiers only from `physical-names` (3); all values bind-parameterised (3); `COUNT(*)` for count-all (3); `date_trunc` on `timestamptz` only, allowlisted tz interpolated as a literal, unknown tz fails, Monday weeks (3); four limit values with `??` (3); explicit `orderBy` and default ordering (3); `truncated` vs `hasMore` (4); BEGIN / `SET LOCAL` / two-arg `pg_try_advisory_xact_lock` × 5 / COMMIT, fail-fast (4); `ANALYTICAL_STATEMENT_TIMEOUT_MS` reused, interactive pool only (4); decimal as string (4); no transaction across pools (5); audit row on success and failure with the resolved version and timezone (1, 5); `SCHEMA_INCOMPATIBLE` names the column (5); `organization_id` on every row plus its own index (1); `scopedWhere` / `withOrganizationId` (5); `assertCan` in the service (5); `AppError` + `toSafeDto` + existing codes only (5, 6); Route Handler with `statusForErrorCode` (6); result column types from Datalize metadata, never OIDs (3); bar cap wording honest under default ordering (7); required chart states (7); per-code limit copy (7); single-currency guard before submit (7); no casts throughout.

## Not built in this slice

- **Saved queries** — no `saved_queries` table, no `savedQueryId` FK, no `query:save` path. `SCHEMA_INCOMPATIBLE` _resolution_ UI (ADR 0003's repair flow) is the following increment; this slice only surfaces the error.
- **The general currency rule** — the `amount`/`currency` name heuristic in 7b covers the fixtures and the headline query; a column-level monetary/currency tag, and enforcement server-side rather than at query-build time, waits for that tag to exist.
- **A human column name for `COLUMN_REMOVED`** — `SCHEMA_INCOMPATIBLE` names the Column ID for a dropped column, because the name lives only in the previous Dataset Version's columns. Recovering it means passing those in; deferred with ADR 0003's repair flow.
- **Exponential retry backoff** on `CONCURRENCY_LIMIT` (`docs/decisions/05` §(c) suggests 1s/2s/4s/8s) — the copy tells the user to retry and one builder issues one request; automatic retry waits for a real queue.
- `executedByUserId`, a `(organization_id, started_at)` audit index, `droppedAt` semantics on `analytical_tables` — no reader exists for any of them.
- Unifying the three `DatalizeColumnType` declarations and replacing `QueryResultShape` in `visualizations/validate.ts` — all structurally identical string unions and therefore already assignable. A rename is churn with no defect behind it.
- `bar-chart.tsx`'s missing loading/empty/error states and its duplicated `capNote` — pre-existing debt; the result view handles the states above it.
- Per-widget cancellation / `AbortController`, multi-widget dashboards, `orderBy` and `limit` controls in the UI, more than one filter row, chart types beyond table and bar, the single-round-trip `generate_series` slot optimisation.
- Integration test for `QUERY_TIMEOUT` (30s wall clock); the `57014` mapping is unit-tested instead.

## Review provenance

Drafted and fact-checked against the repo by 6 parallel readers, then reviewed by a doc-compliance
lens whose 8 issues (2 blocking) are folded in above. The **over-engineering** and **completeness**
lenses never ran — three attempts died on API 529. Nothing here has been checked for YAGNI or for
missing steps/files/states, so treat step granularity and the file lists as unverified.
