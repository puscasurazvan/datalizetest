# Datalize documentation

```
CONTEXT.md            Domain glossary. The shared language. Read first.
docs/decisions/       Binding MVP decisions for Slice 0 and Slice 1.
docs/adr/             The four decisions that are expensive to reverse.
docs/reference/       Source material. Superseded where decisions disagree.
```

`docs/decisions/` and `docs/adr/` win over anything in `docs/reference/`.

## The review's "Decisions Required Before Implementation"

`docs/reference/Datalize-architecture-review.md` closes with eight decisions that had to be made before writing code. Where each one landed:

| #   | Decision                                           | Where it lives                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Analytical storage shape and limits                | [ADR 0002](adr/0002-one-postgres-table-per-dataset-version.md), [decisions/01](decisions/01-persona-hosting-and-vocabulary.md)                                                                                                                        |
| 2   | Dataset-version and saved-query semantics          | [ADR 0003](adr/0003-saved-queries-resolve-to-current-dataset-version.md), [decisions/02](decisions/02-dataset-versions.md)                                                                                                                            |
| 3   | Better Auth vs Datalize ownership of organizations | Better Auth owns users, organizations, members, invitations; Datalize services own all resource-level authorization. No second membership system. Role matrix and role vocabulary in [decisions/06](decisions/06-slice-1-implementation-defaults.md). |
| 4   | Job runtime                                        | [ADR 0001](adr/0001-triggerdev-as-job-runtime.md); persist-before-dispatch durability and the reconciler's job state machine in [decisions/06](decisions/06-slice-1-implementation-defaults.md)                                                       |
| 5   | Route boundary for query execution                 | Server Components read, Server Actions mutate, a protected Route Handler runs queries and polling — one service layer under both.                                                                                                                     |
| 6   | Dashboard conflict policy and editor scope         | Revision token on every save, stale saves rejected; one validated saved-query snapshot per widget; bounded grid with preset sizes.                                                                                                                    |
| 7   | AI provider, retention, redaction, budget          | **Open.** Slice 4. Deferred deliberately — nothing before it depends on the answer.                                                                                                                                                                   |
| 8   | Persona, sample datasets, success criteria         | [decisions/01](decisions/01-persona-hosting-and-vocabulary.md)                                                                                                                                                                                        |

Four further decisions were taken that the review did not list: timezone and date-granularity behaviour ([decisions/03](decisions/03-timezone-and-date-granularity.md)), datetime storage and naive-timestamp interpretation ([ADR 0004](adr/0004-naive-csv-timestamps-use-organization-timezone.md), [decisions/04](decisions/04-datetime-import-and-storage.md)), the three hard query limits ([decisions/05](decisions/05-query-limits.md)), and the Slice 1 implementation defaults — the role permission matrix, the three-pool database contract, the import job state machine and reconciler, the advisory-lock fix, and the benchmark gate ([decisions/06](decisions/06-slice-1-implementation-defaults.md)).

## Known-superseded snippets in reference material

`Datalize.md` describes production expansion — billing, API keys, public dashboards, scheduled reports, Redis — as MVP scope. It is a long-term product reference, not a build plan.

`Datalize-improved-architecture.md` is the architecture baseline, but predates the decisions above. Its `AnalyticalStore.getSchema(datasetId)` and `executeQuery({ organizationId, userId, query })` signatures are the unsafe shapes the review flagged: tenant context must come from a server-created request context, never from an argument a caller or model can supply.
