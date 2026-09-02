# Datalize — Agent Brief

Datalize is a self-serve analytics product: an ops/finance analyst uploads a CSV and gets trustworthy
charts and dashboards without writing SQL. It runs on Next.js on Vercel, with Postgres as both the
application database and (one table per Dataset Version) the analytical store.

## Doc precedence

Read `CONTEXT.md` (glossary) and `docs/README.md` (index) first. `docs/decisions/` and `docs/adr/` are
binding and win over `docs/reference/`, which is superseded wherever it disagrees with them.

## Glossary

`CONTEXT.md` is the glossary; use its terms exactly. Code, schema, and types say **Organization**
(`organizations`, `organization_id`, `Organization`). UI copy says **"workspace"**. There is no
`Workspace` type — don't invent a third name.

## Non-negotiable invariants

| Invariant                                                                                             | Set by                                                     |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Tenant context comes from a server-created request context, never an argument a caller/model supplies | docs/README.md                                             |
| Every tenant-owned row carries `organization_id`                                                      | docs/decisions/01                                          |
| Physical table/column names never leave the analytical store; columns are named only by Column ID     | docs/adr/0002                                              |
| Queries are structured `QueryAst`, never raw SQL from a user or model                                 | CONTEXT.md, docs/reference/Datalize-architecture-review.md |
| Analytical queries use the analytical connection pool only, with its own statement timeout            | docs/adr/0002, docs/decisions/05                           |

## Where to look

| Folder                          | Owns                                                                   |
| ------------------------------- | ---------------------------------------------------------------------- |
| `src/app/`                      | Route layer: Server Components, Server Actions, Route Handlers         |
| `src/db/`                       | Application schema, migrations, analytical pool client                 |
| `src/shared/`                   | Cross-cutting: request context, errors, env, validation, observability |
| `src/modules/auth/`             | Better Auth integration, session                                       |
| `src/modules/organizations/`    | Organization, membership, roles/permissions                            |
| `src/modules/datasets/`         | Dataset, Dataset Version, Column ID (logical model)                    |
| `src/modules/imports/`          | Import lifecycle, type inference, CSV loading                          |
| `src/modules/analytical-store/` | Physical tables, AnalyticalStore boundary                              |
| `src/modules/queries/`          | QueryAst, compiler, execution, limits                                  |
| `src/modules/visualizations/`   | Chart/widget adapters                                                  |
| `src/modules/storage/`          | Signed upload/object storage                                           |
| `src/modules/jobs/`             | Trigger.dev job dispatch and status                                    |

Each has its own `CLAUDE.md` — read it before working in that folder. Those files are agent rules and
are auto-loaded when you work in the folder; they are deliberately NOT `README.md`, because a README
would not reach you at the moment you edit the code it governs.

`README.md` files are for humans and carry no rules: the repo root explains how to run the project,
`docs/README.md` indexes the documentation, and `tests/fixtures/README.md` explains what each fixture
proves. When a rule and a README disagree, the rule wins.

## TypeScript

Fully strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`,
`noUnusedParameters`, `noImplicitReturns`, `allowJs: false`. Code must typecheck under these flags,
not merely under `strict`.

**No casts.** A cast is a claim the compiler cannot check, so it is where bugs hide. Forbidden, and
enforced by oxlint: `x as T`, `<T>x`, `as any`, `as unknown as T`, the non-null `!`, and
`@ts-ignore` / `@ts-expect-error` used to silence an error.

Do this instead:

| Instead of                       | Use                                                                        |
| -------------------------------- | -------------------------------------------------------------------------- |
| `JSON.parse(s) as Config`        | Parse with a Zod schema — validate at the boundary, once                   |
| `value as Dataset`               | A type guard or a discriminated union the compiler can narrow              |
| `arr[0]!`                        | Handle the `undefined` that `noUncheckedIndexedAccess` correctly gives you |
| `{...} as Props`                 | `satisfies Props`, or annotate the variable                                |
| `as any` to reach a library type | Read the library's types; if they are genuinely wrong, isolate it          |

`as const` is allowed — it narrows rather than asserts. The single exemption is the constructor of a
branded type, where the compiler cannot know the invariant holds; keep it to one function, comment
why, and never export the escape hatch.

## Model roles

| Role         | Model           | Applies to                                                                     |
| ------------ | --------------- | ------------------------------------------------------------------------------ |
| Orchestrator | Opus (latest)   | The main session: planning, workflow authoring, architecture, review judgement |
| Building     | Sonnet (latest) | Every subagent that writes or edits code                                       |
| Advisor      | Fable (latest)  | The `advisor` tool (host-configured; it takes no model parameter)              |

Pass `model: "sonnet"` explicitly on every `agent()` call in a workflow and every `Agent` launch that
writes code — including continuations and re-dispatches. Omitting it silently inherits the
orchestrator's model. Review and verification agents are judgement rather than building and stay on
the session model unless stated otherwise.

## Code readability

Readability is a requirement, not a preference. Code is read far more often than written, and a
reviewer should be able to hold a file in their head on one pass.

- One file, one job. A component or module past ~150 lines is telling you it does more than one thing.
- Flat over nested: early returns for loading, error, and empty states — never nested ternaries in JSX.
  No logic inside JSX; compute above the return and give it a name.
- Compose rather than configure. Accumulating boolean props (`isCompact`, `showHeader`) means the
  thing is really several things.
- Derive, do not synchronise. No effect that mirrors props into state.
- Name things with the vocabulary in `CONTEXT.md`.
- No abstraction for a single use, and no option nobody asked for.

`src/components/CLAUDE.md` carries the full component rules. They are reviewable: a change that makes
a file harder to follow is a defect, the same as a bug.

## Commands

`pnpm typecheck` · `pnpm test` · `pnpm test:integration` · `pnpm test:e2e` · `pnpm lint` ·
`pnpm format` · `pnpm db:generate` · `pnpm db:migrate`

Tooling is oxc only: **oxlint** is the sole linter (`.oxlintrc.json`) and **oxfmt** the sole
formatter (`.oxfmtrc.json`). ESLint and Prettier are deliberately absent — do not reintroduce
either, and do not add a second linter or formatter config.

Local Postgres is Docker only: `docker compose up -d`. Dev database on port 5433, throwaway
integration-test database on port 5434.
