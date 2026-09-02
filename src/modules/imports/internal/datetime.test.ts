import { describe, expect, it } from "vitest"

import { convertToInstant, matchDatetimeGrammar } from "./datetime"

describe("convertToInstant", () => {
  describe("naive local time (no offset in the source value)", () => {
    it("converts BST (Europe/London, UTC+1) to its UTC instant", () => {
      const result = convertToInstant("2026-09-01 09:15:00", "Europe/London")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-09-01T08:15:00Z") })
    })

    it("converts GMT (Europe/London, UTC+0) to its UTC instant", () => {
      const result = convertToInstant("2026-01-15 09:15:00", "Europe/London")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-01-15T09:15:00Z") })
    })

    it("reports a spring-forward gap as nonexistent, resolved forward", () => {
      // America/New_York jumps 02:00 -> 03:00 on 2026-03-08. 02:30 never occurs;
      // resolving forward means the instant that would have been 02:30 EST is
      // read as 03:30 EDT once the gap has passed.
      const result = convertToInstant("2026-03-08 02:30:00", "America/New_York")

      expect(result).toEqual({ kind: "nonexistent", instant: new Date("2026-03-08T07:30:00Z") })
    })

    it("reports a fall-back overlap as ambiguous, resolved to the earlier instant", () => {
      // America/New_York repeats 01:00-02:00 on 2026-11-01: once as EDT (earlier),
      // once as EST (later). The earlier (EDT) instant wins.
      const result = convertToInstant("2026-11-01 01:30:00", "America/New_York")

      expect(result).toEqual({ kind: "ambiguous", instant: new Date("2026-11-01T05:30:00Z") })
    })

    it("resolves a time earlier the same day as the spring-forward gap normally", () => {
      const result = convertToInstant("2026-03-08 00:30:00", "America/New_York")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-03-08T05:30:00Z") })
    })

    it("resolves a time later the same day as the spring-forward gap normally", () => {
      const result = convertToInstant("2026-03-08 03:30:00", "America/New_York")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-03-08T07:30:00Z") })
    })

    it("resolves a time earlier the same day as the fall-back overlap normally", () => {
      const result = convertToInstant("2026-11-01 00:30:00", "America/New_York")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-11-01T04:30:00Z") })
    })

    it("resolves a time later the same day as the fall-back overlap normally", () => {
      const result = convertToInstant("2026-11-01 03:30:00", "America/New_York")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-11-01T08:30:00Z") })
    })

    it("round-trips exactly in a timezone with no DST", () => {
      const result = convertToInstant("2026-06-15 12:00:00", "UTC")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-06-15T12:00:00Z") })
    })

    it("accepts a 'T' separator as well as a space", () => {
      const result = convertToInstant("2026-01-15T09:15:00", "Europe/London")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-01-15T09:15:00Z") })
    })

    it("resolves local midnight correctly (guards the ICU '24:00' quirk)", () => {
      const result = convertToInstant("2026-01-15 00:00:00", "Europe/London")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-01-15T00:00:00Z") })
    })
  })

  describe("explicit offset (keeps its instant, ignores the given timezone)", () => {
    it("keeps a 'Z' instant unchanged regardless of timezone", () => {
      const inLondon = convertToInstant("2026-09-01T09:15:00Z", "Europe/London")
      const inNewYork = convertToInstant("2026-09-01T09:15:00Z", "America/New_York")

      expect(inLondon).toEqual({ kind: "ok", instant: new Date("2026-09-01T09:15:00Z") })
      expect(inNewYork).toEqual({ kind: "ok", instant: new Date("2026-09-01T09:15:00Z") })
    })

    it("keeps a negative-offset instant unchanged regardless of timezone", () => {
      const result = convertToInstant("2026-09-01T09:15:00-04:00", "Europe/London")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-09-01T13:15:00Z") })
    })

    it("keeps a positive-offset instant unchanged", () => {
      const result = convertToInstant("2026-09-01T09:15:00+02:00", "America/New_York")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-09-01T07:15:00Z") })
    })
  })

  describe("unparseable input", () => {
    it("rejects garbage", () => {
      expect(convertToInstant("not-a-date", "UTC")).toEqual({ kind: "unparseable" })
    })

    it("rejects an empty string", () => {
      expect(convertToInstant("", "UTC")).toEqual({ kind: "unparseable" })
    })

    it("rejects an out-of-range month", () => {
      expect(convertToInstant("2026-13-01T00:00:00Z", "UTC")).toEqual({ kind: "unparseable" })
    })

    it("rejects a day that does not exist in the given month", () => {
      expect(convertToInstant("2026-02-30 10:00:00", "UTC")).toEqual({ kind: "unparseable" })
    })

    it("accepts February 29 on a leap year", () => {
      const result = convertToInstant("2028-02-29T00:00:00Z", "UTC")

      expect(result).toEqual({ kind: "ok", instant: new Date("2028-02-29T00:00:00Z") })
    })

    it("rejects February 29 on a non-leap year", () => {
      expect(convertToInstant("2026-02-29T00:00:00Z", "UTC")).toEqual({ kind: "unparseable" })
    })

    it("rejects an out-of-range hour", () => {
      expect(convertToInstant("2026-09-01T24:00:00Z", "UTC")).toEqual({ kind: "unparseable" })
    })

    it("rejects a two-digit year masquerading as a four-digit one", () => {
      // \d{4} alone would let "0050" parse as the year 50 AD, which Date.UTC
      // silently maps to 1950 -- a wrong instant with nothing to flag it.
      expect(convertToInstant("0050-01-01T00:00:00Z", "UTC")).toEqual({ kind: "unparseable" })
    })

    it("rejects an out-of-range offset", () => {
      expect(convertToInstant("2026-09-01T09:15:00+99:99", "UTC")).toEqual({
        kind: "unparseable",
      })
    })
  })

  describe("fractional seconds (grammar drift regression)", () => {
    // inference.ts's DATETIME_PATTERN has always allowed a trailing `.123`;
    // this module's grammar must accept exactly the same shapes, or a column
    // sampled as 100% datetime by inference.ts loads as 100% NULL here.
    it("accepts fractional seconds on an explicit-offset value, discarding sub-second precision", () => {
      const result = convertToInstant("2026-09-01T09:15:00.123Z", "UTC")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-09-01T09:15:00Z") })
    })

    it("accepts fractional seconds on a naive value", () => {
      const result = convertToInstant("2026-09-01 09:15:00.500", "UTC")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-09-01T09:15:00Z") })
    })

    it("accepts many fractional digits, not just three", () => {
      const result = convertToInstant("2026-09-01T09:15:00.123456Z", "UTC")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-09-01T09:15:00Z") })
    })
  })

  describe("surrounding whitespace (grammar drift regression)", () => {
    // Every parsesAs*/matchDatetime predicate in inference.ts trims before
    // testing; convertToInstant must trim too, or a value inference counted
    // as a match fails to parse at load.
    it("accepts a value padded with leading and trailing whitespace", () => {
      const result = convertToInstant(" 2026-09-01T09:15:00Z ", "UTC")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-09-01T09:15:00Z") })
    })

    it("accepts a naive value padded with whitespace", () => {
      const result = convertToInstant("  2026-09-01 09:15:00  ", "UTC")

      expect(result).toEqual({ kind: "ok", instant: new Date("2026-09-01T09:15:00Z") })
    })
  })
})

