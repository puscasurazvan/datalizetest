# src/shared

Cross-cutting infrastructure only, used by every module. No domain logic — a rule about Datasets,
Organizations, Queries, etc. belongs to that module, not here.

## Belongs here

Request context, error types/DTOs, `env.ts`, Zod validation helpers, observability (logging,
Sentry), cross-cutting shared types.

## Does not belong here

Any domain logic. If it's specific to one module's concept, move it to that module.

## env.ts

`src/shared/env.ts` is the only place `process.env` is read. Everything else calls `env()`.

## Request context

A request context is the **only** way to obtain an organization scope, and the scope always comes
from an authoritative server-side source with the membership row re-verified — never from a value a
caller or model chose. (docs/README.md, docs/reference/Datalize-architecture-review.md)

`createRequestContext()` is the constructor for anything inside a real request: it takes no
arguments, reads the session from the ambient request headers, and re-verifies membership.
**Use it everywhere.**

There is exactly one other constructor, and it is not a general-purpose escape hatch:

|                  | `createRequestContext()`                          | `createRequestContextForJob({ userId, organizationId })`                                                    |
| ---------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| For              | Server Components, Server Actions, Route Handlers | A job worker run — Trigger.dev, and `InlineDispatcher`'s in-process equivalent                              |
| Scope comes from | the session's `activeOrganizationId`              | the `imports` row the job's payload names                                                                   |
| Callers          | anywhere                                          | `src/modules/imports/internal/job-context.ts` only, enforced by `no-restricted-imports` in `.oxlintrc.json` |

A job run is not a request: it has no headers, so `createRequestContext()` cannot be called from one
at all. `createRequestContextForJob` exists for that, and taking an `organizationId` does not
reopen what this rule guards against — its one caller reads that value off the `imports` row itself
(a row a fully authorized request already wrote), never from the job payload, and the function
re-verifies membership at run time exactly as `createRequestContext` does. It can confirm or refuse
access a prior request already established; it can widen none.

Adding a third constructor, or a second caller of this one, needs a decision document — not a
judgement call at the keyboard.

## Error DTOs

Error DTOs returned to the client must never carry: a physical table name, a raw dataset/row value,
a credential, or a stack trace. (docs/adr/0002, docs/reference/Datalize-improved-architecture.md
"Security Baseline", docs/reference/Datalize.md "Error States")

## Observability

The Sentry scrubber drops raw row data before anything is sent.
(docs/reference/Datalize-improved-architecture.md "Never include raw dataset rows... in logs,
errors, analytics, or traces.")
