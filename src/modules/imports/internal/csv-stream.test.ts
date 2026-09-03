import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { AppError } from "@/shared/errors"

import { readHeaderAndSample, streamRows } from "./csv-stream"
import type { ImportRowCounts } from "./csv-stream"

const FIXTURES_DIR = fileURLToPath(new URL("../../../../tests/fixtures/", import.meta.url))

function fixtureStream(name: string): Readable {
  return createReadStream(`${FIXTURES_DIR}${name}`)
}

/** Wraps a UTF-8 string (or a Buffer, for the invalid-byte case) as a one-chunk Readable —
 * the standard shape a real upload arrives as, not a toy string split by hand. */
function streamOf(content: string | Buffer): Readable {
  const buffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content
  return Readable.from([buffer])
}

async function collectRows(input: Readable): Promise<{
  rows: (readonly string[])[]
  counts: ImportRowCounts
}> {
  const result = streamRows(input)
  const rows: (readonly string[])[] = []
  for await (const row of result) rows.push(row)
  return { rows, counts: result.counts }
}

/** Drains an already-constructed `RowStream` (e.g. one built with `{ knownTotalBytes }`)
 * to completion, discarding the rows — for tests that only care whether/how it throws. */
async function drain(result: ReturnType<typeof streamRows>): Promise<void> {
  for await (const row of result) {
    void row // draining, not collecting.
  }
}

/** No `expect()` inside the try/catch itself — every assertion runs afterward, in the caller,
 * outside any conditional — so this stays clear of vitest's `no-conditional-expect` rule. */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return undefined
  } catch (error) {
    return error
  }
}

/** Rows enough to cross the row ceiling; module scope so it captures nothing and isn't
 * recreated per call (oxlint `consistent-function-scoping`). */
async function* generateRowCount(count: number): AsyncGenerator<Buffer> {
  yield Buffer.from("a\n")
  for (let i = 0; i < count; i += 1) yield Buffer.from("1\n")
}

/** `rowCount` rows of a `cellBytes`-byte cell each; enough to cross the byte ceiling in a
 * handful of large rows rather than millions of small ones. Module scope for the same reason
 * as `generateRowCount` above. */
async function* generateBigRows(cellBytes: number, rowCount: number): AsyncGenerator<Buffer> {
  const cell = "x".repeat(cellBytes)
  yield Buffer.from("a\n")
  for (let i = 0; i < rowCount; i += 1) yield Buffer.from(`${cell}\n`)
}

describe("streamRows — real fixtures (tests/fixtures/README.md)", () => {
  it.each(["transactions_stripe", "customers_saaS", "events_product"])(
    "%s.csv: reads exactly the 1,000 documented data rows, none lost or duplicated by the trailing newline or an embedded newline inside a quoted field",
    async (name) => {
      const { rows, counts } = await collectRows(fixtureStream(`${name}.csv`))

      expect(rows).toHaveLength(1000)
      expect(counts.rowsRead).toBe(1000)
      expect(counts.rowsWithBadFieldCount).toBe(0)
      expect(counts.bytesRead).toBeGreaterThan(0)
    },
  )

  it("transactions_stripe.csv row 19: a quoted field carrying a comma, doubled quotes, and an embedded newline round-trips exactly", async () => {
    const { rows } = await collectRows(fixtureStream("transactions_stripe.csv"))
    const row = rows[19]

    expect(row?.[2]).toBe('Acme, "The Best" Co.\nSecond line')
  })

  it("customers_saaS.csv row 28: the same quoting stress case in a different column position", async () => {
    const { rows } = await collectRows(fixtureStream("customers_saaS.csv"))
    const row = rows[28]

    expect(row?.[1]).toBe('O, "Really" Big\nCo')
  })

  it("events_product.csv row 21: a JSON-shaped cell with a comma, an escaped quote, and an embedded newline — not valid JSON, deliberately, per the fixtures README", async () => {
    const { rows } = await collectRows(fixtureStream("events_product.csv"))
    const row = rows[21]

    expect(row?.[5]).toBe('{"note":"has, comma \\"quote\\"\nline"}')
  })

  it("transactions_stripe.csv byte count matches the fixtures README's measured size exactly", async () => {
    const { counts } = await collectRows(fixtureStream("transactions_stripe.csv"))

    expect(counts.bytesRead).toBe(78_456)
  })
})

