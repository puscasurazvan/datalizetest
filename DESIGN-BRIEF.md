# Datalize — Design Brief

A self-contained prompt for a design tool (Figma AI, v0, Lovable, Subframe, Claude Design).
Paste the whole file. Everything below is true of the real product — no aspirational features.

---

## 1. What this product is

**Datalize turns a CSV an ops analyst already has into a chart they can defend in a meeting.**

Upload a CSV → the app infers each column's type → the analyst confirms or overrides → the rows
land in an immutable versioned table → the analyst composes a structured question (never SQL) →
gets a table or bar chart → pins it to a dashboard → returns next month and re-runs it against a
fresh upload.

"Trustworthy" is the product, not an adjective. Every number on screen must be traceable: which
version it read, which timezone it grouped by, which rows it refused. The interface exists to make
that visible.

## 2. Who uses it

An **ops/finance analyst at a 5–30 person SaaS company**. They export CSV from Stripe, Paddle,
HubSpot, or an internal tool. They do not write SQL. They have no data team to ask. They are
personally accountable for the number being right when it reaches the CFO.

**Their scene:** month-end. Desktop browser, source spreadsheet open in the next window, a Slack
message waiting that says "can you send me the number." Sessions are 10–40 minutes, repeated
monthly. Not a daily-dashboard-watcher — a person doing a recurring, high-stakes reporting job.

**Design consequence:** scanability and accuracy beat delight. Most pixels are figures in columns.
This is an _operate_ surface, not a marketing one — but it should not look like generic admin
software, because the whole product claim is rigor.

## 3. Vocabulary (use these words exactly)

| Term                | Means                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace**       | The tenant boundary. All UI copy says "workspace." (Code says Organization — never show that word to a user.)                          |
| **Dataset**         | A named body of tabular data. Has identity and a display name; holds no rows itself.                                                   |
| **Dataset Version** | One immutable import result — its rows, columns, and inferred schema. Never edited after import.                                       |
| **Column ID**       | The opaque server-generated identity of a column, stable across versions. A column keeps its ID only if name _and_ type are unchanged. |
| **Saved Query**     | A stored structured question. References the Dataset, not a version — resolves to the current version at run time.                     |
| **Import**          | One attempt to load a file. Records rows it could not parse. Idempotent — same upload twice makes one version.                         |
| **Execution**       | One run of a query. Records which version it read and which timezone it grouped by.                                                    |

Never invent a third name. There is no "project," "report," or "table" in the domain vocabulary.

## 4. Screens to design

### 4.1 Sign in / Sign up

Email + password, plus optional Google and GitHub buttons. Should demonstrate the product in the
first viewport rather than only gating it — a real chart specimen beside the form works well.

### 4.2 Datasets index

List of Datasets: name, row count, current version, last import date, who imported it.
**Empty state** is important — a new workspace has nothing, and the empty state should explain the
four-step import (upload → infer → confirm → version 1) rather than showing a dashed box.

### 4.3 Upload

Drag-and-drop or file picker. **CSV only, 50 MB maximum.** Show the ceiling before the user picks a
file, not after it fails. Upload goes directly to object storage with a progress indicator.

### 4.4 Import — schema confirmation ★ the most important screen

After parsing, before anything is stored, the analyst sees:

- Every column: position, name, **inferred type**, null count, unparseable count, a sample value.
- Types are: `text`, `integer`, `decimal`, `boolean`, `date`, `timestamptz`.
- **A type override control per column.**
- **A prominent statement of which timezone naive timestamps will be read in**, with an override.
  This is non-negotiable: a CSV timestamp like `2025-04-17 06:53:03` has no offset, so the app
  reads it as wall-clock time in the workspace timezone. Getting this wrong moves month-end revenue
  by up to 13 hours. The screen must say which timezone it is applying, at the moment it applies it.
- Row counts: read / refused / bad field count.
- Two actions: change types, or commit the version.

### 4.5 Query builder ★ the product's thesis

The analyst composes a structured question. **There is no SQL input anywhere, ever.** Controls:

- **Group by** — a column, and for date columns a granularity (day / week / month / quarter / year).
  Week is ISO, Monday-start.
