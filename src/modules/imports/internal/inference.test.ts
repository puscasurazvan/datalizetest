import { matchDatetimeGrammar } from "./datetime"
import { describe, expect, it } from "vitest"

import {
  inferColumns,
  matchDatetime,
  parsesAsBoolean,
  parsesAsDecimal,
  parsesAsInteger,
} from "./inference"

/** One-column convenience: builds the sample-rows shape `inferColumns` expects from a flat value list. */
function column(header: string, values: readonly string[]) {
  return inferColumns(
    [header],
    values.map((value) => [value]),
  )
}

describe("inferColumns — numeric identifiers vs numbers (decisions/06 #2)", () => {
  it("infers leading-zero digit strings as string, not integer", () => {
    const [result] = column("account_id", ["0001234", "0005678", "0009999"])

    expect(result?.type).toBe("string")
    expect(result?.unparseableCount).toBe(0)
  })

  it("still infers bare '0' as integer — the leading-zero rule only rejects multi-digit values", () => {
    const [result] = column("count", ["0", "0", "0"])

    expect(result?.type).toBe("integer")
  })

  it("directly: parsesAsInteger rejects a multi-digit leading zero but accepts '0'", () => {
    expect(parsesAsInteger("0001234")).toBe(false)
    expect(parsesAsInteger("0")).toBe(true)
    expect(parsesAsInteger("-42")).toBe(true)
  })
})

describe("inferColumns — currency symbols and thousands separators", () => {
  it("infers comma-grouped decimals without a currency symbol as decimal", () => {
    const [result] = column("amount", ["1,234.56", "999.00", "10,000.00"])

    expect(result?.type).toBe("decimal")
  })

  it("infers a plain decimal with no grouping as decimal", () => {
    const [result] = column("amount", ["1234.56", "42.00", "0.5"])

    expect(result?.type).toBe("decimal")
  })

  it("infers a leading currency symbol as string — a symbol ties the value to an unstated currency", () => {
    const [result] = column("amount", ["$1,234.56", "$999.00", "$10,000.00"])

    expect(result?.type).toBe("string")
  })

  it("directly: parsesAsDecimal accepts comma grouping and rejects a currency symbol", () => {
    expect(parsesAsDecimal("1,234.56")).toBe(true)
    expect(parsesAsDecimal("1234.56")).toBe(true)
    expect(parsesAsDecimal("$1,234.56")).toBe(false)
    expect(parsesAsDecimal("0001234")).toBe(false)
  })
})

describe("inferColumns — the 95% threshold (decisions/06 #2, #4)", () => {
  it("infers decimal with one unparseable value reported, not widened to string", () => {
    const values = [...Array.from({ length: 9_999 }, () => "10.00"), "N/A"]

    const [result] = column("amount", values)

    expect(result?.type).toBe("decimal")
    expect(result?.unparseableCount).toBe(1)
    // The unparseable value becomes NULL at load (decisions/06 #4), same as an empty cell would —
    // so the column is nullable even though no cell here was actually empty.
    expect(result?.nullable).toBe(true)
  })

  it("falls back to string when only 90% of values parse as integer", () => {
    const integers = Array.from({ length: 90 }, (_, i) => String(i))
    const words = Array.from({ length: 10 }, () => "banana")

    const [result] = column("mixed", [...integers, ...words])

    expect(result?.type).toBe("string")
    expect(result?.unparseableCount).toBe(0)
  })

  it("only samples the first 10,000 rows — a dirty tail beyond the sample cannot flip the type back", () => {
    // First 10,000: 9,600 valid decimals then 400 "N/A" — 96% match, at/above threshold, so decimal.
    // Without the cap, appending 5,000 more "N/A" beyond row 10,000 drags the file-wide rate to 64%
    // (9,600 / 15,000), which is below threshold — so this fixture only stays `decimal` if the
    // 10,000-row cap (decisions/06 #2) is actually applied, not merely if the tail happens to agree.
    const firstTenThousand = [
      ...Array.from({ length: 9_600 }, () => "10.00"),
      ...Array.from({ length: 400 }, () => "N/A"),
    ]
    const beyondSample = Array.from({ length: 5_000 }, () => "N/A")

    const [result] = column("amount", [...firstTenThousand, ...beyondSample])

    expect(result?.type).toBe("decimal")
    expect(result?.unparseableCount).toBe(400)
  })
})

