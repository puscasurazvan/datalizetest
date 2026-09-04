import { matchDatetimeGrammar } from "./datetime"
import type { DatetimeOffsetKind } from "./datetime"

/**
 * Deterministic CSV type inference (docs/decisions/06 #2-4, #6; docs/decisions/01).
 *
 * Pure: takes an already-parsed header row and sample rows (CSV framing and
 * quote resolution are some other module's job — a quoted `""` reaches this
 * module as the literal empty string) and describes each column. Never
 * throws on dirty data; every unparseable value is counted, never rejected.
 *
 * Judgement calls made here, not fully pinned upstream — each is also load
 * bearing for a specific test below:
 *
 * - Try order (narrowest first): integer, decimal, boolean, date,
 *   timestamptz, with string as the fallback nothing else reached 95% on.
 *   `integer` is a special case, not just first in a list: `decimal`'s
 *   pattern is a strict superset of `integer`'s (every integer is also a
 *   valid decimal), so `integer` is only chosen when its match count *ties*
 *   `decimal`'s — i.e. nothing in the sample is genuinely fractional. A
 *   sample with even a few fractional values (mostly-whole-dollar `amount`)
 *   must infer `decimal`: inferring `integer` there would silently NULL
 *   every fractional value at load (decisions/06 #2, #4), while inferring
 *   `decimal` for an all-whole-number column loses nothing.
 * - Integer before boolean for the same reason, in the other direction: a
 *   `seats`/`refund_count` column whose sampled values happen to all be
 *   "0"/"1" must infer `integer`, not `boolean` — a later "2" in that column
 *   is a normal integer, but would be silently NULLed at load if the column
 *   had been typed `boolean`. The reverse (a real flag column inferred
 *   `integer`) loses no information, so the asymmetry decides the order.
 * - Boolean literals, case-insensitive, trimmed: "true", "false", "yes",
 *   "no". Deliberately excludes "1"/"0" for the reason above — a bare digit
 *   is a number first.
 * - "0001234" is string, not integer/decimal: a value with more than one
 *   digit and a leading zero is an identifier (invoice number, zip code),
 *   never a number. "0" and "0.5" are unaffected — only multi-digit leading
 *   zeros are rejected, and the same rule applies to decimal's integer part.
 * - "1,234.56" is decimal (comma thousands-grouping is a plain numeric
 *   format); "$1,234.56" is string. A currency symbol ties the value to an
 *   unstated currency — stripping it would silently discard information
 *   this module has no business inventing. If a value's currency matters,
 *   it belongs in its own column (see `currency` in the transactions
 *   fixture), not folded into a numeric parse.
 * - `datetimeOffset` ("explicit" | "naive" | "mixed") is reported per
 *   column because ADR-0004 and decisions/03 store every datetime-shaped
 *   input as the `timestamptz` type: a value with an explicit offset keeps
 *   its instant, a naive value is read in the organization's timezone at
 *   import. The next module (import.load) needs to know which it got before
 *   it can convert correctly. "datetime" itself names an input *shape*
 *   (decisions/03), never a column type — it must never appear in
 *   `DATALIZE_TYPES` or as a `ColumnInference.type` value.
 *
 * The five `parsesAs*`/`matchDatetime` predicates below are exported, not
 * just used internally: the 95% guarantee this module hands the caller only
 * holds if import.load parses each cell with the exact same rule that
 * counted it as a match here. Re-implementing the grammar at load time would
 * let the two silently drift — `matchDatetime` here is the one grammar for
 * "is this string a datetime, and offset-bearing or naive"; any other module
 * that needs that answer must call it rather than pattern-match its own copy.
 */

export const DATALIZE_TYPES = [
  "string",
  "integer",
  "decimal",
  "boolean",
  "date",
  "timestamptz",
] as const
export type DatalizeType = (typeof DATALIZE_TYPES)[number]

/**
 * Try order, narrowest first, for everything except `integer` — `integer`
 * is resolved separately in `resolveType` because it needs the tie-break
 * against `decimal` described above. `string` is the fallback, never
 * attempted here.
 */
const INFERENCE_ORDER: readonly Exclude<DatalizeType, "string" | "integer">[] = [
  "decimal",
  "boolean",
  "date",
  "timestamptz",
]

// Exported (H9): the confirm screen labels `unparseableCount` "in the first
// 10,000 sampled rows" from this constant rather than a typed-in literal.
// `profile.ts` declares its own identical `10_000` for a different job
// (the streaming ceiling check) — deliberately not deduplicated; see that
// file's own doc.
export const SAMPLE_SIZE = 10_000
const THRESHOLD_NUMERATOR = 19
const THRESHOLD_DENOMINATOR = 20

const BOOLEAN_LITERALS = new Set(["true", "false", "yes", "no"])
const BOM = "\uFEFF"

const INTEGER_PATTERN = /^-?(?:0|[1-9]\d*)$/
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)(?:\.\d+)?$/