- **Measure** — `sum`, `count`, `avg`, `min`, `max` over a column; `count(*)` for count-all.
- **Filters** — a nested and/or tree of `column operator value` rules.
- **Sort** and an optional row limit.
- **Run.**

Columns are picked by name but carry an opaque Column ID underneath. The builder must handle a wide
dataset (up to 100 columns) — a searchable column picker, not a long dropdown.

### 4.6 Result

Two visualizations only: **table** and **bar chart**. (KPI, line, and area come later — do not design
them.) The result must show:

- The figures, right-aligned, tabular.
- A footer stating the granularity and the timezone: "Grouped by month (Europe/Paris)".
- Which Dataset Version it resolved to, and the execution time.
- A truncation banner when the 10,000-row cap cut the result.
- Bar charts cap at the top 50 categories with a "showing top 50 of N" note.

### 4.7 Dataset detail / version history

Version list, newest first. For each version: row count, import date, and **what changed** — columns
carried forward, columns added, columns retyped, columns removed. Superseded versions stay visible;
they are never deleted. Removed and retyped columns are what break saved queries, so this screen
must make that consequence legible.

### 4.8 Dashboard

A bounded 12-column grid with **preset widget sizes** — no free-form resize. Keyboard-operable
reorder. Explicit save status. Each widget shows its own provenance (which version, which timezone)
and can fail independently with a named error.

### 4.9 Workspace settings

Workspace name, timezone (313 canonical IANA zones — needs a searchable picker, not a plain
dropdown), and member management with roles: owner, admin, member, viewer.

## 5. States every screen needs

`loading` · `empty` · `error` · `data`, in both light and dark, responsive, reduced-motion-safe.

### The refusals — design these as first-class screens, not afterthoughts

These are the states the product is judged on. Each names the problem **and** the recovery. None may
show a database table name, a raw row value, a credential, or a stack trace.

| Situation                                     | What the user sees                                                                                                                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Query exceeded 30 seconds                     | "This query took longer than 30 seconds. It was stopped so the workspace stays responsive. Narrow the date range or add a filter."                                                                                    |
| Three queries already running                 | "Queued — it will start as soon as a slot frees. Nothing is lost."                                                                                                                                                    |
| A saved query's column was removed or retyped | Names the column: "This chart grouped by `plan_name`. Version 2 does not contain that column." Offer a replacement column or reverting the current version. **Never a blank chart. Never a silently dropped filter.** |
| Mixed currencies in one sum                   | Refuse the aggregate. Require a currency filter first. A filtered `SUM(amount)` is **not** MRR and must never be labelled so.                                                                                         |
| Result hit the 10,000-row cap                 | "Truncated to 10,000 rows. Refine your query."                                                                                                                                                                        |
| Stale dashboard save                          | Reject visibly. A newer revision must never be silently overwritten.                                                                                                                                                  |
| Rows that would not parse                     | Show the count and let the user inspect them. The import still succeeds.                                                                                                                                              |

## 6. Hard constraints that shape the UI

- **50 MB / 1,000,000 rows / 100 columns** per upload.
- **10,000 rows maximum** returned to the UI — so result tables need virtualization, not pagination
  through millions.
- **30-second query timeout**, 3 concurrent queries per workspace.
- Dataset Versions are **immutable**. There is no edit-a-cell interaction anywhere.
- A Saved Query resolves to the **current** version at run time, so data can change under a chart.
- Everything is scoped to one workspace.

## 7. Visual system (current — replace or extend deliberately)

**Concept: a dimensioned engineering drawing.** A technical plate exists to make a dimension
defensible, which is the same job this product has. Conventions in use:

- **Title block** at the foot of every sheet: dataset, version, timezone applied, rows checked.
- **Revision markers** (△1, △2) for Dataset Versions; superseded ones stay, struck through.
- **Redline** for revisions, refusals, and the emphasized value — the only accent colour.
- **Provenance rail** at a fixed left position on every screen, so lineage is always in one place.
- Separation by **hairline rule**, never drop shadow. 2px corner radius. No elevation.

### Colour

