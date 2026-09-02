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

The request context factory is the **only** way to obtain an organization scope. It must never
accept an `organizationId` argument — tenant context comes from the authenticated session/request,
not from a caller- or model-supplied value. (docs/README.md, docs/reference/Datalize-architecture-review.md)

## Error DTOs

Error DTOs returned to the client must never carry: a physical table name, a raw dataset/row value,
a credential, or a stack trace. (docs/adr/0002, docs/reference/Datalize-improved-architecture.md
"Security Baseline", docs/reference/Datalize.md "Error States")

## Observability

The Sentry scrubber drops raw row data before anything is sent.
(docs/reference/Datalize-improved-architecture.md "Never include raw dataset rows... in logs,
errors, analytics, or traces.")
