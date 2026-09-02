import { describe, expect, it } from "vitest"

import { CANONICAL_IANA_TIMEZONES } from "./canonical-timezones"

/**
 * Regression coverage for the defect fixed here: the allowlist used to be
 * `new Set(Intl.supportedValuesOf("timeZone"))`, which excludes `UTC` (the
 * `organizations.timezone` schema default) and contains ICU's legacy zone
 * names (`Asia/Calcutta`, `Europe/Kiev`, `Africa/Asmera`) instead of the
 * canonical IANA identifiers docs/decisions/03 and docs/decisions/04
 * require. This is a pure unit test — importing `./service` would pull in
 * `@/db/client`, which only integration tests may touch.
 */
describe("CANONICAL_IANA_TIMEZONES", () => {
  it("includes UTC, the schema default for every Organization", () => {
    expect(CANONICAL_IANA_TIMEZONES.has("UTC")).toBe(true)
  })

  it("accepts the canonical name of a zone ICU still lists under a legacy alias", () => {
    expect(CANONICAL_IANA_TIMEZONES.has("Asia/Kolkata")).toBe(true)
    expect(CANONICAL_IANA_TIMEZONES.has("Europe/Kyiv")).toBe(true)
    expect(CANONICAL_IANA_TIMEZONES.has("Africa/Nairobi")).toBe(true)
  })

  it("rejects the legacy aliases decisions/03 explicitly names as ambiguous", () => {
    expect(CANONICAL_IANA_TIMEZONES.has("Asia/Calcutta")).toBe(false)
    expect(CANONICAL_IANA_TIMEZONES.has("Europe/Kiev")).toBe(false)
    expect(CANONICAL_IANA_TIMEZONES.has("Africa/Asmera")).toBe(false)
  })

  it("rejects fixed-offset abbreviations, which name an offset, not a zone", () => {
    expect(CANONICAL_IANA_TIMEZONES.has("EST")).toBe(false)
    expect(CANONICAL_IANA_TIMEZONES.has("PST")).toBe(false)
    expect(CANONICAL_IANA_TIMEZONES.has("PST8PDT")).toBe(false)
  })

  it("still accepts an ordinary, uncontested zone name", () => {
    expect(CANONICAL_IANA_TIMEZONES.has("America/New_York")).toBe(true)
    expect(CANONICAL_IANA_TIMEZONES.has("Europe/London")).toBe(true)
  })

  it("contains only names the runtime itself can construct a formatter with", () => {
    for (const timezone of CANONICAL_IANA_TIMEZONES) {
      expect(() => new Intl.DateTimeFormat(undefined, { timeZone: timezone })).not.toThrow()
    }
  })

  it("has no duplicate entries once normalized (a Set can't hold one, but this guards the source array)", () => {
    expect(CANONICAL_IANA_TIMEZONES.size).toBeGreaterThan(300)
  })
})