describe("inferColumns — boolean literals (decisions/06 narrowest-first order)", () => {
  it.each([
    ["true", "false"],
    ["TRUE", "FALSE"],
    ["yes", "no"],
    ["Yes", "No"],
  ])("infers boolean for the literal pair %s/%s", (positive, negative) => {
    const [result] = column("flag", [positive, negative, positive, negative])

    expect(result?.type).toBe("boolean")
  })

  it("infers integer, not boolean, for a column of bare 0/1 — a bare digit is a number first", () => {
    const [result] = column("seats", ["0", "1", "1", "0", "1"])

    expect(result?.type).toBe("integer")
  })

  it("does not treat 'y'/'n' as boolean literals — outside the closed set, falls back to string", () => {
    const [result] = column("flag", ["y", "n", "y", "n"])

    expect(result?.type).toBe("string")
  })

  it("directly: parsesAsBoolean is case-insensitive over exactly true/false/yes/no", () => {
    expect(parsesAsBoolean("true")).toBe(true)
    expect(parsesAsBoolean("TRUE")).toBe(true)
    expect(parsesAsBoolean("yes")).toBe(true)
    expect(parsesAsBoolean("No")).toBe(true)
    expect(parsesAsBoolean("1")).toBe(false)
    expect(parsesAsBoolean("0")).toBe(false)
    expect(parsesAsBoolean("y")).toBe(false)
  })
})

describe("inferColumns — empty cells and nullability (decisions/06 #3)", () => {
  it("infers string, nullable for an all-empty column", () => {
    const [result] = column("notes", ["", "", "", "", ""])

    expect(result?.type).toBe("string")
    expect(result?.nullable).toBe(true)
    expect(result?.unparseableCount).toBe(0)
  })

  it("excludes empty cells from the parse-rate denominator", () => {
    // 20 valid decimals + 1 bad value among 21 non-empty cells = 95.2%, at the threshold.
    // 5 empty cells are excluded from that denominator entirely, but still mark nullable.
    const decimals = Array.from({ length: 20 }, () => "10.00")
    const values = [...decimals, "N/A", "", "", "", "", ""]

    const [result] = column("amount", values)

    expect(result?.type).toBe("decimal")
    expect(result?.nullable).toBe(true)
    expect(result?.unparseableCount).toBe(1)
  })

  it("treats a ragged row (missing trailing cell) as an empty cell, not a crash", () => {
    const result = inferColumns(["id", "amount"], [["1", "10.00"], ["2"]])

    expect(result).toHaveLength(2)
    expect(result[1]?.nullable).toBe(true)
  })

  it("marks nullable when the only NULLs come from unparseable values, not empty cells (decisions/06 #4)", () => {
    // No empty cell here at all — but decisions/06 #4 turns each unparseable value into a NULL at
    // load, same as an empty cell. A column reported nullable:false would create the physical
    // column NOT NULL and the load of that same "N/A" cell would then fail outright.
    const decimals = Array.from({ length: 96 }, () => "10.00")
    const [result] = column("amount", [...decimals, "N/A", "N/A", "N/A", "N/A"])

    expect(result?.type).toBe("decimal")
    expect(result?.unparseableCount).toBe(4)
    expect(result?.nullable).toBe(true)
  })
})

describe("inferColumns — integer vs decimal overlap", () => {
  it("infers integer when every value parses as both integer and decimal", () => {
    const [result] = column("count", ["42", "100", "7", "-3"])

    expect(result?.type).toBe("integer")
  })

  it("infers decimal, not integer, when the sample has whole and fractional values (decisions/06 #4)", () => {
    // decimal is a strict superset of integer, so integer is only lossless when the two counts tie.
    // Here decimal reaches 100/100 (100%) while integer only reaches 96/100 (96%) — both clear the
    // 95% threshold, so this is a real precedence choice, not a fallback from integer failing.
    // Picking `integer` would NULL the four fractional values at load (decisions/06 #4); picking
    // `decimal` loses nothing, since every whole number is also a valid decimal.
    const wholeNumbers = Array.from({ length: 96 }, () => "100")
    const fractional = Array.from({ length: 4 }, () => "99.99")

    const [result] = column("amount", [...wholeNumbers, ...fractional])

    expect(result?.type).toBe("decimal")
    expect(result?.unparseableCount).toBe(0)
  })
})

describe("inferColumns — date", () => {
  it("infers date for calendar dates", () => {
    const [result] = column("signup_date", ["2026-01-15", "2026-02-20", "2026-12-31"])

    expect(result?.type).toBe("date")
  })

  it("rejects an invalid calendar date (Feb 30) — falls back to string below threshold", () => {
    const [result] = column("signup_date", ["2026-02-30", "2026-02-30", "2026-02-30"])

    expect(result?.type).toBe("string")
  })
})

