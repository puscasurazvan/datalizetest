# Design

<!-- impeccable:design-schema 1 -->

Datalize is one dark instrument surface, read at a desk at month-end. Its job is to make a
number defensible, so the interface's whole grammar exists to show where a figure came from.
Figures are the only luminous thing on the page; everything else is ground, rule and label.

This document describes the design that shipped, as built in `stitch/*.html` and rendered in
`stitch/*.jpg`. Those files are the reference. When this document and a mock disagree, read the
mock's markup — it is what produced the approved screenshots.

## Product truths the surface carries

| Convention                     | Product truth it carries                                               |
| ------------------------------ | ---------------------------------------------------------------------- |
| Fixed header + fixed left rail | Workspace, timezone applied, active Dataset and Version — always there |
| Version marks                  | Dataset Versions — immutable, numbered, superseded not deleted         |
| Column delta matrix            | The columns that changed between versions (Column ID continuity)       |
| Corroborating reading          | A row count beside a sum; a version beside a chart                     |
| Refusal card, not a blank pane | Query limits and refusals stated in full (decisions/05)                |
| Receipt strip                  | Rows read / rows refused / timezone, at the moment a result appears    |

Four standing raises:

- **Cross-check** — every figure shows a corroborating second reading.
- **Material state** — states change border, fill or icon, never colour alone. This is an
  accessibility requirement from `PRODUCT.md`, not a stylistic preference.
- **Ruling axis** — wherever a screen has lineage, the rail sits at one fixed left position, so
  lineage is always read in the same place.
- **Persistent history** — superseded versions stay on the page struck through, never removed.

## Palette

Neutral near-black grounds, darkest under the chrome. Cyan is spent on the action the reader is
about to take and nowhere else; the other accents are states the product already names.

```
--chrome          #0e0e10   header and rail, under the canvas
--canvas          #131315   page ground
--surface         #1c1b1d   card
--surface-raised  #201f22   panel nested in a card, popover, input
--surface-high    #2a2a2c   hover, active nav
--surface-highest #353437   icon chip, active pill, inset key
--surface-bright  #39393b   the brightest ground; use sparingly
--hairline        #3d494c4d  every drawn border  (outline at 30% — see below)
--hairline-strong #3d494c   input border, emphasised rule
--ink             #e5e1e4   body
--ink-muted       #bcc9cd   annotation, secondary
--ink-faint       #869397   mono labels, disabled
--cyan            #4cd7f6   accent text, gradient top, focus ring
--cyan-solid      #06b6d4   gradient bottom, solid fill   (--on-cyan #003640)
--verified        #4edea3   confirmed, passed, valid      (--verified-solid #00a572, --on-verified #00311f)
--refused         #ff7f8b   refusal, breakage, destructive
--refused-bright  #ffb2b7   refusal text on a dark wash   (--on-refused #7d0023)
--error           #ffb4ab   error text                    (--error-solid #93000a)
--caution         #f5b544   warnings that are not refusals
```

**Borders are translucent.** There is no solid mid-grey border anywhere in the reference — it
draws every rule as the outline colour at low alpha. `--hairline` therefore carries the alpha
itself, so a plain `border-hairline` is already correct; reach for `border-hairline-strong/40`
or `/20` when a rule needs to be heavier or lighter than the default.

There is no light theme. `<html>` carries `class="dark"` so shadcn's `dark:` utilities resolve;
`:root` holds the only palette.

Chart colour never carries meaning alone: the series ramp is neutral (`--chart-2` … `--chart-4`)
with cyan reserved for the emphasised series and rose for a refused one, and a series is
distinguished by position and label as well as hue.

## Spacing

One scale, declared in `globals.css` and used by name. Layout reaches for `p-space-lg` and
`gap-space-md`, never an ad-hoc `p-5` — the named step is what keeps rhythm consistent between
screens built by different hands.

```
space-2xs 0.125rem · space-xs 0.25rem · space-sm 0.5rem  · space-md 0.75rem
space-base 1rem    · space-lg 1.5rem  · space-xl 2rem    · space-2xl 3rem · space-3xl 4rem
gutter-desktop 1.5rem · gutter-mobile 1rem · page-max-width 80rem
```

Page gutters are `px-gutter-desktop`. Stacked top-level sections are `gap-space-xl`. Card
padding is `p-space-lg`; a panel nested in a card is `p-space-md` or `p-space-sm`.

## Type

**Geist** for everything the reader reads. **JetBrains Mono** for everything the reader
_checks_: Column IDs, timestamps, error codes, figures in a column, and every label set in caps.
Legitimate here as data and measurement, not as a costume for "technical".

Each step carries its own line-height, tracking and weight, so the step name is the whole
typographic decision:

```
headline-2xl  48/56  -0.03em   600      headline-xl  36/44  -0.025em  600
headline-lg   24/32  -0.02em   600      headline-md  20/28  -0.015em  500
headline-sm   16/24  -0.01em   500      body-lg      16/24  -0.005em  400
body-md       14/20   0        400      body-sm      13/18   0        400
label-md      12/16   0.01em   500      label-mono   11/14   0.04em   500  (mono)
code-md       13/18  -0.01em   400      code-sm      11/16   0.02em   500  (mono)
```

