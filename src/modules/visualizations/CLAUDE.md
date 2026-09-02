# src/modules/visualizations

## Scope & encapsulation (docs/decisions/06 #12, docs/reference/Datalize.md §17)

- `VisualizationConfig` is a discriminated union. Slice 1 ships `table` and
  `bar` only — do not add other chart types ahead of scope.
- ECharts is imported ONLY inside this module, behind the
  `Query Result → Visualization Config → Chart Adapter → ECharts`
  pipeline. Its options types must never escape the module boundary.

## Validation

- Config is validated against the `QueryResult` before render — a config
  referencing a column or alias absent from the result is a render-time
  error state, never a crash.

## Required states (docs/reference/Datalize.md §17)

- Every chart handles `loading`, `empty`, `error`, and `data` states, in
  light and dark theme, responsive and reduced-motion, with an accessible
  text alternative to the visual.

## Footer (docs/decisions/03)

- States the granularity and the resolved organization timezone (e.g.
  "Grouped by month (UTC)"); week granularity also states the ISO
  Monday-start convention.

## Bar chart cap (docs/decisions/06 #12, docs/decisions/05 "Total Group Count and Ranking for Capped Displays")

- Bar charts cap at the top 50 categories with an explicit
  "showing top 50 of N" note — an unbounded `GROUP BY` can legitimately
  return thousands. N is the query result's `rowCount`; when `truncated`
  is true (10,000+ groups), show "10,000+", never a fabricated number.
- The first 50 rows are only legitimately "top" when the query's order is
  the charted measure descending — the compiler's default order when
  `orderBy` is empty, or an explicit `orderBy` naming that same measure.
  Any other explicit `orderBy` may still show the first 50 rows but must
  not call them "top."
- The query behind a bar chart must carry no `limit` below the true group
  count, or `rowCount` reports the `limit`, not the group count, and "top
  50 of 50" is not what the cap means to say — keeping bar-chart-backing
  queries unlimited (up to the 10,000 cap) is this module's
  responsibility.
