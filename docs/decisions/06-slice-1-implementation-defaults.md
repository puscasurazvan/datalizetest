# Datalize Slice 1 — Implementation Defaults

Decisions 01–05 leave a set of smaller questions open that Slice 1 code hits immediately. Each is recorded here with the default being implemented. All are cheap to change; none is an architectural commitment. Two are flagged **worth your attention** because they trade off against each other rather than having an obviously right answer.

---

## Import pipeline

**1. The import is two phases, not one.**
Decision 04 requires the user to see a preview and override the column type or timezone _before_ the import commits; decision 02 shows a single job. Those only reconcile as two Trigger.dev tasks:

```
upload → import.profile → AWAITING_CONFIRMATION → (user confirms) → import.load → COMPLETED
```

`import.profile` streams the object, infers the schema, enforces the ceilings, and writes `imports.proposed_schema`. `import.load` creates the physical table and loads rows against `imports.confirmed_schema`. This adds one status and two `jsonb` columns.

**2. Type inference samples the first 10,000 rows; the threshold is 95%.**
A column is inferred as a type when ≥95% of non-empty sampled values parse as it, else `string`. Sampling rather than a full pass keeps profiling off a second complete read of a 50 MB object. Consequence: a dirty value beyond row 10,000 can fail to parse at load time — it becomes `NULL` and an `import_errors` row, per (4).

**3. An empty CSV cell is `NULL`, not an empty string.**
It marks the column nullable and satisfies `is_null` filters. A quoted `""` is treated identically — CSV cannot distinguish them without a dialect flag nobody sets.

**4. An unparseable value becomes `NULL` and an `import_errors` row. The row is kept.**
Dropping the row would make `dataset_versions.row_count` disagree with the file and silently change every `SUM`. A kept row with a null cell is visible in both.

**5. Worth your attention — `import_errors` does not store the offending value.**
It records row number, column name, and an error code. Storing the raw value would make the error far more actionable ("`amount` was `$1,234.56`"), but it puts customer data in an application table and into every Sentry breadcrumb that touches it, against the security baseline's "do not log customer datasets". If you want the value, the honest version is a short retention window and explicit redaction, not an ordinary column.

**6. Column-ID continuity matches on the exact trimmed header, case-sensitively.**
A BOM on the first header is stripped. A blank header becomes `column_{position}`. A duplicate header — real in Stripe exports — becomes `{name}_{position}` for the second and later occurrences, because `unique(dataset_version_id, name)` must hold. All three are reported in the import summary, since each one silently breaks version continuity if the user does not know it happened.

**7. The idempotency key is derived server-side** from the object key and dataset ID, not supplied by the client. A client-minted UUID makes a double-submit in two tabs produce two keys and two versions, which is the exact failure the key exists to prevent.

**8. The uploaded raw file is retained until its dataset version is deleted**, then deleted with it. Re-running a failed load requires the original object, so deleting on success-only is not enough.

---

## Query contract

**9. `orderBy` uses a discriminated reference, not a bare string.**

```ts
{ kind: "dimension"; columnId: string } | { kind: "measure"; alias: string }
```

Decision 05 allows either a Column ID or a measure alias in one `field: string`. Aliases are user-supplied, so a user can alias a measure to a string equal to a Column ID and nothing defines which wins. Aliases additionally must match `^[a-z][a-z0-9_]{0,29}$` and be unique — they reach a SQL identifier position.

**10. A user-supplied `limit` is honoured exactly and `truncated` stays false.**
The compiler emits `min(userLimit, 10000) + 1`. `truncated: true` means _the 10,000 cap cut the result_, never _you asked for 50 and got 50_. One meaning per flag.

**11. `decimal` is Postgres `numeric` and crosses the wire as a string.**
`double precision` would return a JSON number and lose precision on a `SUM` over a million rows — visible in a revenue total, which is the product's first query. The result contract already carries the Datalize type tag, so the client knows to format it.

**12. Bar charts cap at the top 50 categories** with an explicit "showing top 50 of N" note. Nothing in decision 05 caps _categories_, and `GROUP BY customer_name` over the fixture legitimately returns thousands.

---

## Tenancy

**13. Role → permission matrix.** Review #9 requires one; no document defines it.

|                                                  | owner | admin | editor | viewer |
| ------------------------------------------------ | ----- | ----- | ------ | ------ |
| `dataset:read`, `query:execute`                  | ✓     | ✓     | ✓      | ✓      |
| `dataset:create`, `dataset:manage`, `query:save` | ✓     | ✓     | ✓      |        |
| `organization:update`, `member:manage`           | ✓     | ✓     |        |        |
| `organization:delete`                            | ✓     |       |        |        |