describe("readHeaderAndSample — real fixtures", () => {
  it("returns the documented header and a sample bounded by sampleSize", async () => {
    const result = await readHeaderAndSample(fixtureStream("transactions_stripe.csv"), 5)

    expect(result.header).toEqual([
      "id",
      "customer_id",
      "customer_name",
      "amount",
      "currency",
      "status",
      "created_at",
      "plan_name",
      "country",
    ])
    expect(result.sampleRows).toHaveLength(5)
  })

  it("a sampleSize larger than the file returns every data row, not an error", async () => {
    const result = await readHeaderAndSample(fixtureStream("events_product.csv"), 10_000)

    expect(result.sampleRows).toHaveLength(1000)
  })

  it("sampleSize <= 0 reads only the header and no data rows", async () => {
    const result = await readHeaderAndSample(fixtureStream("customers_saaS.csv"), 0)

    expect(result.header.length).toBeGreaterThan(0)
    expect(result.sampleRows).toHaveLength(0)
  })
})

describe("readHeaderAndSample — does not drain the source (docs/decisions/06 #2, the 10,000-row sample bound)", () => {
  it("stops pulling from the source once it has enough rows, and destroys it", async () => {
    let rowsGenerated = 0

    async function* nearlyInfiniteRows(): AsyncGenerator<Buffer> {
      yield Buffer.from("a,b,c\n")
      for (let i = 0; i < 2_000_000; i += 1) {
        rowsGenerated += 1
        yield Buffer.from(`${i},${i},${i}\n`)
      }
    }

    const input = Readable.from(nearlyInfiniteRows())
    const result = await readHeaderAndSample(input, 5)

    expect(result.sampleRows).toHaveLength(5)
    expect(result.sampleRows[0]).toEqual(["0", "0", "0"])
    // Far below the 2,000,000 rows on offer — proves the read stopped, not that it happened
    // to be fast; internal stream buffering pulls a little ahead of the exact sample size,
    // so this asserts "did not drain," not "pulled exactly 5."
    expect(rowsGenerated).toBeLessThan(50_000)
    expect(input.destroyed).toBe(true)
  })
})

async function* rowsThenFailure(): AsyncGenerator<Buffer> {
  yield Buffer.from("a,b\n1,2\n")
  throw new Error("upstream failed")
}

describe("source stream errors — must reject, never hang (a dropped S3 body, a truncated file read)", () => {
  it("streamRows rejects with the source's error instead of hanging forever", async () => {
    await expect(collectRows(Readable.from(rowsThenFailure()))).rejects.toThrow("upstream failed")
  })

  it("readHeaderAndSample rejects with the source's error instead of hanging forever", async () => {
    await expect(readHeaderAndSample(Readable.from(rowsThenFailure()), 10)).rejects.toThrow(
      "upstream failed",
    )
  })
})

describe("framing edge cases — structural shapes the three real fixtures don't carry (BOM, CRLF, malformed rows, empty/header-only files)", () => {
  it("a UTF-8 BOM on the first header is preserved, not stripped — decisions/06 #6's bom_stripped detection is inference.ts's job, downstream of this module", async () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a,b\n1,2\n")])
    const result = await readHeaderAndSample(streamOf(withBom), 10)

    expect(result.header[0]).toBe("\uFEFFa")
    expect(result.header[0]?.codePointAt(0)).toBe(0xfeff)
  })

  it("CRLF line endings parse identically to LF — no stray \\r left in a field", async () => {
    const { rows } = await collectRows(streamOf("a,b,c\r\n1,2,3\r\n4,5,6\r\n"))

    expect(rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ])
  })

  it("a trailing newline never produces a spurious final row (synthetic, mirroring what every real fixture already does)", async () => {
    const withTrailing = await collectRows(streamOf("a,b\n1,2\n2,3\n"))
    const withoutTrailing = await collectRows(streamOf("a,b\n1,2\n2,3"))

    expect(withTrailing.rows).toHaveLength(2)
    expect(withoutTrailing.rows).toHaveLength(2)
    expect(withTrailing.counts.rowsRead).toBe(2)
  })

  it("a row with the wrong field count is reported, kept, and returned with its actual field count — never thrown, never padded or truncated to match the header", async () => {
    const { rows, counts } = await collectRows(streamOf("a,b,c\n1,2\n4,5,6,7\n8,9,10\n"))

    expect(rows).toEqual([
      ["1", "2"],
      ["4", "5", "6", "7"],
      ["8", "9", "10"],
    ])
    expect(counts.rowsRead).toBe(3)
    expect(counts.rowsWithBadFieldCount).toBe(2)
  })

  it("an empty file yields no header and no rows, without throwing", async () => {
    const sample = await readHeaderAndSample(streamOf(""), 10)
    const { rows, counts } = await collectRows(streamOf(""))

    expect(sample.header).toEqual([])
    expect(sample.sampleRows).toEqual([])
    expect(rows).toEqual([])
    expect(counts).toEqual({ rowsRead: 0, rowsWithBadFieldCount: 0, bytesRead: 0 })
  })

  it("a header-only file (no data rows) yields the header and zero data rows, without throwing", async () => {
    const sample = await readHeaderAndSample(streamOf("a,b,c\n"), 10)
    const { rows, counts } = await collectRows(streamOf("a,b,c\n"))

    expect(sample.header).toEqual(["a", "b", "c"])
    expect(sample.sampleRows).toEqual([])
    expect(rows).toEqual([])
    expect(counts.rowsRead).toBe(0)
  })

  it("an invalid UTF-8 byte decodes to the U+FFFD replacement character rather than throwing — this module's documented decision for dirty encoding", async () => {
    const invalidByte = Buffer.concat([
      Buffer.from("a,b\n1,"),
      Buffer.from([0xff]),
      Buffer.from("\n"),
    ])
    const { rows } = await collectRows(streamOf(invalidByte))

    expect(rows).toEqual([["1", "�"]])
  })
})

