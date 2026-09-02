/**
 * Naive-local to UTC instant conversion (docs/adr/0004, docs/decisions/04),
 * and the single datetime grammar shared with type inference.
 *
 * A CSV datetime value with an explicit offset ("...Z", "...-04:00") already
 * names an instant and is returned unchanged. A value with no offset is local
 * wall-clock time in the given IANA timezone and must be converted to a UTC
 * instant here, in Node — never by handing a naive string to Postgres — so
 * that DST-ambiguous and DST-nonexistent local times are detected rather
 * than silently resolved.
 *
 * There is no date library in this repo. The conversion uses the standard
 * two-offset technique: ask Intl.DateTimeFormat what offset applies a day
 * before and a day after the wall-clock instant, then invert it.
 *
 * GRAMMAR — this file is the single source of truth. `inference.ts` samples
 * cells to decide whether a column is ≥95% datetime, and that guarantee only
 * holds if `import.load` (this module) parses each cell with the exact same
 * rule that counted it as a match. Two independently hand-written regexes
 * drift (see git history / the kernel review that found it) — inference.ts
 * MUST import `matchDatetimeGrammar` and `DatetimeOffsetKind` from here
 * instead of re-declaring its own DATETIME_PATTERN/matchDatetime.
 */

export const ISO_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/

const DAY_MS = 24 * 60 * 60 * 1000

export type DatetimeConversionResult =
  | { kind: "ok"; instant: Date }
  | { kind: "ambiguous"; instant: Date } // fall-back overlap, resolved to the earlier instant
  | { kind: "nonexistent"; instant: Date } // spring-forward gap, resolved forward
  | { kind: "unparseable" }

export type ParsedDatetime = {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
  offsetMinutes: number | null // null means the source string carried no offset
}

/** "explicit" carries its own offset (keeps its instant); "naive" has none (local wall-clock). */
export type DatetimeOffsetKind = "explicit" | "naive"

export function convertToInstant(value: string, timeZone: string): DatetimeConversionResult {
  const parsed = parseDatetime(value)
  if (parsed === null) {
    return { kind: "unparseable" }
  }

  const wallClockMs = wallClockAsUtcMillis(parsed)

  if (parsed.offsetMinutes !== null) {
    return { kind: "ok", instant: new Date(wallClockMs - parsed.offsetMinutes * 60_000) }
  }

  return resolveLocalWallClock(wallClockMs, timeZone)
}

/**
 * The grammar predicate `inference.ts` must use to decide whether a sampled
 * cell counts toward the datetime threshold. Returns which offset kind
 * matched, or null when `value` is not a datetime this module can convert at
 * all — so "matched here" and "convertible by `convertToInstant`" can never
 * diverge, because both go through `parseDatetime` below.
 */
export function matchDatetimeGrammar(value: string): DatetimeOffsetKind | null {
  const parsed = parseDatetime(value)
  if (parsed === null) {
    return null
  }
  return parsed.offsetMinutes === null ? "naive" : "explicit"
}

/** Trims surrounding whitespace and allows (and discards) fractional seconds. */
function parseDatetime(value: string): ParsedDatetime | null {
  const match = ISO_DATETIME_PATTERN.exec(value.trim())
  if (match === null) {
    return null
  }

  const year = Number(requiredGroup(match, 1))
  const month = Number(requiredGroup(match, 2))
  const day = Number(requiredGroup(match, 3))
  const hour = Number(requiredGroup(match, 4))
  const minute = Number(requiredGroup(match, 5))
  const second = Number(requiredGroup(match, 6))

  if (year < 100 || !isValidCalendarDate(year, month, day)) {
    return null
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return null
  }

  const offsetText = match[7]
  if (offsetText === undefined) {
    return { year, month, day, hour, minute, second, offsetMinutes: null }
  }

  const offsetMinutes = parseOffsetMinutes(offsetText)
  if (offsetMinutes === null) {
    return null
  }

  return { year, month, day, hour, minute, second, offsetMinutes }
}

