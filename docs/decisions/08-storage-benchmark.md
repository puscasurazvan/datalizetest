# Datalize Storage Benchmark — the Slice 1 Gate

Decision 06 item 15 makes this a gate, not a follow-up: the query compiler is not written until
these numbers exist. This document records the method and the measured numbers, checks them
against the proposed pass bars, and makes a recommendation.

**Result: PASS on all three measures, by a wide margin. No ceiling, index, or load-strategy change
is needed.** One real performance defect was found and is reported below — it was not on the
critical path for this gate (COPY is not the bottleneck), but it would have mattered once wider
naive-timestamp datasets became common, so it was fixed straight away: see "Follow-up applied".

---

## Machine and Postgres version

| Component       | Value                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Host            | Apple Silicon Mac, macOS 26.6.2 (Darwin 25.6.0), 14 CPUs, 38.6 GB RAM                                                        |
| Postgres        | `postgres:16-alpine` in Docker Desktop, version **16.15**, on `aarch64-unknown-linux-musl`                                   |
| Docker VM       | 7.75 GiB memory limit (Docker Desktop default)                                                                               |
| Postgres config | **Stock image defaults, untuned**: `shared_buffers=128MB`, `effective_cache_size=4GB`, `work_mem=4MB`, `max_connections=100` |
| Node            | v25.8.1                                                                                                                      |
| Database        | The dev Postgres on port 5433 (`docker-compose.yml`'s `postgres` service), not the throwaway 5434 test database              |

The stock 128 MB `shared_buffers` matters for reading the aggregation numbers below — see
"Aggregation latency" for why the measured latency is optimistic for a busier dev database.

---

## Method

### Which file size to benchmark, and why

Per decision 01's "Ceiling Conflict — Resolved" and `tests/fixtures/README.md`'s own arithmetic, a
1,000,000-row file of any of the three canonical schemas is **70–93 MB — over the 50 MB ceiling**.
For all three schemas the byte ceiling binds before the row ceiling. There is no file that is
simultaneously "50 MB" and "1,000,000 rows" for these column shapes, so benchmarking a fabricated
file at both limits at once would not measure a file the ceiling rule would ever accept. Per the
task's own instruction, this benchmark measures **the largest file each schema can actually pass
the ceiling at** — trimmed from the generated 1,000,000-row fixture to exactly 50.00 MiB
(52,428,800 bytes, `MAX_FILE_SIZE_BYTES` in `csv-stream.ts`), keeping only whole CSV rows:

| Fixture               | File size | Rows    | (1,000,000-row file would be) |
| --------------------- | --------- | ------- | ----------------------------- |
| `transactions_stripe` | 50.00 MiB | 667,781 | 78.5 MB                       |
| `customers_saaS`      | 50.00 MiB | 563,491 | 93.1 MB                       |
| `events_product`      | 50.00 MiB | 747,561 | 70.1 MB                       |

**The byte bound binds first for every canonical fixture.** Row-count extrapolation to 1,000,000
rows appears below, from measured throughput — not from a fabricated file, which cannot exist for
these schemas within the ceiling.

### Pipeline under test

The real two-phase pipeline (`src/modules/imports/internal/{profile,load}.ts`), called directly —
`profileImport` then `confirmImport` then `loadImport` — rather than through `InlineDispatcher`, so
each phase's wall-clock and memory can be measured on its own boundary instead of folded into one
`startImport` call. This is the same code path `IMPORT_PROFILE`/`IMPORT_LOAD` run in production;
only the trigger (a direct call vs. a Trigger.dev task) differs.

`StorageProvider` is `InMemoryStorageProvider` — this dev environment has no `STORAGE_*` variables
set, so `selectStorageProvider` (`src/modules/storage/index.ts`) already resolves to it here, same
as it would for anyone running `pnpm dev` from a fresh clone. One correction was necessary and is
worth stating plainly: **the first benchmark run wrapped `InMemoryStorageProvider` unchanged, and
that measured a harness artifact, not the pipeline.** `InMemoryStorageProvider.readObject` hands
the whole stored buffer to the stream controller in a single `enqueue` call. `csv-parse`'s
transform stream has no backpressure signal to react to inside one chunk, so it parses the entire
50 MB file and queues hundreds of thousands of parsed records before the consumer (`streamRows`'s
`for await`) can drain any of them — a real S3 `GetObject` body arrives as a stream of ~16–64 KB
chunks and never does this. The first run's profile-phase peak RSS was ~959 MiB against a ~50 MB
file specifically because of this single-enqueue shortcut, not because of anything in the import
pipeline itself. `bench/storage-benchmark.ts`'s `ChunkedStorageProvider` re-chunks the read side at
64 KB before the numbers below were taken — **this is only a fix to the benchmark's test double,
made in `bench/` and never touching `src/`; a future S3 adapter must not replicate the
single-chunk behavior, since it would reintroduce the same artifact for real.**

Each fixture ran in its **own fresh Node process** (`bench/run-all.sh` invokes
`bench/storage-benchmark.ts --fixture=<name>` three times). This also corrected a real
measurement bug in the first draft of the harness: running all three fixtures in one shared
process left each fixture's uploaded buffer resident for the next one, so the second and third
fixtures' "baseline RSS" silently included the first fixture's already-buffered file — not a
legitimate reading of "this fixture's peak RSS starting cold." A fresh process returns all memory
to the OS on exit, so cross-fixture contamination is structurally impossible.

Peak RSS is sampled every 40 ms (`process.memoryUsage().rss`) for the duration of each phase, with
`global.gc()` forced and a 50 ms settle immediately before the phase starts (`node --expose-gc`).
Wall-clock is `performance.now()` around the phase call only — `confirmImport` (a small metadata
write between the two phases) is not timed as part of either.

### Aggregation query

Decision 05's own worked example is `SUM(amount) GROUP BY date_trunc('month', created_at)
WHERE currency = <one value>` on `transactions_stripe` — the only one of the three fixtures with a
monetary column. `src/modules/queries`'s compiler and `execute()` are not built yet (that build is
gated on this benchmark, per `analytical-store/CLAUDE.md`'s "Build order"), so the query runs as
raw SQL directly on `analyticalPool` (the real interactive pool, real 30s `statement_timeout`),
built from the physical column names looked up through the legitimate `dataset_columns` →
`analytical_columns` mapping — the same join `PostgresAnalyticalStore` itself does, never a
guessed or hand-typed physical name. The most frequent currency in the loaded data (`EUR`, by
chance of the seeded PRNG this run) is used as the filter value, so the query is a realistic
single-currency slice, not an edge case.

One fidelity gap versus the compiled shape decision 05 documents: this benchmark's SQL omits the
`LIMIT 10001` probe-row clause and the `AT TIME ZONE` cast the real compiler will emit (the
organization's timezone is UTC in this benchmark, making the cast a no-op here). Neither would
measurably change latency for a `GROUP BY month` result set of at most ~24 rows — a `LIMIT` well
above the result's own row count and a same-zone `AT TIME ZONE` cast are both free — but it means
these numbers are a slightly simplified proxy for the eventual compiled query, not the compiled
query verbatim.

The query ran **30 times** in a loop against the just-loaded table (no separate warm-up excluded —
"cold" below is the very first run, everything after it is the same connection pool against an
already-open table).

---

## Results

### Import pipeline

| Fixture               | File     | Rows    | Profile wall | Profile peak RSS     | Load wall   | Load peak RSS          | Rows/s | Table on disk |
| --------------------- | -------- | ------- | ------------ | -------------------- | ----------- | ---------------------- | ------ | ------------- |
| `transactions_stripe` | 50.0 MiB | 667,781 | **1.25 s**   | 515.9 MiB (Δ244 MiB) | **21.24 s** | 571.7 MiB (Δ56 MiB)    | 31,439 | 63.68 MiB     |
| `customers_saaS`      | 50.0 MiB | 563,491 | **1.13 s**   | 440.9 MiB (Δ184 MiB) | **57.10 s** | 1488.5 MiB (Δ1048 MiB) | 9,868  | 65.17 MiB     |
| `events_product`      | 50.0 MiB | 747,561 | **1.12 s**   | 466.8 MiB (Δ208 MiB) | **41.31 s** | 1114.5 MiB (Δ648 MiB)  | 18,095 | 62.67 MiB     |

"Δ" is peak RSS minus that phase's baseline (RSS immediately before the phase starts, after a
forced GC) — the memory the phase itself added, isolated from the interpreter/dependency-graph
floor every fresh process pays just to import the pipeline modules (~250–270 MiB here, dominated by
`pg`, `drizzle-orm`, and Next.js's own module graph pulled in transitively).

`rowsRejected` was 0–2 per fixture throughout (the fixtures' deliberately dirty rows at low, fixed
indices — see `tests/fixtures/README.md`) — expected, and evidence the ceiling-sized files still
exercise the same dirty-row handling the small committed fixtures do.

### Aggregation latency — `SUM(amount) GROUP BY month(created_at) WHERE currency = 'EUR'`, `transactions_stripe`, 667,781 rows, 30 runs

| cold (1st run) | p50          | p95          | min      | max      |
| -------------- | ------------ | ------------ | -------- | -------- |
| 37.76 ms       | **32.96 ms** | **35.67 ms** | 31.39 ms | 37.76 ms |

The table (63.68 MiB) fits inside the stock 128 MB `shared_buffers`, and it was written by the same
process seconds before the first query ran — "cold" here means _first query issued_, not _disk-cold
buffer cache_. A busier dev database running several datasets' worth of tables at once would see
`shared_buffers` pressure this benchmark never triggers. Even so, the margin to the pass bar below
is large enough that page-cache effects would need to be roughly two orders of magnitude worse to
put the target at risk.

---

## PASS/FAIL against decision 06 item 15's targets

| Target                                        | Bar                   | Measured (worst case across fixtures) | Verdict                        |
| --------------------------------------------- | --------------------- | ------------------------------------- | ------------------------------ |
| Profile phase, file at the binding ceiling    | ≤ 90 s                | 1.25 s (`transactions_stripe`)        | **PASS** — 72× headroom        |
| Load phase, file at the binding ceiling       | ≤ 5 min (300 s)       | 57.10 s (`customers_saaS`)            | **PASS** — 5.3× headroom       |
| `SUM(amount) GROUP BY month`, single currency | ≤ 3 s p50 / ≤ 8 s p95 | 32.96 ms p50 / 35.67 ms p95           | **PASS** — 91× / 224× headroom |

### Extrapolation to 1,000,000 rows

No canonical fixture reaches 1,000,000 rows within the 50 MB ceiling (see "Which file size" above)
— so the row-count half of decision 06 item 15's original framing ("50 MB / 1M rows" as one file)
cannot be measured directly for these schemas. A linear extrapolation from measured rows/s is used
below as an estimate of what a hypothetical 1,000,000-row file of each schema would cost, on the
strength of the load path's own structure rather than an observed flat rate across the run: the
physical table `createVersionTable` creates carries no index (a plain column list —
`postgres-store.ts`), `COPY ... FROM STDIN` is append-only with no cost that grows with prior row
count, and `encodeCell`'s per-cell encoding (`cell-encoding.ts`, `datetime.ts`) is stateless — each
row's cost depends only on that row's own values, not on how many rows came before it. Nothing in
that path predicts a rate that would drift as more rows are appended, though this was not directly
measured by sampling throughput at intervals within a single load:

| Fixture               | Measured rows/s | Extrapolated load time at 1,000,000 rows | vs. 5 min bar |
| --------------------- | --------------- | ---------------------------------------- | ------------- |
| `transactions_stripe` | 31,439          | ~31.8 s                                  | 9.4× headroom |
| `customers_saaS`      | 9,868           | ~101.3 s                                 | 3.0× headroom |
| `events_product`      | 18,095          | ~55.3 s                                  | 5.4× headroom |

Even the slowest schema, extrapolated to a row count it cannot actually reach within the byte
ceiling, would still pass the load-phase bar with 3× headroom.

---

## The one real finding: naive-timestamp conversion, not COPY, is `customers_saaS`'s bottleneck

`customers_saaS` loads at **9,868 rows/s** — a third of `transactions_stripe`'s 31,439 rows/s —
despite both using the same `COPY ... FROM STDIN` path (`postgres-store.ts`) against physical
tables of nearly identical size. `events_product` sits in between at 18,095 rows/s. The difference
is not row loading — it is `src/modules/imports/internal/datetime.ts`'s handling of **naive**
(no-offset) timestamps, and the fixtures differ exactly on how many of those each one carries
(`tests/fixtures/README.md`'s own table):

- `transactions_stripe.created_at` is always explicit (trailing `Z`) — **zero** naive conversions.
- `customers_saaS` has **two** naive columns, `created_at` (always populated) and `canceled_at`
  (populated for `churned` and half of `paused` customers — 30% of rows, from the fixture
  generator's own distribution in `scripts/fixtures/customers.ts`).
- `events_product.timestamp` is a 50/50 mix of naive and explicit per row
  (`scripts/fixtures/events.ts`: `chance(rng, 0.5)`).

Per ADR 0004, a naive value is converted to an instant in Node, not Postgres, so DST-ambiguous and
DST-nonexistent local times can be detected. `resolveLocalWallClock` (`datetime.ts`) does this by
calling `offsetMinutesAt` twice (the offset a day before and a day after the value) to bracket any
DST transition — and **`offsetMinutesAt` constructs a brand-new `Intl.DateTimeFormat` object and
calls `.formatToParts()` on every single call, for every single naive cell, with no caching.**
`Intl.DateTimeFormat` construction is expensive relative to almost anything else in this code path:
an isolated microbenchmark of exactly this construct-and-format pattern measured **~23.7 µs per
call** (1.1M calls in 26.0 s). Reasoning from that number and each fixture's known naive-value
count:

| Fixture          | Naive conversions     | `Intl` calls (×2) | Estimated `Intl` cost | Measured load time | COPY-only baseline* |
| ---------------- | --------------------- | ----------------- | --------------------- | ------------------ | ------------------- |
| `customers_saaS` | ~732,500 (100% + 30%) | ~1,465,000        | ~34.7 s               | 57.10 s            | ~17.9 s             |
| `events_product` | ~373,780 (50%)        | ~747,560          | ~17.7 s               | 41.31 s            | ~23.8 s             |

\* COPY-only baseline = fixture's row count ÷ `transactions_stripe`'s 31,439 rows/s, as a stand-in
for "this fixture's row count loaded with zero naive-datetime cost." Baseline + estimated `Intl`
cost lands within ~8% of the measured total for both fixtures (52.6 s vs. 57.1 s measured for
`customers_saaS`; 41.5 s vs. 41.3 s for `events_product`) — close enough, from two independent
fixtures with different naive-value fractions, to treat this as the confirmed mechanism rather than
a coincidence. The `customers_saaS` gap running slightly wider than the estimate is consistent with
GC pressure from allocating roughly a million short-lived `Intl.DateTimeFormat` instances — visible
directly in the peak-RSS column above: `customers_saaS`'s load-phase Δ is 1048 MiB against
`transactions_stripe`'s 56 MiB for a same-sized file.

This benchmark's organization timezone is `UTC`, so `resolveLocalWallClock`'s two candidate offsets
(a day before and a day after) are always equal and its 2-call early-return path fires for every
naive value here — the 4-call path (bracketing a genuine DST transition) never executes in this run,
including for the fixtures' two dirty DST rows, since UTC has no DST transitions to fall into. The
per-call `Intl.DateTimeFormat` cost measured above is timezone-independent, so the finding holds
for a real IANA timezone with DST — there, values that happen to fall within a day of a transition
would take the 4-call path, making the cost marginally worse than reported here, never better.

**This does not fail the gate** — even `customers_saaS`'s 57.10 s clears the 5-minute bar with
5.3× headroom, and the extrapolated 1,000,000-row case above still clears it with 3×. It is
reported because decision 06 item 15 asks to "be specific about which" strategy to change **if** a
target is missed, and the honest answer here is: **nothing needs to change for this gate**, but the
mechanism is worth fixing before a customer's file is wider still (more naive-datetime columns) or
the row ceiling moves — at that point this cost scales linearly with naive cell count and could
plausibly consume the current 5.3× margin. The fix is narrow and does not touch load strategy at
all: memoize one `Intl.DateTimeFormat` instance per `timeZone` (a `Map<string, Intl.DateTimeFormat>`
module-level cache in `datetime.ts`) instead of constructing one per call — the formatter's output
depends only on `timeZone` and the instant passed to `.format()`/`.formatToParts()`, so the same
instance is safe to reuse across every cell in an import. This is unrelated to, and should not be
confused with, decision 06 item 15's own suggested remedy ("a different load strategy... COPY FROM
STDIN via pg-copy-streams versus batched inserts") — **COPY is already in use, and it is not the
bottleneck**; `transactions_stripe`'s 31,439 rows/s with zero naive conversions is the clean
COPY-only number, and it is fast.

---

## Recommendation

1. **No ceiling change.** All three targets pass with wide margins on the files these schemas can
   actually reach within the 50 MB bound, and the row-count extrapolation clears the load bar even
   at a hypothetical 1,000,000 rows. Decision 01's ceiling rule (byte bound OR row bound, whichever
   binds first) needs no revision from this data.
2. **No load-strategy change.** COPY FROM STDIN (`postgres-store.ts`, already built) is not the
   constraint anywhere in this benchmark — the slowest fixture's COPY-attributable throughput
   (`transactions_stripe`'s clean 31,439 rows/s) is itself well within the pass bar.
3. ~~**Fix the naive-timestamp `Intl.DateTimeFormat` allocation in `datetime.ts`**~~ — **done**,
   see "Follow-up applied" below. It was a real, quantified inefficiency (roughly a third of
   `customers_saaS`'s load time and the majority of its 1+ GB load-phase peak RSS) that would have
   eroded today's comfortable margin as datasets with more naive-datetime columns or higher row
   counts arrive.
4. **When the query compiler and `execute()` are built** (unblocked by this gate — see
   `analytical-store/CLAUDE.md`'s "Build order"), re-run the aggregation benchmark through the real
   compiled path (with the `LIMIT 10001` clause and `AT TIME ZONE` cast this benchmark's raw-SQL
   proxy omits) to confirm the compiler adds no material overhead — expected to be negligible given
   the current ~200× margin, but worth confirming once that code exists rather than assumed.
5. **If a future S3 storage adapter is built, do not let it single-chunk-enqueue** the way
   `InMemoryStorageProvider` does — that behavior is fine for a test double (nothing production
   reads through it under load) but would reproduce this benchmark's original, corrected
   measurement artifact for real if a streaming adapter ever buffered a whole object before handing
   it to the pipeline.

---

## Follow-up applied — the `Intl.DateTimeFormat` cache

Recommendation 3 landed immediately after this benchmark was recorded, in the same batch of work.
`offsetMinutesAt` now takes its formatter from a module-level `Map<string, Intl.DateTimeFormat>`
keyed on `timeZone` (`offsetFormatterFor` in `src/modules/imports/internal/datetime.ts`) instead of
constructing a new one on every call. A formatter's output depends only on its `timeZone` and the
instant handed to `formatToParts`, so one instance per timezone is safe to share across every cell
of an import.

Measured directly on the conversion path (200,000 naive conversions in `Europe/London`, one fresh
process):

|                                                                              | Per naive conversion | Conversions/s |
| ---------------------------------------------------------------------------- | -------------------- | ------------- |
| Before (from this document's own ~23.7 µs per `Intl` construction, ×2 calls) | ~47 µs               | ~21,000       |
| After                                                                        | **4.41 µs**          | **226,768**   |

About a **10× reduction** on the naive-datetime path. Applying that to the mechanism table above,
`customers_saaS`'s ~34.7 s of `Intl` cost becomes ~3.2 s, which should take its load from 57.10 s to
roughly 20 s — in line with `transactions_stripe`'s clean COPY-only rate, as expected once the
formatter allocation stops dominating. **The end-to-end pipeline numbers in this document were
measured before that change and have not been re-run**; they stand as the recorded gate result, and
every one of them was already a pass, so the cache only widens margins that were never at risk.

Behaviour is unchanged, and that is tested rather than asserted: the cache's one real failure mode
is a key collision handing one zone's formatter to another, so `datetime.test.ts` interleaves five
timezones across repeated passes and re-checks both DST edges after a zone has been cached.
Deliberately breaking the cache key fails 10 tests in that file.

---

## Reproduction

```
bash bench/run-all.sh
```

`run-all.sh` generates the 1,000,000-row fixtures on first use (`scripts/fixtures/generate.ts
--large`, skipped if already present), trims each to the 50 MiB byte ceiling
(`bench/trim-to-ceiling.mjs` — keeps only whole CSV rows, never cuts one in half; byte-identical to
the trim used to produce the numbers in this document), then runs all three fixtures, each as its
own fresh process. `bash bench/run-all.sh --small` runs the same pipeline against the committed
1,000-row fixtures instead, as a fast smoke test of the harness itself.

`bench/storage-benchmark.ts`, `bench/trim-to-ceiling.mjs`, and `bench/run-all.sh` are not part of
`src/` — they are one-off measurement tools for this gate, not shipped pipeline code. Results land
in `bench/results/*.json` (gitignored). Every fixture's ephemeral organization, user, dataset, and
physical table are created and torn down within the same run (`cleanupOrganization` in
`bench/storage-benchmark.ts`) — running this leaves the dev database exactly as it found it.