describe("ceilings (docs/decisions/01 'Ceiling Conflict — Resolved') — reject naming which bound and the measured value", () => {
  it("more than 100 columns rejects, naming the column bound and the measured column count", async () => {
    const header = Array.from({ length: 101 }, (_, index) => `col${index}`).join(",")
    const error = await captureRejection(collectRows(streamOf(`${header}\n`)))

    expect(error).toBeInstanceOf(AppError)
    if (!(error instanceof AppError)) throw new Error("expected an AppError")
    expect(error.code).toBe("IMPORT_LIMIT_EXCEEDED")
    expect(error.message).toContain("100")
    expect(error.message).toContain("101")
    expect(error.message.toLowerCase()).toContain("column")
  })

  it("exactly 100 columns is accepted — the ceiling rejects past the bound, not at it", async () => {
    const header = Array.from({ length: 100 }, (_, index) => `col${index}`).join(",")
    const { rows } = await collectRows(streamOf(`${header}\n`))

    expect(rows).toEqual([])
  })

  it("more than 1,000,000 rows rejects, naming the row bound and the measured row count", async () => {
    const error = await captureRejection(collectRows(Readable.from(generateRowCount(1_000_001))))

    expect(error).toBeInstanceOf(AppError)
    if (!(error instanceof AppError)) throw new Error("expected an AppError")
    expect(error.code).toBe("IMPORT_LIMIT_EXCEEDED")
    expect(error.message).toContain("1000000")
    expect(error.message).toContain("1000001")
    expect(error.message.toLowerCase()).toContain("row")
  })

  it("more than 50 MB rejects, naming the byte bound and the measured byte count", async () => {
    const error = await captureRejection(collectRows(Readable.from(generateBigRows(1_000_000, 60))))

    expect(error).toBeInstanceOf(AppError)
    if (!(error instanceof AppError)) throw new Error("expected an AppError")
    expect(error.code).toBe("IMPORT_LIMIT_EXCEEDED")
    expect(error.message).toContain("52428800")
    expect(error.message.toLowerCase()).toContain("byte")
  })

  it("readHeaderAndSample enforces only the column ceiling — it stops reading long before the byte/row ceilings could ever be reached", async () => {
    const header = Array.from({ length: 101 }, (_, index) => `col${index}`).join(",")
    await expect(readHeaderAndSample(streamOf(`${header}\n`), 10)).rejects.toThrow(AppError)
  })

  // Regression for the confirmed defect: `assertByteCeiling` used to report
  // the parser's mid-stream read position (~50 MB, wherever it happened to
  // trip) as "the measured value" — always approximately the bound itself,
  // regardless of the file's real size. A 115 MB file was reported as
  // "measured 52429152 bytes", not 115 MB. The caller now knows the file's
  // true size up front (`StorageProvider.statObject`, persisted as
  // `imports.byteSize`) and can pass it through so the message names the
  // real size, not the trip point.
  it("names the caller-supplied known total size, not the mid-stream trip point, when one is given", async () => {
    const error = await captureRejection(
      drain(
        streamRows(Readable.from(generateBigRows(1_000_000, 60)), { knownTotalBytes: 120_240_004 }),
      ),
    )

    expect(error).toBeInstanceOf(AppError)
    if (!(error instanceof AppError)) throw new Error("expected an AppError")
    expect(error.code).toBe("IMPORT_LIMIT_EXCEEDED")
    expect(error.message).toContain("120240004")
    expect(error.message).not.toContain("52429152")
  })

  it("falls back to the measured position when no known total is given (unchanged default behavior)", async () => {
    const error = await captureRejection(collectRows(Readable.from(generateBigRows(1_000_000, 60))))

    expect(error).toBeInstanceOf(AppError)
    if (!(error instanceof AppError)) throw new Error("expected an AppError")
    expect(error.message).toContain("52428800")
  })
})
