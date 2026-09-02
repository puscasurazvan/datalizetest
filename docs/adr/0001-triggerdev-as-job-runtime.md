# Trigger.dev is the job runtime, from the first asynchronous import

Datalize deploys to Vercel, where there are no long-lived processes and functions have a hard duration ceiling — a CSV import of up to 50 MB / 1M rows will not fit inside a request. We use Trigger.dev for every asynchronous job starting with the first CSV import, rather than the "database-backed polling worker first, job platform later" path proposed in `Datalize-improved-architecture.md`.

**Considered and rejected:** a polling worker inside the Next.js app. It has no home on Vercel, and adopting a job platform afterwards would mean rewriting the import pipeline mid-MVP — the most expensive moment to do it.

**Consequences:** PostgreSQL still owns job metadata, status, progress, and idempotency; Trigger.dev owns execution and retries. Job payloads carry internal IDs only, and every job re-checks organization ownership at execution time. If hosting ever moves to a platform with long-lived processes (Railway, Fly, Render), revisit this deliberately rather than by drift.

Persisting the job row before dispatch guarantees only that no run happens without a durable row — not the converse. A crash between committing the row and Trigger.dev accepting the enqueue leaves a committed row that was never dispatched. docs/decisions/06 #17 defines the job state machine and a reconciler that detects rows stuck before `dispatched` and re-dispatches them, using the job row's own ID as Trigger.dev's `idempotencyKey` so a re-dispatch converges on the original run instead of duplicating it.
