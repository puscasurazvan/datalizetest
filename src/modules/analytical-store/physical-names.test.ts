import { describe, expect, it } from "vitest"

import {
  ANALYTICAL_SCHEMA,
  assertDatasetVersionId,
  physicalColumnName,
  physicalTableName,
  qualifiedTableName,
  quoteIdentifier,
} from "./physical-names"

describe("physicalTableName", () => {
  it("derives a fixed-length dv_{32 hex digit} name from a UUID, hyphens stripped", () => {
    const name = physicalTableName("3f81ecb0-2c87-4b8c-bb2d-aebcee16979f")
    expect(name).toBe("dv_3f81ecb02c874b8cbb2daebcee16979f")
    expect(name.length).toBe(35)
  })

  it("lowercases an uppercase UUID so casing never changes the physical name", () => {
    expect(physicalTableName("3F81ECB0-2C87-4B8C-BB2D-AEBCEE16979F")).toBe(
      physicalTableName("3f81ecb0-2c87-4b8c-bb2d-aebcee16979f"),
    )
  })

  it("is deterministic: the same datasetVersionId always yields the same name", () => {
    const id = "11111111-2222-4333-8444-555555555555"
    expect(physicalTableName(id)).toBe(physicalTableName(id))
  })

  it("rejects a non-UUID datasetVersionId rather than silently truncating it", () => {
    expect(() => physicalTableName("not-a-uuid")).toThrow(/UUID/)
    expect(() => physicalTableName("")).toThrow(/UUID/)
  })
})

describe("assertDatasetVersionId", () => {
  it("passes a well-formed UUID through without throwing", () => {
    expect(() => assertDatasetVersionId("3f81ecb0-2c87-4b8c-bb2d-aebcee16979f")).not.toThrow()
  })

  it("throws on a UUID-shaped string with the wrong segment lengths", () => {
    expect(() => assertDatasetVersionId("3f81ecb0-2c87-4b8c-bb2d-aebcee16979")).toThrow(/UUID/)
  })
})

describe("physicalColumnName", () => {
  it("derives c_{ordinal}", () => {
    expect(physicalColumnName(0)).toBe("c_0")
    expect(physicalColumnName(41)).toBe("c_41")
  })

  it("rejects a negative or non-integer ordinal", () => {
    expect(() => physicalColumnName(-1)).toThrow(/non-negative integer/)
    expect(() => physicalColumnName(1.5)).toThrow(/non-negative integer/)
  })

  it("never collides across the product's 100-column ceiling (docs/decisions/01)", () => {
    const names = new Set(Array.from({ length: 100 }, (_, ordinal) => physicalColumnName(ordinal)))
    expect(names.size).toBe(100)
  })
})

describe("quoteIdentifier", () => {
  it("wraps in double quotes and doubles an embedded double quote", () => {
    expect(quoteIdentifier("dv_abc")).toBe('"dv_abc"')
    expect(quoteIdentifier('weird"name')).toBe('"weird""name"')
  })
})

describe("qualifiedTableName", () => {
  it("qualifies the physical table with the fixed analytical schema", () => {
    const id = "3f81ecb0-2c87-4b8c-bb2d-aebcee16979f"
    expect(qualifiedTableName(id)).toBe(
      `"${ANALYTICAL_SCHEMA}"."dv_3f81ecb02c874b8cbb2daebcee16979f"`,
    )
  })
})
