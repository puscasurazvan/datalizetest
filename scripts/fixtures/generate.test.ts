import { afterEach, describe, expect, it } from "vitest"

import { csvLine } from "./csv"
import * as customers from "./customers"
import type { DirtyOverrides } from "./dirty"
import * as events from "./events"
import { mulberry32, type Rng } from "./prng"
import { formatIsoZ, formatNaiveLocal } from "./timestamps"
import * as transactions from "./transactions"
import * as wide from "./wide"

// Minimal hand-written CSV reader, used only here to prove that what csv.ts
// writes reads back exactly. There is no CSV parser dependency in the repo.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i)

    if (inQuotes) {
      if (char === '"' && text.charAt(i + 1) === '"') {
        field += '"'
        i += 1
        continue
      }
      if (char === '"') {
        inQuotes = false
        continue
      }
      field += char
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === ",") {
      row.push(field)
      field = ""
      continue
    }
    if (char === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      continue
    }
    field += char
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

type FixtureModule = {
  HEADER: readonly string[]
  generateRows: (rng: Rng, count: number) => Generator<string[]>
}

type FixtureWithDirtyRows = FixtureModule & { DIRTY_ROWS: DirtyOverrides }

function buildCsvText(fixture: FixtureModule, seed: number, rowCount: number): string {
  const lines = [csvLine(fixture.HEADER)]
  for (const row of fixture.generateRows(mulberry32(seed), rowCount)) {
    lines.push(csvLine(row))
  }
  return lines.join("\n")
}

const FIXTURES: ReadonlyArray<readonly [string, FixtureWithDirtyRows]> = [
  ["transactions_stripe", transactions],
  ["customers_saaS", customers],
  ["events_product", events],
]

// Every dirty row is at index 28 or lower, so 60 rows covers all of them.
const ROW_COUNT_WITH_DIRTY_ROWS = 60

describe("determinism", () => {
  it.each(FIXTURES)("%s: the same seed produces byte-identical output twice", (_name, fixture) => {
    const first = buildCsvText(fixture, 42, 1_000)
    const second = buildCsvText(fixture, 42, 1_000)
    expect(second).toBe(first)
  })

  it.each(FIXTURES)("%s: a different seed produces different output", (_name, fixture) => {
    const seedOne = buildCsvText(fixture, 1, 200)
    const seedTwo = buildCsvText(fixture, 2, 200)
    expect(seedTwo).not.toBe(seedOne)
  })

  it("the wide variant is also deterministic and exactly 100 columns wide", () => {
    expect(wide.HEADER.length).toBe(100)
    const first = buildCsvText(wide, 42, 50)
    const second = buildCsvText(wide, 42, 50)
    expect(second).toBe(first)

    const rows = parseCsv(first)
    const firstDataRow = rows[1] // rows[0] is the header
    expect(firstDataRow).toBeDefined()
    expect(firstDataRow).toHaveLength(100)
  })
})

describe("timestamp formatting is independent of the host machine's timezone", () => {
  // The README's "byte-identical output, on any machine — even in a
  // different timezone" claim only holds because formatIsoZ/formatNaiveLocal
  // read UTC getters. A regression to local getters (getHours() instead of
  // getUTCHours()) would still pass the determinism block above -- that
  // block never changes TZ, so a local-getter formatter is indistinguishable
  // from a UTC one within one process/host. This is the test that actually
  // pins the cross-machine claim: it fixes one instant and asserts the
  // formatted string against a hardcoded expectation under a timezone many
  // hours away from UTC, so a formatter reading the host clock would print a
  // different wall-clock time and fail here.
  const originalTz = process.env.TZ

  afterEach(() => {
    process.env.TZ = originalTz
  })

  it("formatIsoZ ignores process.env.TZ", () => {
    process.env.TZ = "Pacific/Kiritimati" // UTC+14 -- as far from UTC as IANA goes
    const ms = Date.UTC(2026, 0, 15, 14, 23, 5) // 2026-01-15T14:23:05Z

    expect(formatIsoZ(ms)).toBe("2026-01-15T14:23:05Z")
  })

  it("formatNaiveLocal ignores process.env.TZ", () => {
    process.env.TZ = "Pacific/Kiritimati"
    const ms = Date.UTC(2026, 0, 15, 14, 23, 5)

    expect(formatNaiveLocal(ms)).toBe("2026-01-15 14:23:05")
  })

  it("formats identically under UTC and under a timezone 14 hours ahead", () => {
    const ms = Date.UTC(2026, 5, 30, 23, 5, 9)

    process.env.TZ = "UTC"
    const underUtc = { iso: formatIsoZ(ms), naive: formatNaiveLocal(ms) }

    process.env.TZ = "Pacific/Kiritimati"
    const underOffset = { iso: formatIsoZ(ms), naive: formatNaiveLocal(ms) }

    expect(underOffset).toEqual(underUtc)
  })
})

