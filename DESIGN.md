# Design

<!-- impeccable:design-schema 1 -->

## World — The Drawing Sheet

A dimensioned engineering plate. The product's job is to make a number defensible; a drawing's
whole grammar exists to make a dimension defensible. Every convention maps onto product truth
already in the docs rather than being applied as a theme:

| Drawing convention        | Product truth it carries                                               |
| ------------------------- | ---------------------------------------------------------------------- |
| Title block               | Provenance: dataset, version, timezone applied, rows checked, bad rows |
| Revision table + triangle | Dataset Versions — immutable, numbered, superseded not deleted         |
| Revision cloud            | The columns that changed between versions (Column ID continuity)       |
| Leader line + dimension   | A figure annotated with how it was derived                             |
| Tolerance note            | Query limits and refusals (decisions/05)                               |
| "Checked by"              | Rows read / rows refused, stated at the moment of import               |

Selected by seed `f66e3e5d`, assigned index 4 of seven grounded directions, mode Operate.
Raises carried in from declined challengers, each named:

- **Cross-check** (night instrument six-pack): every figure shows a corroborating second reading —
  a row count beside a sum, a version beside a chart.
- **Material state** (one-bit desktop): states change line weight, hatch, or ghosting — never
  colour alone.
- **Ruling axis** (mesophotic dive): one provenance rule at a fixed left x-position on every
  screen, so lineage is always read in the same place.
- **Persistent history** (club sleeve): superseded versions stay on the page struck through, never
  removed.

Competitive alternate, not built: **The Force Network** (tensegrity) — held product clarity, lost
audience identification.

## Palette

The plotted CAD sheet, not blueprint and not warm paper: a cool near-white stock, graphite line
work, and **redline** as the only accent — the actual convention for revision marks and redlining.
Boldness is spent there and nowhere else.

```
--sheet          #FCFCFD   plot stock
--desk           #EDEFF2   ground beneath the sheet
--graphite       #1B1D21   line work and body text
--graphite-2     #5C636E   annotation, secondary
--hairline       #C4CAD3   drawn rules
--hairline-faint #E4E8ED   construction grid
--redline        #C8102E   revision, refusal, the one accent
--caution        #A85B00   warnings that are not refusals
--checked        #1F6B3B   verified marks only
```

Dark is the negative print: `--sheet #14171A`, `--desk #0B0D0F`, `--graphite #E8EAED`,
`--hairline #333A42`, `--redline #FF5C72`. Light is the default because the use scene is a desk in
daytime with a spreadsheet open alongside.

Chart colour never carries meaning alone (PRODUCT.md accessibility): a series is distinguished by
hatch as well as hue.

## Type

Binding from commit a00576d, all tabular-by-default:

- **Newsreader** — plate titles only, sparingly.
- **Familjen Grotesk** — UI and prose. Prose sets `proportional-nums`.
- **Sometype Mono** — every identifier, dimension, figure and annotation. Legitimate here as
  data and measurement, not as a costume for "technical".

## Components

shadcn/ui in `src/components/ui/`, restyled to the world rather than left at defaults: hairline
borders at 1px in `--hairline`, radius reduced to 2px (a drawing has no soft corners), no
elevation shadows — separation is carried by rule weight and ground, as on a plate.

Bans specific to this world: no card grid as page structure, no hero-metric tile, no eyebrow
above a heading, no gradient, no glass. Icons are authored SVG in one 1.25px stroke, drawn in
drafting grammar (arrowhead, leader, section arrow, revision triangle).