**14. A user signing up with no organization gets a personal one**, and becomes its owner. A session whose `activeOrganizationId` names an organization the user is no longer a member of is refused with `FORBIDDEN` and cleared, not silently switched. Role vocabulary configuration and the invariants that keep membership consistent: #19.

---

## The benchmark gate

**15. Worth your attention — the gate needs pass/fail numbers.**
Decision 01 says "adjust limits if import > X minutes or simple aggregations > Y ms" and never sets X or Y. A gate without exit criteria is not a gate. Proposed, to be confirmed or replaced by measurement:

| Measure                                                     | Pass                 |
| ----------------------------------------------------------- | -------------------- |
| Profile phase, 50 MB / 1M rows                              | ≤ 90 s               |
| Load phase, 50 MB / 1M rows                                 | ≤ 5 min              |
| `SUM(amount) GROUP BY month`, single currency, over 1M rows | ≤ 3 s p50, ≤ 8 s p95 |

If the load phase misses, the first response is a different load strategy (`COPY FROM STDIN` versus batched inserts versus a text staging table), not a smaller ceiling. The ceiling only moves once the strategy is settled. The ≤5 min figure here is the pass/fail target; #16 sets the enforced ceiling, with margin above it.

**16. Three runtime contracts, not one — the import load does not share the interactive query timeout.**
This item is what scopes decision 05 §(b)'s 30s `statement_timeout` to interactive query execution — decision 05's text does not draw that boundary on its own, and until this item lands, "30s" reads as the analytical pool's only contract. It cannot also govern `import.load`: a 50 MB / 1M row load has a ≤5 min pass bar (#15), and a pool that cancels every statement at 30s cancels every load. The three contracts:

| Pool                            | Runs                                                            | `statement_timeout`                                                                                                                        | Concurrency                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Interactive analytical pool** | ad-hoc and saved query execution (decision 05 §b/§c)            | 30s, pool-level                                                                                                                            | 5 concurrent executions per Organization (decision 05 §c)                                                                                           |
| **Import pool**                 | `import.load`: creates the physical table (DDL) and loads rows  | 10 min — double the ≤5 min pass bar in #15, a circuit breaker, not a target — set at pool construction, same as the interactive pool's 30s | governed by Trigger.dev's own task/queue concurrency settings, not the query-slot lock (#18); an import does not compete for a query execution slot |
| **Application pool**            | all metadata writes: `imports`, `dataset_versions`, jobs, audit | none beyond Postgres defaults                                                                                                              | n/a                                                                                                                                                 |

The interactive 30s timeout is **not** weakened to accommodate imports — a separate pool, not a per-session override on the interactive pool, is the point: a `SET LOCAL` escape on the interactive pool would hold one of its 10 connections for up to 10 minutes and defeat the reason analytical.ts sets the timeout at pool level in the first place (it must apply even to a code path that forgets to open a transaction). The import pool is a second, independently constructed `pg.Pool`. `import.profile` (streaming read, schema inference) touches neither analytical pool; it reads the object and writes `imports.proposed_schema` on the application pool only.

The import pool creates the analytical schema's physical table and performs the row loading. The application pool performs the version-metadata commit as the strictly last statement — this is the "no transaction across the two pools" rule, unchanged: a crash between DDL/load and the metadata commit would otherwise leave an orphan physical table or a `completed` version pointing at nothing. Made safe by a deterministic physical table name derived from the version ID, `CREATE TABLE IF NOT EXISTS` plus `TRUNCATE` before loading, and the metadata commit as the strictly last statement.

The Trigger.dev `import.load` task sets `maxDuration` above the import pool's 10 min load timeout — 15 min is enough headroom for Postgres to enforce its own cutoff and for the task to catch that error and record the failure, rather than Trigger.dev killing the task mid-cleanup.

When a load hits the 10 min timeout, Postgres cancels the statement and returns an error; the connection is not dropped and is returned to the pool. The task marks the import `FAILED` on the application pool rather than leaving it `RUNNING`. A Trigger.dev retry re-runs `import.load` from the top — `CREATE TABLE IF NOT EXISTS` plus `TRUNCATE` make the retry safe and it converges. If the timeout is caused by data volume rather than a transient issue, the retry hits the same wall, and the fix is #15's "different load strategy," never a larger ceiling by default.