describe("dirty rows", () => {
  it.each(FIXTURES)(
    "%s: every declared dirty override is present at its exact row and column",
    (_name, fixture) => {
      const text = buildCsvText(fixture, 42, ROW_COUNT_WITH_DIRTY_ROWS)
      const rows = parseCsv(text)
      const dataRows = rows.slice(1) // drop the header row

      for (const [rowIndex, overrides] of fixture.DIRTY_ROWS) {
        const row = dataRows[rowIndex]
        expect(row).toBeDefined()
        if (!row) continue

        for (const [column, expectedValue] of Object.entries(overrides)) {
          const columnIndex = fixture.HEADER.indexOf(column)
          expect(columnIndex).toBeGreaterThanOrEqual(0)
          expect(row[columnIndex]).toBe(expectedValue)
        }
      }
    },
  )

  it("transactions_stripe: the N/A decimal, currency-formatted decimal, and leading-zero id round-trip exactly", () => {
    const text = buildCsvText(transactions, 42, ROW_COUNT_WITH_DIRTY_ROWS)
    const rows = parseCsv(text).slice(1)
    const amountIndex = transactions.HEADER.indexOf("amount")
    const customerIdIndex = transactions.HEADER.indexOf("customer_id")

    expect(rows[3]?.[amountIndex]).toBe("N/A")
    expect(rows[7]?.[amountIndex]).toBe("$1,234.56")
    // Written and read back with the leading zero intact: Number("0001234") would
    // silently drop it, which is exactly the inference trap this row exists to catch.
    expect(rows[11]?.[customerIdIndex]).toBe("0001234")
  })

  it("customers_saaS: the DST spring-forward and fall-back naive timestamps are present verbatim", () => {
    const text = buildCsvText(customers, 42, ROW_COUNT_WITH_DIRTY_ROWS)
    const rows = parseCsv(text).slice(1)
    const createdAtIndex = customers.HEADER.indexOf("created_at")
    const canceledAtIndex = customers.HEADER.indexOf("canceled_at")

    expect(rows[20]?.[createdAtIndex]).toBe("2026-03-08 02:30:00")
    expect(rows[24]?.[canceledAtIndex]).toBe("2026-11-01 01:30:00")
  })

  it("events_product: timestamp mixes the Z-offset and naive-local shapes across rows", () => {
    const text = buildCsvText(events, 42, 500)
    const rows = parseCsv(text).slice(1)
    const timestampIndex = events.HEADER.indexOf("timestamp")
    const timestamps = rows.map((row) => row[timestampIndex] ?? "")

    const hasZOffset = timestamps.some((value) => value.endsWith("Z"))
    const hasNaiveLocal = timestamps.some((value) =>
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value),
    )
    expect(hasZOffset).toBe(true)
    expect(hasNaiveLocal).toBe(true)
  })
})

describe("CSV quoting round-trip", () => {
  it("a value containing a comma, a quote, and a newline survives csvLine -> parseCsv unchanged", () => {
    const trickyValue = 'Contains, a "quote", and\na newline'
    const line = csvLine(["plain", trickyValue, "also-plain"])
    const [parsedRow] = parseCsv(line)

    expect(parsedRow).toEqual(["plain", trickyValue, "also-plain"])
  })

  it.each(FIXTURES)(
    "%s: its own comma+quote+newline dirty row round-trips through the emitted CSV",
    (_name, fixture) => {
      const text = buildCsvText(fixture, 42, ROW_COUNT_WITH_DIRTY_ROWS)
      const rows = parseCsv(text)
      // Every row must have exactly as many cells as the header, proving the
      // embedded newline in one dirty row did not split it into two CSV rows.
      for (const row of rows) {
        expect(row).toHaveLength(fixture.HEADER.length)
      }
    },
  )
})
