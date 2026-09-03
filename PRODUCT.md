# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js 16 (App Router) + React 19 + Tailwind v4 on Vercel; Postgres for both the application
database and the analytical store; Better Auth; Trigger.dev. Tooling is oxc only — oxlint and
oxfmt, no ESLint or Prettier.

**Component library: shadcn/ui on Base UI.** shadcn changed its default primitive from Radix to
Base UI on 2026-07-03; this project was a fresh install, so it took that default
(`shadcn init -b base`, recorded in `components.json` as style `base-nova`). Radix remains
available via `-b radix` and is not deprecated upstream.

Two conflicts this created with existing binding rules, both resolved rather than left to drift:

- **Charts are Recharts, not ECharts.** shadcn's own `chart` component was _not_ adopted: it lives
  in `components/ui`, which would export Recharts-typed props app-wide and break the boundary
  `docs/adr/0002` sets, and its implementation carries nine type assertions against CLAUDE.md's
  "No casts". The adapter lives in `src/modules/visualizations/bar-chart.tsx` instead, cast-free,
  with Recharts imported nowhere else.
- **CVA variant props** are shadcn's convention and win inside `src/components/ui/`. The
  no-boolean-proliferation rule in `src/components/CLAUDE.md` still governs every domain component
  above that directory.

Two select primitives are kept on purpose: shadcn's composed `Select` for short app-shaped choices,
and `NativeSelect` for long lists that must submit themselves — the 313-zone timezone field needs
OS type-ahead, the platform picker on mobile, and a real form value under a Server Action.

## Users

Primary: an **ops/finance analyst at a 5–30 person SaaS company** (docs/decisions/01). They
export CSV from Stripe, Paddle, HubSpot, or an internal tool, and need a chart or a number they
can defend in a meeting. They do not write SQL and have no analyst team to ask.

Their situation: a recurring monthly reporting job. The same export, the same questions, every
month. They currently do this in a spreadsheet and do not trust the result.

## Product Purpose

Upload a CSV, get trustworthy charts and dashboards without writing SQL.

"Trustworthy" is the product, not a qualifier: every number on screen must be explainable after
the fact. An Execution records which Dataset Version it read and which timezone it grouped by.
Success is the analyst re-running last month's report against this month's upload and believing
the result.

## Positioning

Most self-serve BI either demands SQL or hides its arithmetic. Datalize does neither: queries are
structured (never raw SQL, from a user or a model), and the interpretation applied to the data is
stated on screen at the moment it is applied — which timezone a naive timestamp was read in, which
Dataset Version a chart resolved to, which rows failed to parse and why.

## Operating Context

The monthly loop: export CSV → upload → confirm the inferred schema → build a query → chart it →
put it on a dashboard → return next month and re-run it against fresh data.

Files are 50 MB / 1M rows / 100 columns at the MVP ceiling. The analyst works alone or in a small
workspace with 2–5 colleagues. Sessions are desktop, in a browser, usually with the source
spreadsheet open beside it.

## Capabilities and Constraints

Vocabulary is binding and defined in `CONTEXT.md`: Organization (code) / **workspace** (all UI
copy), Dataset, Dataset Version, Column ID, Saved Query, Import, Execution. There is no
`Workspace` type; do not introduce a third name.

Confirmed constraints that shape the interface:

- **Dataset Versions are immutable.** Rows are never edited or annotated after import.
- **A saved query resolves to the Dataset's current version at execution time** (ADR 0003). A
  removed or retyped column therefore fails with a structured `SCHEMA_INCOMPATIBLE` error naming
  the column, rendered as a widget error state — _never a blank chart, never a silently dropped
  filter._
- **Naive CSV timestamps are read in the workspace's timezone** (ADR 0004). The import preview
  MUST state which timezone it applied and let the user override it before the import commits.
- **Mixed-currency aggregates are refused, not summed** (decisions/01). The UI must not label a
  filtered `SUM(amount)` as MRR.
- **Three hard query limits** (decisions/05) with safe user-facing errors: statement timeout,
  concurrency, result size.
- **Imports record rows they could not parse** and are idempotent — the same upload twice does not
  produce two versions.
- Errors reaching the client carry no physical table name, raw row value, credential, or stack.
- Slice 1 ships **table and bar only**. KPI, line, and area come in Slice 2, after the adapter
  contract is tested. Do not design chart types ahead of scope.

## Brand Commitments

The type system is researched and binding (commit a00576d): **Familjen Grotesk** (text),
**Newsreader** (display), **Sometype Mono** (identifiers). All three are tabular-by-default —
chosen because most pixels in this product are numbers in columns, and a column must not shimmer
when a value updates. Familjen was selected partly because it draws `l`, `I` and `1` as three
distinct shapes, since analysts read customer IDs. Running prose opts out with
`proportional-nums`; tables and charts stay tabular.

Existing tokens in `src/app/globals.css`: 11 colors, light and dark, neutral greys with one blue
focus ring and one red danger.

## Evidence on Hand

Three committed, seeded CSV fixtures at `tests/fixtures/` — 1,000 rows each, deliberately dirty:

- `transactions_stripe.csv` — id, customer_id, customer_name, amount, currency, status,
  created_at (explicit-offset ISO), plan_name, country. 600 succeeded / 209 refunded / 191 failed;
  USD 349 / EUR 328 / GBP 323; plan_name blank on 157 rows.
- `customers_saaS.csv` — naive `YYYY-MM-DD HH:MM:SS` timestamps, empty `canceled_at` on active rows.
- `events_product.csv` — mixed naive and offset-bearing timestamps in one column, embedded JSON,
  empty session_id.

Real computed aggregate available for chart work (USD, succeeded, by month): 20 months from
2025-01 to 2026-08, ranging 11,926.28 to 49,548.95.

No customers, testimonials, pricing, benchmarks, or press exist. Do not fabricate them.

## Product Principles

1. **State the interpretation where it is applied.** A timezone, a version, a refusal — on screen,
   at the moment it matters, not in a settings page or a tooltip.
2. **Break visibly rather than degrade silently.** A named error beats a blank chart; a rejected
   stale save beats a silent overwrite.
3. **The number is the interface.** Most pixels are figures in columns; typography, alignment, and
   density serve reading them accurately.
4. **Structure over syntax.** The analyst composes questions, never SQL — and the same constraint
   is what later makes AI assistance safe.
5. **Nothing ahead of its slice.** Scope is staged deliberately; designing Slice 3 chrome into a
   Slice 1 screen is a defect.

## Accessibility & Inclusion

Real semantic elements, visible focus, keyboard operable, correct in light and dark
(`src/components/CLAUDE.md`). Chart color must not be the only channel carrying meaning — an
analyst reading a categorical series needs a second cue.