describe("inferColumns — timestamptz offset distinction (docs/adr/0004, docs/decisions/03)", () => {
  it("infers timestamptz with datetimeOffset 'explicit' when every value carries an offset", () => {
    const [result] = column("created_at", [
      "2026-09-01T09:15:00Z",
      "2026-09-01T10:00:00+01:00",
      "2026-09-01T05:00:00-05:00",
    ])

    expect(result?.type).toBe("timestamptz")
    expect(result?.datetimeOffset).toBe("explicit")
  })

  it("infers timestamptz with datetimeOffset 'naive' when no value carries an offset", () => {
    const [result] = column("created_at", [
      "2026-09-01 09:15:00",
      "2026-09-01T10:00:00",
      "2026-09-01 05:00:00",
    ])

    expect(result?.type).toBe("timestamptz")
    expect(result?.datetimeOffset).toBe("naive")
  })

  it("infers timestamptz with datetimeOffset 'mixed' when both forms are present", () => {
    const [result] = column("created_at", ["2026-09-01T09:15:00Z", "2026-09-01 10:00:00"])

    expect(result?.type).toBe("timestamptz")
    expect(result?.datetimeOffset).toBe("mixed")
  })

  it("omits datetimeOffset entirely when the column does not infer as datetime", () => {
    const [result] = column("notes", ["hello", "world"])

    expect(result?.type).toBe("string")
    expect(result?.datetimeOffset).toBeUndefined()
  })

  it("directly: matchDatetime distinguishes offset from naive and rejects an invalid time", () => {
    expect(matchDatetime("2026-09-01T09:15:00Z")).toBe("explicit")
    expect(matchDatetime("2026-09-01T09:15:00+01:00")).toBe("explicit")
    expect(matchDatetime("2026-09-01T09:15:00")).toBe("naive")
    expect(matchDatetime("2026-09-01 09:15:00")).toBe("naive")
    expect(matchDatetime("2026-09-01T25:00:00")).toBeNull()
    expect(matchDatetime("2026-09-01")).toBeNull()
  })

  it("directly: matchDatetime accepts fractional seconds and surrounding whitespace", () => {
    // This is the grammar import.load's datetime converter must agree with exactly (module header
    // above, "Re-implementing the grammar at load time would let the two silently drift") — pinned
    // here so a future edit to DATETIME_PATTERN can't narrow it without a visible test failure.
    expect(matchDatetime("2026-09-01T09:15:00.123Z")).toBe("explicit")
    expect(matchDatetime("2026-09-01 09:15:00.5")).toBe("naive")
    expect(matchDatetime(" 2026-09-01T09:15:00Z ")).toBe("explicit")
  })
})

