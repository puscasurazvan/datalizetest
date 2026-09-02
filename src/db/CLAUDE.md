# src/db — Database Layer

## Three pools, never cross them (docs/adr/0002, docs/decisions/06 #16)

- `client.ts` (`db`, `applicationPool`) is the **application pool**: auth, dataset metadata, imports, jobs, audit — metadata only, no analytical or import query ever runs here.
- `analytical.ts` (`analyticalPool`) is the **interactive analytical pool**: ad-hoc and saved query execution only. Its 30s `statement_timeout` (`ANALYTICAL_STATEMENT_TIMEOUT_MS`) is scoped to interactive query execution — it is not "the analytical pool's timeout" in general, and it caps at 5 concurrent executions per Organization.
- `analytical.ts` also constructs the **import pool** (`importPool`), a separate `pg.Pool` with its own, much longer `statement_timeout` for `import.load`, set at pool construction (10 min — a pool that cancels every statement at 30s cancels every load). It is not subject to the interactive pool's concurrency limit.
- Never run a dataset/analytical query on the application pool. Never run metadata writes on either analytical pool. Never run `import.load` on the interactive pool, and never run interactive query execution on the import pool.
- There is no transaction across pools (docs/decisions/06 #16) — DDL (`CREATE TABLE`/`TRUNCATE`) and row loading for `import.load` run on the **import pool**; version metadata commits on the **application pool**, strictly last, as the "no transaction across pools" rule requires.

## Schema scope (docs/adr/0002)

- Drizzle schema files (`schema/`) describe the `public` schema only.
- `drizzle.config.ts` sets `schemaFilter: ["public"]`. This is **NOT optional**: the `analytical` schema holds runtime-created per-Dataset-Version tables, and without the filter drizzle-kit would diff it and emit `DROP TABLE` for live customer data.
- Never point drizzle-kit at the `analytical` schema. Never add `analytical` to `schemaFilter`.

## Migrations

- Migrations are committed, never edited after they ship. Fix forward with a new migration.

## Tenancy

- Every tenant-owned table carries `organization_id`, indexed.
