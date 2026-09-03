import { describe, expect, it } from "vitest"

import { slotKeys } from "./execution-slots"

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

describe("slotKeys", () => {
  it("returns 5 keys sharing one key1 with 5 distinct key2 values", () => {
    const keys = slotKeys("org-1")

    expect(keys).toHaveLength(5)
    expect(new Set(keys.map((k) => k.key1)).size).toBe(1)
    expect(new Set(keys.map((k) => k.key2)).size).toBe(5)
  })

  it("is deterministic: the same organizationId always yields the same keys", () => {
    expect(slotKeys("org-1")).toEqual(slotKeys("org-1"))
  })

  it("gives two different organizations different key1 values", () => {
    const [a] = slotKeys("org-1")
    const [b] = slotKeys("org-2")

    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(a?.key1).not.toBe(b?.key1)
  })

  it("keeps every key inside the signed int4 range pg_try_advisory_xact_lock expects", () => {
    for (const orgId of ["org-1", "org-2", "another-organization-id"]) {
      for (const { key1, key2 } of slotKeys(orgId)) {
        expect(key1).toBeGreaterThanOrEqual(INT32_MIN)
        expect(key1).toBeLessThanOrEqual(INT32_MAX)
        expect(key2).toBeGreaterThanOrEqual(INT32_MIN)
        expect(key2).toBeLessThanOrEqual(INT32_MAX)
      }
    }
  })
})
