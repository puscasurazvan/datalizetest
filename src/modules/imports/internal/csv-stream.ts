import { parse } from "csv-parse"
import type { Readable } from "node:stream"

import { MAX_UPLOAD_BYTES } from "@/modules/storage"
import { AppError } from "@/shared/errors"

/**
 * Streaming CSV framing over a Node `Readable` (docs/decisions/06 #1). This module owns CSV
 * *framing* only — quote/newline/delimiter resolution, header/row splitting, the three MVP
 * ceilings (docs/decisions/01 "Ceiling Conflict — Resolved") — and hands plain string cells
 * to the caller. Type inference (./inference.ts) and datetime parsing (./datetime.ts) are
 * someone else's job; this module never inspects a cell's content beyond its field count.
 *
 * Built on `csv-parse`'s streaming parser rather than hand-rolled splitting — quoted fields
 * containing commas, quotes, and embedded newlines are exactly what a hand-rolled `split(",")`
 * gets wrong, and are exactly what the real fixtures carry (tests/fixtures/README.md's dirty-row
 * table: `Acme, "The Best" Co.` plus an embedded newline, `O, "Really" Big Co`, the
 * `metadata_json` cell).
 *
 * Framing decisions made here, each load-bearing for a test below:
 *
 * - `relax_column_count: true` — a row whose field count disagrees with the header is
 *   delivered as-is (whatever fields it actually parsed to) instead of throwing. The caller
 *   compares its length against the header's itself; decisions/06 keeps `import_errors` for
 *   `FIELD_COUNT_MISMATCH` at the row level, so the row is reported and kept, never dropped.
 * - `skip_empty_lines: true` — a genuinely blank line (no characters between two record
 *   delimiters) is skipped rather than becoming a spurious one-field row. This is `csv-parse`'s
 *   own distinction, confirmed empirically: a single trailing newline at EOF (every real fixture
 *   ends this way) never produced a phantom row even with this option off, but a truly blank
 *   line before EOF did, so this option targets the second case without touching the first.
 * - Record delimiter is left to auto-discovery (`csv-parse`'s default): LF, CRLF, and lone CR
 *   are all accepted without configuration, so the module handles both the LF-only real
 *   fixtures and a CRLF (Excel-style) export identically.
 * - No `bom` option is set (default `false`) — a UTF-8 BOM on the first header is decoded as
 *   the literal `"\uFEFF"` character prefixed to the first header cell, not stripped here.
 *   Stripping it here would make ./inference.ts's `resolveHeaders` — which already detects and
 *   reports a leading BOM as a `bom_stripped` header issue (decisions/06 #6) — never see it.
 * - An invalid UTF-8 byte decodes to U+FFFD (the standard replacement character), silently, via
 *   Node's own `Buffer`-to-`string` UTF-8 decoding (the default `encoding: "utf8"`). This module
 *   does not detect or special-case it: the resulting string is just another cell value, and
 *   whether it parses as a column's inferred type is downstream's decision, exactly like any
 *   other dirty value. Decided here because it is the one framing question the task calls out
 *   explicitly and Node's decoder makes only one behavior available without a byte-level codec
 *   this module has no other reason to carry.
 *
 * Ceilings (docs/decisions/01): rejected with `AppError("IMPORT_LIMIT_EXCEEDED", …)`, whose
 * message names which bound was hit and the measured value, per the "Ceiling Conflict —
 * Resolved" section this module implements literally ("A file is rejected when it exceeds
 * EITHER bound... The rejection names which bound was hit and the measured value"). The column
 * ceiling is checked the moment the header is known, in both readers below; the byte and row
 * ceilings can only be known by reading the whole file, so only `streamRows` — which does —
 * enforces them. `readHeaderAndSample` deliberately never reads that far (see below).
 */

// Reuses storage's own constant rather than redeclaring the 50 MB ceiling a
// second time — two independent constants for the same bound could drift
// (a confirmed defect on this repo already).
const MAX_FILE_SIZE_BYTES = MAX_UPLOAD_BYTES
const MAX_ROW_COUNT = 1_000_000
const MAX_COLUMN_COUNT = 100

