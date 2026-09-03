/**
 * Encodes one `AnalyticalRow` as a line of Postgres `COPY ... FORMAT text`
 * input (the format `COPY` uses when no `FORMAT` option is given —
 * https://www.postgresql.org/docs/current/sql-copy.html "File Formats:
 * Text Format"). Pure and separately tested so postgres-store.ts's
 * integration test only has to prove the DB round-trip, not this escaping.
 *
 * Values are never re-typed here: every cell already arrived as its
 * column's textual encoding (`AnalyticalRow`'s doc comment — a `timestamptz`
 * cell is an offset-bearing ISO-8601 string, a `decimal` cell a decimal
 * literal), and `COPY` casts each column's text to its physical Postgres
 * type itself. So a `CopyColumn` only needs a `columnId` to look the value
 * up by and its physical column's position — no `AnalyticalColumnType` in
 * sight.
 */

/**
 * Text-format `COPY` reserves four characters and requires them backslash
 * escaped when they appear in data: backslash itself, tab (the column
 * delimiter), newline, and carriage return. Applied in this order so an
 * escaping backslash introduced by an earlier rule is never re-escaped by
 * a later one.
 */
function escapeCopyText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\t", "\\t")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
}

/**
 * One physical column's copy target: which Column ID's value fills it,
 * ordered exactly as the physical columns appear in the `COPY (...)`
 * column list this line is written for.
 */
export interface CopyColumn {
  readonly columnId: string
}

/**
 * Encodes `row` as one COPY text-format line (no trailing newline — the
 * caller appends the line separator between rows). `\N` is Postgres's
 * default text-format NULL marker; a value not present in `row` at all is
 * treated the same as an explicit `null` rather than rejected, matching
 * the "empty cell is NULL" convention import.profile already applies
 * upstream (docs/decisions/06 #3) — this module has no independent reason
 * to be stricter about a missing key than that convention already is.
 *
 * Throws if `row` carries a key naming a Column ID that is not one of
 * `columns` — that is a caller bug (a row shaped for a different Dataset
 * Version, most likely), and silently dropping the extra value would hide
 * it rather than surface it.
 */
export function encodeCopyLine(
  row: Readonly<Record<string, string | null>>,
  columns: readonly CopyColumn[],
): string {
  const knownColumnIds = new Set(columns.map((column) => column.columnId))
  for (const columnId of Object.keys(row)) {
    if (!knownColumnIds.has(columnId)) {
      throw new Error(`row carries an unmapped Column ID: ${JSON.stringify(columnId)}`)
    }
  }

  return columns
    .map((column) => {
      const value = row[column.columnId]
      if (value === null || value === undefined) {
        return "\\N"
      }
      return escapeCopyText(value)
    })
    .join("\t")
}