describe("matchDatetimeGrammar", () => {
  // This is the single grammar predicate inference.ts must import instead of
  // maintaining its own DATETIME_PATTERN/matchDatetime -- see the module
  // header. These cases pin the shape inference.ts depends on: whichever
  // offset kind it reports for a sampled value, convertToInstant must be
  // able to actually convert that same value.
  it("reports 'explicit' for an offset-bearing value, trimmed and with fractional seconds", () => {
    expect(matchDatetimeGrammar(" 2026-09-01T09:15:00.123Z ")).toBe("explicit")
  })

  it("reports 'naive' for a no-offset value, trimmed and with fractional seconds", () => {
    expect(matchDatetimeGrammar(" 2026-09-01 09:15:00.500 ")).toBe("naive")
  })

  it("returns null for a value that fails the grammar", () => {
    expect(matchDatetimeGrammar("not-a-date")).toBeNull()
  })

  it("returns null for an out-of-range calendar date", () => {
    expect(matchDatetimeGrammar("2026-02-30T00:00:00Z")).toBeNull()
  })

  describe("agreement with convertToInstant (the grammar drift this module exists to prevent)", () => {
    const cases: readonly string[] = [
      "2026-09-01T09:15:00Z",
      "2026-09-01T09:15:00.123Z",
      "2026-09-01T09:15:00.123456Z",
      "2026-09-01 09:15:00",
      "2026-09-01 09:15:00.5",
      " 2026-09-01T09:15:00Z ",
      "2026-09-01T09:15:00-04:00",
      "not-a-date",
      "2026-13-01T00:00:00Z",
      "2026-02-30 10:00:00",
      "2026-09-01T09:15:00+99:99",
      "0050-01-01T00:00:00Z",
    ]

    it.each(cases)("%s: matched by one predicate iff convertible by the other", (value) => {
      const matched = matchDatetimeGrammar(value) !== null
      const converted = convertToInstant(value, "UTC").kind !== "unparseable"
      expect(converted).toBe(matched)
    })
  })
})
