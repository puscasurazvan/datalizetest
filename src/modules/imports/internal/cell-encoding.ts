/**
 * Turns one raw CSV cell into the exact textual encoding `AnalyticalStore`
 * expects (`AnalyticalRow` — a `decimal` cell is a decimal literal string
 * with no loss of precision, a `timestamptz` cell an offset-bearing
 * ISO-8601 string, docs/decisions/06 #11). This is `import.load`'s cell
 * validation gate: every value reaches `COPY` only after passing the exact
 * same predicate that counted it as a match during inference
 * (../internal/inference.ts's module doc) — `COPY` is all-or-nothing, so a
 * value that would fail Postgres's own cast aborts the *entire* load with
 * an error naming the physical table, which every value here must avoid
 * reaching in the first place.
 *
 * An empty cell is `NULL` (docs/decisions/06 #3) for every type — checked
 * once, before the per-type switch, so no branch below needs to repeat it.
 */
import { parsesAsBoolean, parsesAsDate, parsesAsDecimal, parsesAsInteger } from "./inference"
import type { DatalizeType } from "./inference"
import { convertToInstant } from "./datetime"

export type CellEncodingResult =
  | { readonly kind: "null" }
  | { readonly kind: "ok"; readonly value: string }
  | { readonly kind: "unparseable" }
  | { readonly kind: "ambiguous"; readonly value: string }
  | { readonly kind: "nonexistent"; readonly value: string }
  | { readonly kind: "encoding" }

/**
 * A NUL byte (U+0000) is valid UTF-8 — Node's decoder passes it through
 * unchanged rather than replacing it — so it reaches this function like any
 * other character. `copy-encoding.ts`'s escaping only covers `\`, tab, LF,
 * CR; Postgres's `COPY` protocol rejects a NUL outright
 * (`invalid byte sequence for encoding "UTF8"`), and `COPY` is
 * all-or-nothing, so one such cell — in any column, not just `string` —
 * would otherwise abort the entire load. Checked once, before the per-type
 * switch, the same way the empty-cell check above is: every branch below
 * already rejects a non-numeric/non-boolean/non-date cell on its own
 * predicate, but `string`'s branch passes `raw` through unvalidated, so
 * this is the one check every type actually needs from this function.
 */
function containsNulByte(raw: string): boolean {
  return raw.includes("\0")
}

const TRUE_LITERALS = new Set(["true", "yes"])

/** "true"/"yes" -> "true", "false"/"no" -> "false" — Postgres `boolean`'s two literals. */
function normalizeBoolean(raw: string): string {
  return TRUE_LITERALS.has(raw.trim().toLowerCase()) ? "true" : "false"
}

/**
 * `parsesAsDecimal` (../internal/inference.ts) accepts comma
 * thousands-grouping ("1,234.56") as a legitimate plain numeric format,
 * but Postgres `numeric`'s input syntax does not — grouping commas must be
 * stripped before the value reaches `COPY`, after already having been
 * validated as decimal-shaped.
 */
function normalizeDecimal(raw: string): string {
  return raw.trim().replaceAll(",", "")
}

/**
 * Encodes one raw cell for column `type`, using `timezone` to resolve a
 * naive (no-offset) `timestamptz` value (docs/adr/0004). `ambiguous` and
 * `nonexistent` both carry the instant `convertToInstant` resolved to —
 * decisions/06's "ambiguous and nonexistent DST local times are counted
 * and reported, not silently resolved" means loud, not `NULL`: the value
 * is still loaded (a real, if picked-between-two, instant), and the caller
 * separately records an `import_errors` row for it.
 */
export function encodeCell(raw: string, type: DatalizeType, timezone: string): CellEncodingResult {
  if (raw === "") {
    return { kind: "null" }
  }

  if (containsNulByte(raw)) {
    return { kind: "encoding" }
  }

  switch (type) {
    case "string":
      return { kind: "ok", value: raw }
    case "integer":
      return parsesAsInteger(raw) ? { kind: "ok", value: raw.trim() } : { kind: "unparseable" }
    case "decimal":
      return parsesAsDecimal(raw)
        ? { kind: "ok", value: normalizeDecimal(raw) }
        : { kind: "unparseable" }
    case "boolean":
      return parsesAsBoolean(raw)
        ? { kind: "ok", value: normalizeBoolean(raw) }
        : { kind: "unparseable" }
    case "date":
      return parsesAsDate(raw) ? { kind: "ok", value: raw.trim() } : { kind: "unparseable" }
    case "timestamptz":
      return encodeTimestamptz(raw, timezone)
  }
}

function encodeTimestamptz(raw: string, timezone: string): CellEncodingResult {
  const result = convertToInstant(raw, timezone)
  if (result.kind === "unparseable") {
    return { kind: "unparseable" }
  }
  return { kind: result.kind, value: result.instant.toISOString() }
}