`headline-2xl-mobile` (32/40) and `headline-xl-mobile` (26/34) are the small-screen steps.

Page titles are the one place the mock overrides a step rather than using it: it writes
`text-headline-xl text-[34px] font-bold tracking-[-0.03em]` — a hair smaller than the step's 36px,
heavier than its 600, and tighter than its -0.025em. That exact combination is the page-title
treatment on every screen that has one; it is a port of the reference, not an ad-hoc value.

Both faces are tabular by default; running prose opts out with `proportional-nums`.

## Depth

Depth comes from ground, blur and translucent rule — not from a hard drop shadow under a box.

- **Card**: `rounded-2xl bg-surface/90 backdrop-blur-xl p-space-lg border border-hairline`.
  Hover raises the border to an accent (`hover:border-cyan/40`).
- **Glow blob**, the signature move: a blurred disc bleeding out of a card's corner —
  `absolute -right-8 -top-8 w-28 h-28 rounded-full bg-cyan/10 blur-2xl pointer-events-none`,
  brightening on `group-hover`. The card is `relative overflow-hidden group`.
- **Primary button**: `bg-gradient-to-b from-cyan to-cyan-solid text-on-cyan` with a cyan bloom
  `shadow-[0_0_24px_-4px_rgba(6,182,212,0.45)]`, `hover:shadow-[0_0_28px_rgba(76,215,246,0.55)]`,
  and `active:scale-95`. This gradient is the one sanctioned decorative gradient.
- **Secondary button**: `bg-surface-raised hover:bg-surface-high shadow-sm active:scale-95`.
- **Header**: `fixed top-0 inset-x-0 z-50 h-16 bg-chrome/80 backdrop-blur-xl`
  `shadow-[0_1px_12px_rgba(0,0,0,0.4)]`.
- **Left rail**: `fixed left-0 top-16 bottom-0 w-64 bg-chrome/90 backdrop-blur-xl z-40`
  `flex flex-col justify-between p-space-base shadow-[1px_0_12px_rgba(0,0,0,0.3)]`.
- **Main**: `pt-16 px-gutter-desktop pb-space-2xl bg-canvas`, offset left by the rail where the
  rail is shown; inner stack `flex flex-col gap-space-xl`.
- **Refusal surface**: `border-refused/40` + `shadow-[0_4px_32px_rgba(105,0,5,0.35)]` + a large
  `blur-3xl` wash blob, with an inset panel `bg-chrome/80 border-hairline shadow-inner`.
- **Status dot**: `w-2 h-2 rounded-full bg-verified animate-pulse` with a matching
  `shadow-[0_0_8px_rgba(78,222,163,0.6)]`.
- **Focus**: a cyan border plus `shadow-[0_0_0_3px_rgba(6,182,212,0.15)]`.

Radii: `rounded-2xl` for cards, `rounded-xl` for panels nested in them, `rounded-lg` for
controls, `rounded-full` for pills and status dots.

## Metric tile

A label row (`text-label-md text-ink-muted`) with a `p-space-2xs rounded-lg bg-surface-highest`
icon chip; then the figure at `text-[40px] font-bold tracking-tight`, tabular, beside a small
pill; then a footer row split off by `border-t border-hairline-strong/20` at `text-code-sm`.
Tiles sit in `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md`.

Every tile is tethered to what produced it. A hero number with no query behind it is not a
design decision, it is a claim the product cannot defend.

## Not built yet

The mocks show more than the product does. Those affordances still ship — at full geometry, in
the disabled treatment from `src/components/ui/pending.tsx` — so the design is whole and the
product stays honest.

- A **control or nav item** with no feature behind it renders inert: `PENDING_CLASS`,
  `aria-disabled="true"`, a `title` saying it is not available, and `tabIndex={-1}` if
  focusable. Never an `<a href>` to a route that does not exist — a dead link is worse than a
  disabled control. Prefer a real `<button disabled>` where the mock shows a button.
- A **readout** with no real value shows `NO_VALUE` (an em dash), never an invented figure. A
  progress bar with no real percentage renders at zero width.

Currently in this category: the Dashboard, Query Builder and Audit Vault nav items; the search /
Command-K button; the rail's Live Telemetry, Schema Defenses, Sync Pipelines and Compliance Logs
nav; the audit-integrity and SHA-256 readouts; latency and p99; the concurrency slot meter; the
data-perimeter and zero-drift figures; the plan badge; the refusals count; the confirm screen's
Refuse / Abandon button — `CANCELLED` exists in `dataset_version_status` and the load path honours
it, but nothing writes it yet.

Where a slot **can** be filled with something true, fill it: active workspace name, applied
timezone, Dataset count, Dataset Version number, row count, column count, import status, Column
ID, the signed-in user's email.

## Components

shadcn/ui in `src/components/ui/`, restyled to this world rather than left at defaults. Icons
are `lucide-react` at 1.5px stroke — the mocks use Material Symbols, so substitute the nearest
lucide equivalent; never add an icon font.

Standing bans: no colour as the sole carrier of a state; no chart where a refusal belongs; no
metric untethered from the query that produced it; no invented figure in a slot the product
cannot fill.