```
Light                          Dark
--sheet     #FCFCFD            #15181C   plot stock, card surface
--desk      #EDEFF2            #0B0D0F   page ground behind sheets
--graphite  #1B1D21            #E9EBEE   line work and body text
--graphite2 #5C636E            #9AA2AD   secondary text
--hairline  #C4CAD3            #333A42   rules and borders
--redline   #C8102E            #FF6178   revision, refusal, emphasis
--caution   #A85B00            #E0A050   an interpretation to accept or override
--checked   #1F6B3B            #6BBF8C   a verified count
```

Chart series are a graphite ramp, not a hue wheel — **colour must never be the only channel
carrying meaning**; distinguish series by position and hatch too.

### Type

- **Newsreader** (serif) — page titles only, sparingly.
- **Familjen Grotesk** — UI and prose.
- **Sometype Mono** — every identifier, figure, dimension, and annotation.

All three are **tabular by default** — chosen because most pixels are numbers in columns and a
column must not shimmer when a value updates. Familjen draws `l`, `I` and `1` as three distinct
shapes, which matters because analysts read customer IDs. Running prose opts out with
proportional figures; tables and charts stay tabular.

### Accessibility

Real semantic elements, visible focus, keyboard operable, correct in light and dark, body text at
4.5:1 minimum.

## 8. Real data to design with

Use these — they are the actual seeded fixtures, deliberately messy.

**`transactions_stripe.csv`** — 1,000 rows.
`id, customer_id, customer_name, amount, currency, status, created_at, plan_name, country`
Sample: `tx0000001, c000300, Mia Chen, 4263.07, EUR, succeeded, 2025-11-17T04:02:18Z, pro, AU`
Distribution: 600 succeeded / 209 refunded / 191 failed · USD 349, EUR 328, GBP 323 ·
`plan_name` empty on 157 rows.

**`customers_saaS.csv`** — 1,000 rows, **naive timestamps** (`2025-04-17 06:53:03`, no offset).
`id, name, email, plan, status, created_at, canceled_at, mrr, country` · `canceled_at` empty on
active rows.

**`events_product.csv`** — 1,000 rows, **mixed timestamp shapes in one column** (some with `Z`, some
naive), embedded JSON, empty session IDs.

**A real aggregate** — `SUM(amount)` by month, USD, succeeded, 20 months:

```
2025-01  39,889.53 (13)   2025-07  39,503.14 (16)   2026-01  33,158.33 (13)   2026-07  21,551.07 (9)
2025-02  25,792.32 (13)   2025-08  13,110.32 (4)    2026-02  18,860.98 (7)    2026-08  49,548.95 (17)
2025-03  36,022.85 (12)   2025-09  32,205.66 (12)   2026-03  47,431.77 (15)
2025-04  29,159.75 (9)    2025-10  35,428.44 (11)   2026-04  26,161.12 (10)
2025-05  17,248.86 (12)   2025-11  29,783.12 (11)   2026-05  27,902.14 (11)
2025-06  24,234.46 (9)    2025-12  13,417.94 (7)    2026-06  11,926.28 (5)
```

Never invent customers, testimonials, pricing, or benchmarks — none exist.

## 9. Principles to design against

1. **State the interpretation where it is applied.** A timezone, a version, a refusal — on screen at
   the moment it matters, never buried in settings.
2. **Break visibly rather than degrade silently.** A named error beats a blank chart; a rejected
   stale save beats a silent overwrite.
3. **The number is the interface.** Typography, alignment, and density serve reading figures
   accurately.
4. **Structure over syntax.** The analyst composes questions, never SQL.
5. **Every figure carries a corroborating second reading** — a row count beside a sum, a version
   beside a chart. A number is never alone on the page.

## 10. Do not design

KPI / line / area / pie charts · global cross-widget filters · exports and scheduled reports ·
public sharing · billing · API keys · free-form widget resize · any AI feature · cell editing ·
joins across datasets · calculated fields.

These are either later scope or deliberately excluded. Designing them now is a defect.

---

**Stack, for reference:** Next.js 16 · React 19 · Tailwind v4 · shadcn/ui on Base UI ·
TanStack Table · Recharts · Postgres.