/**
 * Postgres `bigint`'s exact range — `postgres-store.ts` maps the `integer`
 * Datalize type onto it. `INTEGER_PATTERN` alone has no digit-count bound,
 * so without this a column of long numeric identifiers (20-digit
 * bank/PSP account or IMEI numbers) infers as `integer`, passes
 * `encodeCell` unchanged, and reaches `COPY ... FROM STDIN` — which is
 * all-or-nothing, so one out-of-range value aborts the entire load
 * (cell-encoding.ts's module doc: this is exactly the failure that gate
 * exists to prevent).
 */
const BIGINT_MAX = 9223372036854775807n
const BIGINT_MIN = -9223372036854775808n

/**
 * `INTEGER_PATTERN` already guarantees `trimmed` is a valid integer
 * literal (optional `-`, then digits with no invalid leading zero), so
 * `BigInt(trimmed)` here never throws — this only ever narrows a match
 * `INTEGER_PATTERN` already made, never validates shape on its own.
 */
function isWithinBigintRange(trimmed: string): boolean {
  const value = BigInt(trimmed)
  return value >= BIGINT_MIN && value <= BIGINT_MAX
}
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
export type { DatetimeOffsetKind } from "./datetime"
export type ColumnDatetimeOffset = DatetimeOffsetKind | "mixed"

export type HeaderIssue = "bom_stripped" | "blank_header" | "duplicate_header"

/** Position is 1-based: it is user-facing, in `column_{position}` and the import summary. */
export interface ColumnInference {
  readonly position: number
  readonly name: string
  readonly originalHeader: string
  readonly headerRenamed: boolean
  readonly headerIssues: readonly HeaderIssue[]
  readonly type: DatalizeType
  readonly nullable: boolean
  readonly unparseableCount: number
  readonly datetimeOffset?: ColumnDatetimeOffset
}

function toNumber(group: string | undefined): number {
  return Number(group ?? "NaN")
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

export function parsesAsInteger(value: string): boolean {
  const trimmed = value.trim()
  return INTEGER_PATTERN.test(trimmed) && isWithinBigintRange(trimmed)
}

export function parsesAsDecimal(value: string): boolean {
  return DECIMAL_PATTERN.test(value.trim())
}

export function parsesAsBoolean(value: string): boolean {
  return BOOLEAN_LITERALS.has(value.trim().toLowerCase())
}

export function parsesAsDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value.trim())
  if (match === null) return false
  return isValidCalendarDate(toNumber(match[1]), toNumber(match[2]), toNumber(match[3]))
}

/**
 * Returns the offset kind matched, or null when `value` is not a datetime at all.
 *
 * Delegates to `matchDatetimeGrammar` in ./datetime rather than matching its own
 * pattern. The 95% guarantee this module gives the caller only holds if load time
 * parses each cell by the exact same rule that counted it here — two
 * near-identical implementations drifted once already (./datetime additionally
 * rejects a year below 100, which this function used to accept, so such a value
 * inferred as a clean timestamptz and then loaded as NULL).
 */
export function matchDatetime(value: string): DatetimeOffsetKind | null {
  return matchDatetimeGrammar(value)
}

interface ColumnAccumulator {
  nonEmptyCount: number
  nullCount: number
  matchCounts: Record<Exclude<DatalizeType, "string">, number>
  datetimeExplicitCount: number
  datetimeNaiveCount: number
}

function createAccumulator(): ColumnAccumulator {
  return {
    nonEmptyCount: 0,
    nullCount: 0,
    matchCounts: { integer: 0, decimal: 0, boolean: 0, date: 0, timestamptz: 0 },
    datetimeExplicitCount: 0,
    datetimeNaiveCount: 0,
  }
}

function tallyCell(acc: ColumnAccumulator, cell: string): void {
  if (cell === "") {
    acc.nullCount += 1
    return
  }

  acc.nonEmptyCount += 1
  if (parsesAsInteger(cell)) acc.matchCounts.integer += 1
  if (parsesAsDecimal(cell)) acc.matchCounts.decimal += 1
  if (parsesAsBoolean(cell)) acc.matchCounts.boolean += 1
  if (parsesAsDate(cell)) acc.matchCounts.date += 1

  const offset = matchDatetime(cell)
  if (offset !== null) {
    acc.matchCounts.timestamptz += 1
    if (offset === "explicit") acc.datetimeExplicitCount += 1
    else acc.datetimeNaiveCount += 1
  }
}

function meetsThreshold(matches: number, nonEmptyCount: number): boolean {
  if (nonEmptyCount === 0) return false
  return matches * THRESHOLD_DENOMINATOR >= nonEmptyCount * THRESHOLD_NUMERATOR
}

/**
 * `decimal`'s pattern is a strict superset of `integer`'s, so
 * `matchCounts.decimal >= matchCounts.integer` always holds. `integer` is
 * therefore chosen only when the two counts tie — nothing in the sample is
 * genuinely fractional — otherwise `decimal` (tried next, in
 * `INFERENCE_ORDER`) is the lossless choice. See the module header for why.
 */
