# Naive CSV timestamps are read in the organization's timezone; datetime columns are timestamptz

Inferred datetime columns are always stored as `timestamptz`. A CSV value carrying an explicit offset keeps its instant. A value without one is interpreted as local wall-clock time in the Organization's timezone as of import, and that timezone is stamped immutably onto the Dataset Version's column metadata.

**Why `timestamptz`:** on `timestamptz`, `col AT TIME ZONE 'X'` returns the local wall clock, which is what the date-grouping compiler assumes. On `timestamp` the identical expression means the reverse and grouping lands hours off — wrong in a way that looks plausible.

**Why the organization timezone and not UTC:** UTC is simpler and wrong for this persona. An ops analyst's internal export emits local wall-clock strings; calling them UTC shifts month-end revenue by up to 13 hours and moves rows across month boundaries with nothing on screen to explain it. Stamping the interpretation onto the immutable version means a later timezone change never retroactively moves rows that are already imported.

**Consequences:** the import preview must state which timezone it applied and let the user override before the import commits.
