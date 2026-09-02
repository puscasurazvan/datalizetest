import { describe, expect, it } from "vitest"

import { ObjectKey } from "./object-key"

const ORG_A = "org_a"
const ORG_B = "org_b"

describe("ObjectKey.forOrganization", () => {
  it("shapes the key as org/{organizationId}/uploads/{uuid}.csv", () => {
    const key = ObjectKey.forOrganization(ORG_A)

    expect(key.value).toMatch(
      /^org\/org_a\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.csv$/,
    )
  })

  it("mints a distinct key on every call", () => {
    const first = ObjectKey.forOrganization(ORG_A)
    const second = ObjectKey.forOrganization(ORG_A)

    expect(first.value).not.toBe(second.value)
  })

  it("rejects an empty organizationId", () => {
    expect(() => ObjectKey.forOrganization("")).toThrow(/organizationId/)
  })

  it("rejects an organizationId containing a slash", () => {
    expect(() => ObjectKey.forOrganization("org/a")).toThrow(/organizationId/)
  })
})

describe("ObjectKey.parse", () => {
  it("round-trips a generated key for the organization it was minted for", () => {
    const minted = ObjectKey.forOrganization(ORG_A)

    const result = ObjectKey.parse(minted.value, ORG_A)

    expect(result.ok).toBe(true)
    expect(result.ok && result.key.value).toBe(minted.value)
  })

  it("rejects a key generated for a different organization", () => {
    const minted = ObjectKey.forOrganization(ORG_A)

    const result = ObjectKey.parse(minted.value, ORG_B)

    expect(result).toMatchObject({ ok: false })
  })

  it.each([
    ["missing the org/ prefix", "uploads/11111111-1111-4111-8111-111111111111.csv"],
    ["missing the uploads/ segment", "org/org_a/11111111-1111-4111-8111-111111111111.csv"],
    ["wrong extension", "org/org_a/uploads/11111111-1111-4111-8111-111111111111.txt"],
    ["not a uuid", "org/org_a/uploads/not-a-uuid.csv"],
    [
      "uppercased throughout",
      "org/org_a/uploads/11111111-1111-4111-8111-111111111111".toUpperCase() + ".csv",
    ],
    ["path traversal via extra segments", "org/org_a/uploads/../../etc/passwd.csv"],
    ["empty string", ""],
  ])("rejects a malformed key: %s", (_label, raw) => {
    const result = ObjectKey.parse(raw, ORG_A)

    expect(result).toMatchObject({ ok: false })
  })

  it("carries a human-readable reason on rejection", () => {
    const result = ObjectKey.parse("not-a-key-at-all", ORG_A)

    expect(result.ok).toBe(false)
    expect(result.ok || result.reason.length > 0).toBe(true)
  })
})