Code follow-up (not made by this document): add an `importPool` beside `analyticalPool` in `src/db/analytical.ts` — `statement_timeout: 600_000`, a small `max` (e.g. 2, since Slice 1 runs one load per Organization at a time by product design, not by lock contention); `import.load`'s Trigger.dev task config sets `maxDuration: 900`; `ANALYTICAL_STATEMENT_TIMEOUT_MS` keeps its current value of `30_000` and becomes the interactive pool's constant specifically, not "the analytical pool's" generically. src/db/CLAUDE.md "Two pools, never cross them" must be updated to describe three pools — it is not fixed by this document, only pointed at.

---

## Job dispatch durability

**17. Persist-before-dispatch guarantees no run without a durable row — not the converse.**
Writing the job row before calling Trigger.dev (adr/0001) guarantees a Trigger.dev run is never dispatched without a matching committed PostgreSQL row. It does not guarantee the converse: a crash after the row commits and before Trigger.dev accepts the enqueue leaves a committed row that was never dispatched, and nothing about "persist before dispatch" makes that window unreachable.

A **reconciler** — a scheduled sweep, not a polling worker — detects and closes that window. Chosen over a transactional outbox because it needs no new table or drain process: it reuses the existing job row and status column. Slice 1 has exactly one job type (import), triggered one row at a time by an explicit user action, so a periodic sweep is cheap at this volume — an outbox would add a table and a drain process to solve a problem a sweep already solves here. A "no polling worker" decision (adr/0001, decision 01 #2) rules out a long-lived process, not a short scheduled one — the reconciler runs as a Trigger.dev scheduled task, the same shape as any other bounded invocation.

States, and who moves a row between them:

| State         | Set by                                                                                                                                    | Meaning                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `created`     | the request handler, at row insert commit (application pool)                                                                              | durable, no dispatch attempted yet                                 |
| `dispatching` | the request handler, immediately before calling Trigger.dev's `trigger()`, or the reconciler retrying a stale `created`/`dispatching` row | a dispatch attempt is or was in flight; not yet confirmed accepted |
| `dispatched`  | the request handler or the reconciler, only after Trigger.dev's `trigger()` returns a run ID; the row records that run ID                 | Trigger.dev has durably accepted the enqueue                       |
| `running`     | the Trigger.dev task, on start, after re-checking ownership                                                                               | the task is executing                                              |
| `succeeded`   | the Trigger.dev task, on completion; or the reconciler, mirroring Trigger.dev's own reported terminal status for the stored run ID        | terminal                                                           |
| `failed`      | the Trigger.dev task's failure handler; or the reconciler, mirroring Trigger.dev's own reported terminal status for the stored run ID     | terminal                                                           |
| `cancelled`   | an explicit user or admin action                                                                                                          | terminal                                                           |

Every `trigger()` call — from the request handler or the reconciler — passes the job row's own ID as the Trigger.dev `idempotencyKey`. That is what makes a second dispatch attempt safe: Trigger.dev returns the existing run instead of starting a duplicate one. Payloads still carry internal IDs only (adr/0001) — the idempotency key is one of those IDs, not new information.

Recovery at each crash point:

- **Before the row commits.** Nothing durable exists. The client sees the request fail; retrying is safe because the import's idempotency key (#7) is derived server-side from the object and dataset, not client-minted.
- **After `created` commits, before `dispatching`/`trigger()`.** The row is stuck at `created`. The reconciler finds `created` or `dispatching` rows older than a short grace period (long enough to not race the request handler's own in-flight attempt — 2 minutes), calls `trigger()` with the idempotency key, records the returned run ID, and advances the row to `dispatched`.
- **After Trigger.dev accepts the enqueue, before the `dispatched` update commits.** The row still shows `dispatching`. The reconciler's retry is a no-op in effect: the idempotency key returns the existing run, and the row is corrected to `dispatched` with that run's ID.
- **During `running`.** Trigger.dev's own retry re-runs the task (jobs/CLAUDE.md "Retries"); on each attempt the task re-checks ownership and state, and `import.load`'s `TRUNCATE`-before-load (#16) makes the retry converge rather than duplicate. Trigger.dev owns execution (adr/0001), so the reconciler does not touch a `running` row on its own timer.
- **A `dispatched` or `running` row with no local terminal update for longer than expected.** The reconciler never infers failure from elapsed time — a task legitimately spans multiple Trigger.dev retry attempts, so a clock-based cutoff would clobber a run still in progress. Instead it fetches the run by the row's stored run ID through Trigger.dev's API and mirrors whatever status Trigger.dev reports: `succeeded`, `failed`, or `cancelled` copy across as terminal states; a run Trigger.dev still shows as queued or executing leaves the row untouched.

---

## Query concurrency

**18. The advisory-lock key uses the two-argument `int4, int4` form, not a single 32-bit key.**
Decision 05 §(c)'s `orgLockKey` hashes the Organization ID down to a 32-bit signed integer and XORs in the slot number (1–5) to get the single `bigint` key `pg_try_advisory_xact_lock` takes. The defect is the truncation: only 32 of the 64 bits Postgres's advisory-lock space offers are ever in play, so unrelated Organizations collide far more often than a lock keyed on the full 64 bits would. That contradicts the "5 per Organization" guarantee decision 05 §(c) exists to state.

Fix: call `pg_try_advisory_xact_lock(key1 int4, key2 int4)` instead of the single-`bigint` form. Derive `key1` from the first 4 bytes of `sha256(organizationId)` and `key2` from the next 4 bytes XORed with the slot number — the full 64 bits of hash output are in play instead of 32, so two unrelated Organizations now collide only if both independently-derived 32-bit halves collide, at a negligible rate for any realistic Organization count. This costs nothing to adopt: same primitive (`pg_try_advisory_xact_lock`), same hash already computed by `sha256`, no new table, no new dependency — only splitting one hash into two arguments instead of truncating it into one. Decision 05 §(c)'s `orgLockKey` and its `acquireExecutionSlot` call site follow this item.

---

## Tenancy — role vocabulary and membership invariants

**19. Better Auth's organization plugin is configured with Datalize's own four roles — owner/admin/editor/viewer — not mapped from a coarse column.**
`src/modules/auth/policy.ts` already ships `ROLE_PERMISSIONS` keyed on exactly the four roles in #13's matrix. Building a fifth, coarser `member` role and a translation layer in front of it would contradict work already built; the fix runs the other direction — configure Better Auth's organization plugin with the four roles as its own role vocabulary (`organization({ roles: { owner, admin, editor, viewer } })` in `src/modules/auth/auth.ts`), so Better Auth's membership API — invite, accept, update-role, remove-member — accepts and returns exactly the values `policy.ts` already understands. No mapping module is needed once the vocabularies match.

Default role for a new member is `viewer`. `organization_members.role` (`src/db/schema/auth.ts`) must default to `"viewer"`, not `"member"` — `"member"` is not a value `Role` can represent and `ROLE_PERMISSIONS["member"]` is `undefined`; `viewer` is the least-privileged role, the correct default for a database-level safety net. This is distinct from the personal-Organization creator in #14, who Better Auth's `creatorRole` option assigns `"owner"` to (it already defaults to `"owner"` when unset: `node_modules/better-auth/dist/plugins/organization/routes/crud-org.mjs`, `role: ctx.context.orgOptions.creatorRole || "owner"`), matching the four-role set with no config change needed. Better Auth's invite endpoint requires an explicit `role` argument (`crud-invites.mjs`'s `role` field has no default) — Datalize's invite UI/API must always pass one of the four roles; there is no library-level fallback to rely on there.

Five membership invariants follow:

- **Unique `(organization_id, user_id)`.** `organization_members` (`src/db/schema/auth.ts`) currently has separate indexes on `organization_id` and on `user_id`, but no composite uniqueness constraint — nothing stops two rows for the same user in the same Organization. Add a `uniqueIndex` on `(organization_id, user_id)` and a matching migration.
- **The last owner cannot be removed or demoted.** Better Auth's organization plugin already enforces this natively, keyed on `creatorRole` (default `"owner"`, matching Datalize's role set once configured as above): leaving as the sole owner throws `YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`, and both the remove-member and update-member-role routes count remaining `creatorRole` holders before allowing the last one to be removed or demoted (`node_modules/better-auth/dist/plugins/organization/routes/crud-members.mjs`). Datalize does not need to duplicate this check — configuring `roles` correctly is what makes the built-in check apply to the right role.
- **Owner transfer is explicit.** There is no separate "transfer ownership" endpoint; a transfer is two explicit calls through the same update-member-role API Better Auth already exposes — promote the new owner to `owner`, then (optionally) demote the previous one — each independently gated by the last-owner check above. Nothing auto-promotes a replacement owner.
- **An invitation cannot be replayed after acceptance or expiry.** Better Auth's `acceptInvitation` already requires `status === "pending"` and `expiresAt` in the future, and transitions `status` to `"accepted"` on success (`crud-invites.mjs`), so a second accept call on the same invitation fails with `INVITATION_NOT_FOUND` rather than creating a second membership row. This is existing library behavior to rely on, not new Datalize logic to write.
- **A signup creates a personal Organization exactly once.** This step is Datalize's own signup hook, not something Better Auth does automatically — the hook must be idempotent per user (run once per created `users` row, not once per signup _request_), so a retried or duplicated signup call cannot create two personal Organizations for the same user.