function resolveType(acc: ColumnAccumulator): DatalizeType {
  const noFractionalValues = acc.matchCounts.integer === acc.matchCounts.decimal
  if (noFractionalValues && meetsThreshold(acc.matchCounts.integer, acc.nonEmptyCount)) {
    return "integer"
  }

  for (const candidate of INFERENCE_ORDER) {
    if (meetsThreshold(acc.matchCounts[candidate], acc.nonEmptyCount)) return candidate
  }
  return "string"
}

function resolveDatetimeOffset(acc: ColumnAccumulator): ColumnDatetimeOffset {
  const hasExplicit = acc.datetimeExplicitCount > 0
  const hasNaive = acc.datetimeNaiveCount > 0
  if (hasExplicit && hasNaive) return "mixed"
  return hasExplicit ? "explicit" : "naive"
}

interface ResolvedHeader {
  readonly name: string
  readonly originalHeader: string
  readonly headerRenamed: boolean
  readonly headerIssues: readonly HeaderIssue[]
}

/**
 * Strips a BOM from the first header, substitutes `column_{position}` for a
 * blank header, and suffixes `_{position}` onto the second and later
 * occurrence of a duplicate header. Headers are trimmed before the blank and
 * duplicate checks (decisions/06 #6: continuity matches "the exact trimmed
 * header") — otherwise `amount` and `amount ` would collide on the
 * `unique(dataset_version_id, name)` constraint this rename exists to keep.
 * Trimming itself is not reported as an issue; it is not one of the three
 * continuity-breaking events decisions/06 #6 calls out.
 */
function resolveHeaders(headerRow: readonly string[]): readonly ResolvedHeader[] {
  const seenNames = new Set<string>()

  return headerRow.map((rawHeader, index): ResolvedHeader => {
    const position = index + 1
    const issues: HeaderIssue[] = []

    let working = rawHeader
    if (index === 0 && working.startsWith(BOM)) {
      working = working.slice(1)
      issues.push("bom_stripped")
    }

    working = working.trim()
    if (working === "") {
      working = `column_${position}`
      issues.push("blank_header")
    }

    let name = working
    if (seenNames.has(working)) {
      name = uniqueSuffixedName(`${working}_${position}`, seenNames)
      issues.push("duplicate_header")
    }
    seenNames.add(name)

    return {
      name,
      originalHeader: rawHeader,
      headerRenamed: issues.length > 0,
      headerIssues: issues,
    }
  })
}

/**
 * decisions/06 #6's suffix is `{name}_{position}` — `candidate` already has that shape and is
 * unique per column in the ordinary case, since `position` is unique per column. This only extends
 * further on the rare case where that exact string was already used, e.g. a header literally named
 * "amount_2" sitting alongside two "amount" headers: the second "amount" would otherwise be
 * suffixed to the same "amount_2" that column already has, producing two identically named columns
 * and silently breaking the `unique(dataset_version_id, name)` constraint the rename exists for.
 */
function uniqueSuffixedName(candidate: string, seenNames: ReadonlySet<string>): string {
  if (!seenNames.has(candidate)) return candidate

  let attempt = 2
  while (seenNames.has(`${candidate}_${attempt}`)) attempt += 1
  return `${candidate}_${attempt}`
}

function buildColumnInference(
  header: ResolvedHeader,
  position: number,
  acc: ColumnAccumulator,
): ColumnInference {
  const type = resolveType(acc)
  const matches = type === "string" ? acc.nonEmptyCount : acc.matchCounts[type]
  const unparseableCount = acc.nonEmptyCount - matches
  const base = {
    position,
    name: header.name,
    originalHeader: header.originalHeader,
    headerRenamed: header.headerRenamed,
    headerIssues: header.headerIssues,
    type,
    // An unparseable value becomes NULL at load, the same as an empty cell (decisions/06 #4) — so
    // the column is nullable whenever either source of NULL is present, not just empty cells.
    nullable: acc.nullCount > 0 || unparseableCount > 0,
    unparseableCount,
  }

  if (type !== "timestamptz") return base
  return { ...base, datetimeOffset: resolveDatetimeOffset(acc) }
}

/**
 * Describes each column of a CSV from its header row and sample data rows.
 * Only the first `SAMPLE_SIZE` sample rows are considered, regardless of how
 * many are passed in (decisions/06 #2) — a value beyond that sample can
 * still fail to parse at load time; that becomes a `NULL` and an
 * `import_errors` row there, not a wider column type here.
 *
 * This module does not mint Column IDs; it describes columns in order for
 * the caller to turn into them.
 */
export function inferColumns(
  headerRow: readonly string[],
  sampleRows: readonly (readonly string[])[],
): readonly ColumnInference[] {
  const headers = resolveHeaders(headerRow)
  const accumulators = headers.map(() => createAccumulator())
  const rows = sampleRows.slice(0, SAMPLE_SIZE)

  for (const row of rows) {
    for (const [columnIndex, acc] of accumulators.entries()) {
      tallyCell(acc, row[columnIndex] ?? "")
    }
  }

  return headers.map((header, index) => {
    const acc = accumulators[index] ?? createAccumulator()
    return buildColumnInference(header, index + 1, acc)
  })
}
