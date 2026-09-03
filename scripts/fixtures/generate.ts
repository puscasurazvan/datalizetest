// CLI entry point for fixture generation. All generation logic is pure and
// lives in the per-fixture modules (transactions.ts, customers.ts, events.ts,
// wide.ts); this file only wires a seed to a generator and streams CSV lines
// to disk. Nothing here is imported by generate.test.ts.
//
// Usage:
//   npx tsx scripts/fixtures/generate.ts              small fixtures (1,000 rows, committed)
//   npx tsx scripts/fixtures/generate.ts --large       also the 1,000,000-row variants (not committed)
//   npx tsx scripts/fixtures/generate.ts --wide        also the 100-column variant (not committed)
//   npx tsx scripts/fixtures/generate.ts --seed=123    a different seed (changes every output)

import { createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { csvLine } from "./csv"
import * as customersFixture from "./customers"
import * as eventsFixture from "./events"
import { mulberry32, type Rng } from "./prng"
import * as transactionsFixture from "./transactions"
import * as wideFixture from "./wide"

const DEFAULT_SEED = 42
const SMALL_ROW_COUNT = 1_000
const LARGE_ROW_COUNT = 1_000_000
const WIDE_ROW_COUNT = 1_000

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "fixtures")
const GENERATED_DIR = join(FIXTURES_DIR, "generated")

type FixtureModule = {
  HEADER: readonly string[]
  generateRows: (rng: Rng, count: number) => Generator<string[]>
}

const SMALL_FIXTURES: ReadonlyArray<readonly [string, FixtureModule]> = [
  ["transactions_stripe.csv", transactionsFixture],
  ["customers_saaS.csv", customersFixture],
  ["events_product.csv", eventsFixture],
]

async function writeCsv(
  path: string,
  fixture: FixtureModule,
  rng: Rng,
  rowCount: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const stream = createWriteStream(path)
  stream.write(csvLine(fixture.HEADER) + "\n")
  for (const row of fixture.generateRows(rng, rowCount)) {
    stream.write(csvLine(row) + "\n")
  }
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error) => (error ? reject(error) : resolve()))
  })
  console.log(`wrote ${path} (${rowCount} rows)`)
}

function parseArgs(argv: readonly string[]) {
  const seedArg = argv.find((arg) => arg.startsWith("--seed="))
  const seed = seedArg ? Number(seedArg.slice("--seed=".length)) : DEFAULT_SEED
  return {
    seed,
    includeLarge: argv.includes("--large"),
    includeWide: argv.includes("--wide"),
  }
}

async function main(): Promise<void> {
  const { seed, includeLarge, includeWide } = parseArgs(process.argv.slice(2))

  for (const [fileName, fixture] of SMALL_FIXTURES) {
    // Deliberate: writeCsv streams rows to disk one at a time to keep memory flat (see the module
    // comment above); running these in Promise.all would hold every fixture's rows in flight at
    // once, defeating the point of streaming.
    // oxlint-disable-next-line no-await-in-loop
    await writeCsv(join(FIXTURES_DIR, fileName), fixture, mulberry32(seed), SMALL_ROW_COUNT)
  }

  if (includeLarge) {
    for (const [fileName, fixture] of SMALL_FIXTURES) {
      const largeName = fileName.replace(".csv", "_large.csv")
      // Deliberate: each large fixture is up to LARGE_ROW_COUNT (1,000,000) rows; generating them
      // in parallel would hold multiple million-row generators in memory at once, which is
      // exactly what streaming avoids.
      // oxlint-disable-next-line no-await-in-loop
      await writeCsv(join(GENERATED_DIR, largeName), fixture, mulberry32(seed), LARGE_ROW_COUNT)
    }
  }

  if (includeWide) {
    await writeCsv(
      join(GENERATED_DIR, "transactions_stripe_wide.csv"),
      wideFixture,
      mulberry32(seed),
      WIDE_ROW_COUNT,
    )
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
