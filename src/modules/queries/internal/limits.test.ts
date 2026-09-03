import { describe, expect, it } from "vitest"
import { finishRows, MAX_ROWS, rowLimits } from "./limits"

// The full docs/decisions/05:457-463 matrix, run against plain arrays instead
// of a 10,001-row fixture (that's what a pure kernel buys — see the plan's
// section 1 "Pure finishRows + a pure limits kernel").

function rowsOf(count: number): number[] {
  return Array.from({ length: count }, (_unused, index) => index)
}

describe("rowLimits", () => {
  it("limit: 0 clamps effectiveLimit to 0 and engineLimit to 1", () => {
    expect(rowLimits(0)).toEqual({ effectiveLimit: 0, engineLimit: 1 })
  })

  it("limit: 1 passes through", () => {
    expect(rowLimits(1)).toEqual({ effectiveLimit: 1, engineLimit: 2 })
  })

  it("limit: 50 passes through", () => {
    expect(rowLimits(50)).toEqual({ effectiveLimit: 50, engineLimit: 51 })
  })

  it("an omitted limit defaults to MAX_ROWS", () => {
    expect(rowLimits(undefined)).toEqual({ effectiveLimit: MAX_ROWS, engineLimit: MAX_ROWS + 1 })
  })

  it("limit: 50000 (above the cap) clamps to MAX_ROWS, never 50000 + 1", () => {
    expect(rowLimits(50_000)).toEqual({ effectiveLimit: MAX_ROWS, engineLimit: MAX_ROWS + 1 })
  })
})

describe("finishRows", () => {
  it("limit: 0 against a non-empty table — [], hasMore true (a row exists), truncated false", () => {
    const { effectiveLimit } = rowLimits(0)
    const result = finishRows(rowsOf(1), effectiveLimit)
    expect(result.rows).toEqual([])
    expect(result.rowCount).toBe(0)
    expect(result.hasMore).toBe(true)
    expect(result.truncated).toBe(false)
  })

  it("limit: 0 against an empty table — [], hasMore false, truncated false", () => {
    const { effectiveLimit } = rowLimits(0)
    const result = finishRows(rowsOf(0), effectiveLimit)
    expect(result.rows).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(result.truncated).toBe(false)
  })

  it("limit: 1 — at most 1 row back, truncated false even though hasMore is true", () => {
    const { effectiveLimit } = rowLimits(1)
    const result = finishRows(rowsOf(2), effectiveLimit)
    expect(result.rows).toEqual([0])
    expect(result.hasMore).toBe(true)
    expect(result.truncated).toBe(false)
  })

  it("limit: 50 on 51 raw rows — exactly 50 back, hasMore true, truncated false", () => {
    const { effectiveLimit } = rowLimits(50)
    const result = finishRows(rowsOf(51), effectiveLimit)
    expect(result.rows).toHaveLength(50)
    expect(result.rowCount).toBe(50)
    expect(result.hasMore).toBe(true)
    expect(result.truncated).toBe(false)
  })

  it("omitted limit on 10,001 raw rows — exactly 10,000 back, hasMore true, truncated true", () => {
    const { effectiveLimit } = rowLimits(undefined)
    const result = finishRows(rowsOf(MAX_ROWS + 1), effectiveLimit)
    expect(result.rows).toHaveLength(MAX_ROWS)
    expect(result.rowCount).toBe(MAX_ROWS)
    expect(result.hasMore).toBe(true)
    expect(result.truncated).toBe(true)
  })

  it("limit: 50000 (above the cap) on 10,001 raw rows — still capped at 10,000, truncated true", () => {
    const { effectiveLimit } = rowLimits(50_000)
    const result = finishRows(rowsOf(MAX_ROWS + 1), effectiveLimit)
    expect(result.rows).toHaveLength(MAX_ROWS)
    expect(result.rowCount).toBe(MAX_ROWS)
    expect(effectiveLimit).toBe(MAX_ROWS)
    expect(result.hasMore).toBe(true)
    expect(result.truncated).toBe(true)
  })

  it("raw at or under the limit — no more rows, hasMore false, truncated false", () => {
    const { effectiveLimit } = rowLimits(50)
    const result = finishRows(rowsOf(50), effectiveLimit)
    expect(result.rows).toHaveLength(50)
    expect(result.rowCount).toBe(50)
    expect(result.hasMore).toBe(false)
    expect(result.truncated).toBe(false)
  })
})
