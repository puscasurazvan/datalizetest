# src/modules/jobs

## Interface (adr/0001)

- `JobDispatcher` interface with two implementations: `TriggerDevDispatcher`
  for real runtimes and `InlineDispatcher` for tests and CI, which runs the
  task function in process.

## No polling worker (adr/0001, docs/decisions/01 #2)

- Trigger.dev is the job runtime from the first asynchronous import — there
  is no polling worker, because Vercel has no long-lived process.

## Ordering (adr/0001, docs/decisions/06 #17)

- The durable job record is persisted in PostgreSQL BEFORE dispatch. This
  guarantees only that no Trigger.dev run is ever dispatched without a
  matching committed row — it does NOT guarantee the converse. A crash
  between the row commit and Trigger.dev accepting the enqueue leaves a
  committed row with no dispatched run.
- A **reconciler** (a scheduled Trigger.dev sweep, not a polling worker)
  closes that gap: it finds rows stuck before `dispatched`, calls
  `trigger()` again using the job row's own ID as the `idempotencyKey`, and
  advances the row — the idempotency key makes the retry converge on the
  original run instead of duplicating it.
- PostgreSQL owns job metadata, status, and progress; Trigger.dev owns
  execution and retries (adr/0001).

## Payloads and re-checks (adr/0001, docs/reference/Datalize-architecture-review.md)

- Payloads carry internal IDs only — never a file, never a presigned URL,
  never a credential.
- Every task re-checks organization ownership and state at execution time;
  never trust the payload's snapshot of either.

## Task config

- Tasks set an explicit `maxDuration` and machine preset — no task runs on
  an unbounded or default allocation.

## Retries (docs/reference/Datalize-architecture-review.md)

- Retries must be safe at batch boundaries: a retried task re-running a
  partially completed batch must converge, not duplicate or corrupt state.