export interface HeaderAndSample {
  /** Empty when the input had no rows at all — an empty file (decisions/06's "empty file" case). */
  readonly header: readonly string[]
  /** Up to `sampleSize` data rows, header excluded. Empty for an empty file or a header-only file. */
  readonly sampleRows: readonly (readonly string[])[]
}

export interface ImportRowCounts {
  /** Data rows encountered, header excluded — mirrors `imports.rows_read`. */
  readonly rowsRead: number
  /** Of `rowsRead`, how many had a field count different from the header's. Not a subset
   * subtracted from `rowsRead` — every row counts once toward each measure it matches. */
  readonly rowsWithBadFieldCount: number
  /** Bytes consumed from `input` so far. Complete only once the iterable is exhausted. */
  readonly bytesRead: number
}

/**
 * An async iterable of parsed data rows (header excluded) plus running counts of what has been
 * read. `counts` is the same object throughout — it fills in as `for await` pulls rows and is
 * only complete once the loop finishes (or the iterable throws mid-stream on a ceiling breach).
 */
export interface RowStream extends AsyncIterable<readonly string[]> {
  readonly counts: ImportRowCounts
}

function assertColumnCeiling(columnCount: number): void {
  if (columnCount <= MAX_COLUMN_COUNT) return
  throw new AppError(
    "IMPORT_LIMIT_EXCEEDED",
    `File exceeds the ${MAX_COLUMN_COUNT}-column limit (measured ${columnCount} columns).`,
  )
}

/**
 * `bytesRead` (the parser's running read position) is always what trips
 * this check, but it is a poor "measured value" to report — it stops at
 * whatever position happened to first cross the bound, not the file's real
 * size, so a 115 MB file reported "measured 52429152 bytes" (docs/decisions/01
 * requires the rejection to name "the measured value", not an arbitrary
 * mid-stream position). `knownTotalBytes` — the object's real size,
 * already known from `StorageProvider.statObject` and persisted as
 * `imports.byteSize` by the time either caller of `streamRows` runs — is
 * named in the message instead, when the caller has it. The trip condition
 * itself is unchanged: this only affects what the message says.
 */
function assertByteCeiling(bytesRead: number, knownTotalBytes: number | undefined): void {
  if (bytesRead <= MAX_FILE_SIZE_BYTES) return
  const reportedBytes = knownTotalBytes ?? bytesRead
  throw new AppError(
    "IMPORT_LIMIT_EXCEEDED",
    `File exceeds the ${MAX_FILE_SIZE_BYTES}-byte limit (measured ${reportedBytes} bytes).`,
  )
}

function assertRowCeiling(rowsRead: number): void {
  if (rowsRead <= MAX_ROW_COUNT) return
  throw new AppError(
    "IMPORT_LIMIT_EXCEEDED",
    `File exceeds the ${MAX_ROW_COUNT}-row limit (measured ${rowsRead} rows).`,
  )
}

