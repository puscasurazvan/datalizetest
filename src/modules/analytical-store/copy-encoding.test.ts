import { describe, expect, it } from "vitest"

import { encodeCopyLine } from "./copy-encoding"

const COLUMNS = [{ columnId: "col_id" }, { columnId: "col_amount" }, { columnId: "col_name" }]

describe("encodeCopyLine", () => {
  it("tab-delimits values in the given column order, not the row's own key order", () => {
    const line = encodeCopyLine({ col_name: "Acme", col_id: "1", col_amount: "10.00" }, COLUMNS)
    expect(line).toBe("1\t10.00\tAcme")
  })

  it("encodes null as the \\N marker", () => {
    const line = encodeCopyLine({ col_id: "1", col_amount: null, col_name: "Acme" }, COLUMNS)
    expect(line).toBe("1\t\\N\tAcme")
  })

  it("treats a missing key the same as an explicit null", () => {
    const line = encodeCopyLine({ col_id: "1", col_name: "Acme" }, COLUMNS)
    expect(line).toBe("1\t\\N\tAcme")
  })

  it("escapes backslash, tab, newline, and carriage return in that order", () => {
    const line = encodeCopyLine(
      { col_id: "1", col_amount: "10.00", col_name: "back\\slash\ttab\nline\rreturn" },
      COLUMNS,
    )
    expect(line).toBe("1\t10.00\tback\\\\slash\\ttab\\nline\\rreturn")
  })

  it("does not double-escape a backslash introduced by an earlier escaping pass", () => {
    // A literal tab character must become "\t" (two characters: backslash,
    // t) -- not "\\t" (backslash escaped again as if it were a literal
    // backslash character).
    const line = encodeCopyLine({ col_id: "1", col_amount: "10.00", col_name: "a\tb" }, COLUMNS)
    expect(line).toBe("1\t10.00\ta\\tb")
  })

  it("throws when a row carries a Column ID that is not in the target columns", () => {
    expect(() =>
      encodeCopyLine(
        { col_id: "1", col_amount: "10.00", col_name: "Acme", col_unknown: "x" },
        COLUMNS,
      ),
    ).toThrow(/col_unknown/)
  })

  it("round-trips an empty row against an empty column list", () => {
    expect(encodeCopyLine({}, [])).toBe("")
  })
})
