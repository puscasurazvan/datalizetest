# src/app

Route layer only. No domain logic — call a module service and shape its result for the UI.

## Entry points

- **Server Components** — authenticated reads and page composition.
- **Server Actions** — UI-triggered mutations (create/update/delete from a form or button).
- **Route Handler at `api/queries/execute`** — the one place interactive query execution runs, not
  a Server Action. Server Actions dispatched from the client are serialised per client; query
  execution needs per-widget parallel requests and the ability to cancel one without blocking
  others, which only a Route Handler gives you. (docs/README.md, decisions/05)
- **Route Handlers elsewhere** — only for external HTTP boundaries: auth callbacks, upload presign,
  webhooks. Not a general alternative to Server Actions.

## The chain

Every entry point runs the same sequence — do not skip or reorder a step:

```
authenticate → resolve organization → validate (Zod) → authorize → call service → return safe DTO
```

(docs/reference/Datalize-improved-architecture.md "Security Baseline")

## Boundaries

- Never import from `src/db/**` directly. Always go through a module service in `src/modules/*`.
- The returned DTO is the module's, not a Drizzle row or physical table/column name (docs/adr/0002).

## Copy

UI copy says **"workspace"**, never "organization" (CONTEXT.md).