function createParser() {
  return parse({
    columns: false,
    relax_column_count: true,
    skip_empty_lines: true,
  })
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

/**
 * `csv-parse`'s `Parser` extends a plain, ungenericised `stream.Transform`, so its async
 * iterator yields untyped values — there is no way to have `parse()` itself hand back a typed
 * stream. This is the one place that boundary is crossed: with `columns: false` and no `cast`,
 * every record is genuinely a `string[]`, and the runtime check here (rather than a cast) is
 * what lets the rest of the module carry `readonly string[]` with no `any` beyond this function.
 */
function toRow(rawRecord: unknown): readonly string[] {
  if (!Array.isArray(rawRecord) || !rawRecord.every(isString)) {
    throw new AppError(
      "VALIDATION",
      "csv-parse produced a record that was not an array of strings.",
    )
  }
  return rawRecord
}

/**
 * Destroying `parser` alone does not stop `input` — piping only propagates end/error forward,
 * never destroy backward — so an early exit from either reader below must destroy both
 * explicitly or the source (a network body, a large file handle) keeps being read to no purpose.
 * Double-destroying an already-ended stream is a safe no-op, so this runs unconditionally.
 */
function destroyBoth(input: Readable, parser: Readable): void {
  parser.destroy()
  input.destroy()
}

/**
 * `.pipe()` does not forward `input`'s `'error'` event to `parser` either — an upstream failure
 * (a dropped S3 body, a truncated file read) would otherwise leave the `for await` below waiting
 * forever while the unhandled `'error'` on `input` crashes the process. Destroying `parser` with
 * the error makes its async iterator reject with it instead, which the caller's `try/finally`
 * already turns into a clean `destroyBoth`.
 */
function propagateSourceErrors(input: Readable, parser: Readable): void {
  input.once("error", (error: Error) => parser.destroy(error))
}

/**
 * Reads the header row plus up to `sampleSize` data rows, for the profile phase
 * (src/modules/imports/CLAUDE.md's `import.profile`). Stops as soon as it has enough and
 * destroys `input`, so a 10,000-row sample of a 50 MB / 1,000,000-row object reads only the
 * small prefix that contains those rows — never the whole object.
 *
 * Because it stops early, it cannot know the file's true total byte size or row count, so it
 * enforces only the column ceiling (known the moment the header is parsed); the byte and row
 * ceilings are `streamRows`'s job.
 *
 * `sampleSize <= 0` reads only the header and no data rows.
 */
export async function readHeaderAndSample(
  input: Readable,
  sampleSize: number,
): Promise<HeaderAndSample> {
  const parser = createParser()
  input.pipe(parser)
  propagateSourceErrors(input, parser)

  let header: readonly string[] | undefined
  const sampleRows: (readonly string[])[] = []

  try {
    for await (const rawRecord of parser) {
      const record = toRow(rawRecord)
      if (header === undefined) {
        header = record
        assertColumnCeiling(header.length)
        if (sampleSize <= 0) break
        continue
      }

      sampleRows.push(record)
      if (sampleRows.length >= sampleSize) break
    }
  } finally {
    destroyBoth(input, parser)
  }

  return { header: header ?? [], sampleRows }
}

/**
 * An async iterable of parsed data rows for the load phase (`import.load`), constant memory —
 * each row is yielded and can be handled (e.g. `COPY`-streamed into the analytical table)
 * before the next is read. Reads `input` to the end, so this is where the byte, row, and
 * column ceilings are all enforced; exceeding one throws `AppError("IMPORT_LIMIT_EXCEEDED", …)`
 * mid-iteration, naming the bound and the measured value.
 *
 * Single-pass: `input` is a Node `Readable` and can only be consumed once, so iterate the
 * returned `RowStream` exactly once. `counts` is only complete after the loop finishes.
 *
 * `options.knownTotalBytes`, when given, names the object's real size in a byte-ceiling
 * rejection's message instead of the parser's mid-stream read position — see
 * `assertByteCeiling`'s doc. It never changes whether the ceiling trips, only what the
 * message says when it does.
 */
export function streamRows(input: Readable, options?: { knownTotalBytes?: number }): RowStream {
  const knownTotalBytes = options?.knownTotalBytes
  const counts: { rowsRead: number; rowsWithBadFieldCount: number; bytesRead: number } = {
    rowsRead: 0,
    rowsWithBadFieldCount: 0,
    bytesRead: 0,
  }

  async function* generate(): AsyncGenerator<readonly string[]> {
    const parser = createParser()
    input.pipe(parser)
    propagateSourceErrors(input, parser)

    let headerLength: number | undefined

    try {
      for await (const rawRecord of parser) {
        const record = toRow(rawRecord)
        counts.bytesRead = parser.info.bytes
        assertByteCeiling(counts.bytesRead, knownTotalBytes)

        if (headerLength === undefined) {
          headerLength = record.length
          assertColumnCeiling(headerLength)
          continue
        }

        counts.rowsRead += 1
        assertRowCeiling(counts.rowsRead)
        if (record.length !== headerLength) counts.rowsWithBadFieldCount += 1

        yield record
      }
      // Bytes after the last record (a trailing newline with nothing after it) are otherwise
      // never counted, since the loop above only updates `bytesRead` before yielding a record.
      counts.bytesRead = parser.info.bytes
    } finally {
      destroyBoth(input, parser)
    }
  }

  return { [Symbol.asyncIterator]: generate, counts }
}