function requiredGroup(match: RegExpExecArray, index: number): string {
  const value = match[index]
  if (value === undefined) {
    throw new Error("internal: ISO_DATETIME_PATTERN group and index are out of sync")
  }
  return value
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) {
    return false
  }
  return day >= 1 && day <= daysInMonth(year, month)
}

function daysInMonth(year: number, month: number): number {
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const daysByMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return daysByMonth[month - 1] ?? 31
}

function parseOffsetMinutes(offset: string): number | null {
  if (offset === "Z") {
    return 0
  }
  const sign = offset.startsWith("-") ? -1 : 1
  const hours = Number(offset.slice(1, 3))
  const minutes = Number(offset.slice(4, 6))
  if (hours > 23 || minutes > 59) {
    return null
  }
  return sign * (hours * 60 + minutes)
}

function wallClockAsUtcMillis(parsed: ParsedDatetime): number {
  return Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second,
  )
}

/**
 * Resolves a naive wall-clock time (expressed as if it were UTC millis) to
 * the instant it names in `timeZone`, by bracketing it with the offset a day
 * before and a day after. When those offsets differ, a DST transition falls
 * somewhere in between and each candidate instant is checked for
 * self-consistency: does converting it back to `timeZone` reproduce the
 * offset it was built from?
 *
 * - Neither candidate is consistent -> the wall-clock time was skipped by a
 *   spring-forward gap ("nonexistent"); resolve forward to the later one.
 * - Both candidates are consistent -> the wall-clock time occurred twice in
 *   a fall-back overlap ("ambiguous"); resolve to the earlier one.
 * - Exactly one is consistent -> the wall-clock time is on a day that has a
 *   transition but is not itself near it; that one instant is unambiguous.
 */
function resolveLocalWallClock(wallClockMs: number, timeZone: string): DatetimeConversionResult {
  const offsetBefore = offsetMinutesAt(wallClockMs - DAY_MS, timeZone)
  const offsetAfter = offsetMinutesAt(wallClockMs + DAY_MS, timeZone)

  if (offsetBefore === offsetAfter) {
    return { kind: "ok", instant: new Date(wallClockMs - offsetBefore * 60_000) }
  }

  const candidateUsingBefore = wallClockMs - offsetBefore * 60_000
  const candidateUsingAfter = wallClockMs - offsetAfter * 60_000
  const consistentBefore = offsetMinutesAt(candidateUsingBefore, timeZone) === offsetBefore
  const consistentAfter = offsetMinutesAt(candidateUsingAfter, timeZone) === offsetAfter

  if (consistentBefore && consistentAfter) {
    const earlier = Math.min(candidateUsingBefore, candidateUsingAfter)
    return { kind: "ambiguous", instant: new Date(earlier) }
  }

  if (consistentBefore) {
    return { kind: "ok", instant: new Date(candidateUsingBefore) }
  }
  if (consistentAfter) {
    return { kind: "ok", instant: new Date(candidateUsingAfter) }
  }

  const later = Math.max(candidateUsingBefore, candidateUsingAfter)
  return { kind: "nonexistent", instant: new Date(later) }
}

/** The timezone's offset (in minutes, local minus UTC) at the given instant. */
function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs))

  const part = (type: string): number => {
    const found = parts.find((p) => p.type === type)
    if (found === undefined) {
      throw new Error(`internal: Intl.DateTimeFormat did not return a "${type}" part`)
    }
    return Number(found.value)
  }

  // Some ICU builds report midnight as hour "24" under hour12:false; normalize
  // it to 0 so Date.UTC below doesn't roll the date forward by a day.
  const hour = part("hour") % 24
  const wallClockAsUtcMs = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    hour,
    part("minute"),
    part("second"),
  )
  return (wallClockAsUtcMs - instantMs) / 60_000
}