describe("inferColumns — header handling (decisions/06 #6)", () => {
  it("strips a BOM from the first header only", () => {
    const result = inferColumns(["\uFEFFid", "\uFEFFname"], [["1", "a"]])

    expect(result[0]?.name).toBe("id")
    expect(result[0]?.headerIssues).toEqual(["bom_stripped"])
    expect(result[0]?.headerRenamed).toBe(true)
    // A BOM in a non-first header is not given the special-cased "bom_stripped" issue (the rule is
    // "the first header" only) — but it is still whitespace under JS's `trim()`, so the ordinary
    // header-trimming step (decisions/06 #6) removes it here too, silently, same as trailing spaces.
    expect(result[1]?.name).toBe("name")
    expect(result[1]?.headerRenamed).toBe(false)
  })

  it("substitutes column_{position} for a blank header", () => {
    const result = inferColumns(["id", "", "name"], [["1", "x", "a"]])

    expect(result[1]?.name).toBe("column_2")
    expect(result[1]?.headerIssues).toEqual(["blank_header"])
    expect(result[1]?.headerRenamed).toBe(true)
  })

  it("reports both bom_stripped and blank_header when the first header is only a BOM", () => {
    const result = inferColumns(["\uFEFF", "name"], [["1", "a"]])

    expect(result[0]?.name).toBe("column_1")
    expect(result[0]?.headerIssues).toEqual(["bom_stripped", "blank_header"])
  })

  it("suffixes _{position} onto the second and later occurrence of a duplicate header", () => {
    const result = inferColumns(["amount", "id", "amount", "amount"], [["1", "x", "2", "3"]])

    expect(result[0]?.name).toBe("amount")
    expect(result[0]?.headerRenamed).toBe(false)
    expect(result[2]?.name).toBe("amount_3")
    expect(result[2]?.headerIssues).toEqual(["duplicate_header"])
    expect(result[3]?.name).toBe("amount_4")
  })

  it("does not collide when a suffixed name matches a later literal header (decisions/06 #6)", () => {
    // The second "amount" is suffixed to "amount_2". The third header is the literal string
    // "amount_2" — without registering the suffixed *result*, this produces two columns both
    // named "amount_2", breaking unique(dataset_version_id, name).
    const result = inferColumns(["amount", "amount", "amount_2"], [["1", "2", "3"]])
    const names = result.map((c) => c.name)

    expect(new Set(names).size).toBe(3)
    expect(names[1]).toBe("amount_2")
    // The collision the rename would otherwise cause is itself a duplicate that must be reported.
    expect(result[2]?.headerIssues).toContain("duplicate_header")
  })

  it("does not collide when a suffixed name matches an earlier literal header", () => {
    const result = inferColumns(["a_3", "a", "a", "a"], [["1", "2", "3", "4"]])
    const names = result.map((c) => c.name)

    expect(new Set(names).size).toBe(4)
  })

  it("trims header whitespace before comparing for blank/duplicate, without reporting the trim itself", () => {
    const result = inferColumns(["amount", "amount "], [["1", "2"]])

    expect(result[0]?.name).toBe("amount")
    expect(result[0]?.headerRenamed).toBe(false)
    expect(result[1]?.name).toBe("amount_2")
    // Only duplicate_header is reported — trimming is not one of the three continuity-breaking events.
    expect(result[1]?.headerIssues).toEqual(["duplicate_header"])
  })

  it("carries position and originalHeader through unchanged for a normal header", () => {
    const result = inferColumns(["customer_name"], [["Ada"]])

    expect(result[0]?.position).toBe(1)
    expect(result[0]?.originalHeader).toBe("customer_name")
    expect(result[0]?.name).toBe("customer_name")
    expect(result[0]?.headerRenamed).toBe(false)
    expect(result[0]?.headerIssues).toEqual([])
  })
})

describe("inferColumns — column order and shape", () => {
  it("describes every header column in order, even when sample rows are empty", () => {
    const result = inferColumns(["id", "amount", "created_at"], [])

    expect(result.map((c) => c.name)).toEqual(["id", "amount", "created_at"])
    expect(result.every((c) => c.type === "string" && c.nullable === false)).toBe(true)
  })

  it("describes a realistic mixed row shaped like transactions_stripe.csv (docs/decisions/01)", () => {
    const header = ["id", "amount", "currency", "status", "created_at", "plan_name"]
    const rows = [
      ["txn_1", "19.99", "USD", "succeeded", "2026-01-05T10:00:00Z", "pro"],
      ["txn_2", "29.99", "USD", "succeeded", "2026-01-06T11:30:00Z", ""],
      ["txn_3", "9.99", "GBP", "refunded", "2026-01-07T09:15:00+00:00", "starter"],
    ]

    const result = inferColumns(header, rows)
    const byName = new Map(result.map((c) => [c.name, c]))

    expect(byName.get("id")?.type).toBe("string")
    expect(byName.get("amount")?.type).toBe("decimal")
    expect(byName.get("currency")?.type).toBe("string")
    expect(byName.get("status")?.type).toBe("string")
    expect(byName.get("created_at")?.type).toBe("timestamptz")
    expect(byName.get("created_at")?.datetimeOffset).toBe("explicit")
    expect(byName.get("plan_name")?.nullable).toBe(true)
  })
})

describe("datetime grammar agreement with the loader", () => {
  // These two modules drifted once: inference accepted values the loader then
  // rejected, so a column inferred as a clean timestamptz loaded as all NULL.
  // matchDatetime now delegates, and these pin that it stays delegated.
  const cases = [
    "2026-09-01T09:15:00Z",
    "2026-09-01 09:15:00",
    "2026-09-01T09:15:00.123Z",
    "  2026-09-01 09:15:00  ",
    "0099-01-01T00:00:00Z", // year below 100 — the loader rejects it
    "2026-09-01T25:00:00Z", // impossible hour
    "2026-02-30 09:15:00", // impossible day
    "not a datetime",
  ]

  it.each(cases)("agrees with matchDatetimeGrammar on %j", (value) => {
    expect(matchDatetime(value)).toEqual(matchDatetimeGrammar(value))
  })
})
