import { describe, expect, it } from "vitest"

import type { BarCategoryCapInput, FieldRef, ResultOrdering } from "./config"
import {
  BAR_CHART_CATEGORY_CAP,
  capBarCategories,
  fieldRefName,
  granularityFooterText,
} from "./config"

const revenueMeasure: FieldRef = { kind: "measure", alias: "total_revenue" }
const signupCountMeasure: FieldRef = { kind: "measure", alias: "signup_count" }
const nameDimension: FieldRef = { kind: "dimension", columnId: "col_customer_name" }

const rankedByRevenueDefault: ResultOrdering = {
  kind: "default",
  firstMeasureAlias: "total_revenue",
}

const capInput = (overrides: Partial<BarCategoryCapInput>): BarCategoryCapInput => ({
  totalCategoryCount: 0,
  truncated: false,
  ordering: rankedByRevenueDefault,
  valueField: revenueMeasure,
  ...overrides,
})

describe("fieldRefName", () => {
  it("resolves a dimension ref to its Column ID", () => {
    expect(fieldRefName({ kind: "dimension", columnId: "col_abc123" })).toBe("col_abc123")
  })

  it("resolves a measure ref to its alias", () => {
    expect(fieldRefName({ kind: "measure", alias: "total_revenue" })).toBe("total_revenue")
  })
})

describe("granularityFooterText", () => {
  it("states granularity and timezone for month", () => {
    expect(granularityFooterText("month", "UTC")).toBe("Grouped by month (UTC)")
  })

  it("states granularity and timezone for day", () => {
    expect(granularityFooterText("day", "America/New_York")).toBe(
      "Grouped by day (America/New_York)",
    )
  })

  it("states granularity and timezone for quarter", () => {
    expect(granularityFooterText("quarter", "UTC")).toBe("Grouped by quarter (UTC)")
  })

  it("states granularity and timezone for year", () => {
    expect(granularityFooterText("year", "UTC")).toBe("Grouped by year (UTC)")
  })

  it("additionally states the ISO Monday-start convention for week", () => {
    expect(granularityFooterText("week", "Europe/London")).toBe(
      "Grouped by week (Europe/London, Monday start)",
    )
  })
})

describe("capBarCategories", () => {
  it("does not cap when the count is under the cap", () => {
    expect(capBarCategories(capInput({ totalCategoryCount: 12 }))).toEqual({
      visibleCount: 12,
      droppedCount: 0,
      note: null,
    })
  })

  it("does not cap when the count exactly equals the cap", () => {
    expect(capBarCategories(capInput({ totalCategoryCount: BAR_CHART_CATEGORY_CAP }))).toEqual({
      visibleCount: 50,
      droppedCount: 0,
      note: null,
    })
  })

  it("handles zero categories", () => {
    expect(capBarCategories(capInput({ totalCategoryCount: 0 }))).toEqual({
      visibleCount: 0,
      droppedCount: 0,
      note: null,
    })
  })

  describe("ranking (docs/decisions/05 'Total Group Count and Ranking for Capped Displays')", () => {
    it('calls the visible rows "top" when the default order ranks the charted measure', () => {
      expect(
        capBarCategories(
          capInput({
            totalCategoryCount: 237,
            ordering: rankedByRevenueDefault,
            valueField: revenueMeasure,
          }),
        ),
      ).toEqual({
        visibleCount: 50,
        droppedCount: 187,
        note: "Showing top 50 of 237",
      })
    })

    it("caps by exactly one category over the cap", () => {
      expect(
        capBarCategories(
          capInput({
            totalCategoryCount: 51,
            ordering: rankedByRevenueDefault,
            valueField: revenueMeasure,
          }),
        ),
      ).toEqual({
        visibleCount: 50,
        droppedCount: 1,
        note: "Showing top 50 of 51",
      })
    })

    it('says "first" — never "top" — when the default order ranks a measure other than the charted one', () => {
      // No explicit orderBy: the compiler's default order is the FIRST
      // measure descending (decisions/05:79). Charting signup_count while
      // total_revenue is first means the visible rows are not ranked by
      // what this chart shows.
      expect(
        capBarCategories(
          capInput({
            totalCategoryCount: 1240,
            ordering: rankedByRevenueDefault,
            valueField: signupCountMeasure,
          }),
        ),
      ).toEqual({
        visibleCount: 50,
        droppedCount: 1190,
        note: "Showing first 50 of 1,240",
      })
    })

    it('says "first" when an explicit orderBy names a different field', () => {
      // orderBy: customer_name ASC — the first 50 rows are alphabetically
      // first, not top by any measure (docs/decisions/05:436).
      expect(
        capBarCategories(
          capInput({
            totalCategoryCount: 1240,
            ordering: { kind: "explicit", ref: nameDimension, direction: "asc" },
            valueField: revenueMeasure,
          }),
        ),
      ).toEqual({
        visibleCount: 50,
        droppedCount: 1190,
        note: "Showing first 50 of 1,240",
      })
    })

    it('says "first" when an explicit orderBy names the charted measure ascending, not descending', () => {
      expect(
        capBarCategories(
          capInput({
            totalCategoryCount: 100,
            ordering: { kind: "explicit", ref: revenueMeasure, direction: "asc" },
            valueField: revenueMeasure,
          }),
        ).note,
      ).toBe("Showing first 50 of 100")
    })

    it('says "top" when an explicit orderBy names the charted measure descending', () => {
      expect(
        capBarCategories(
          capInput({
            totalCategoryCount: 100,
            ordering: { kind: "explicit", ref: revenueMeasure, direction: "desc" },
            valueField: revenueMeasure,
          }),
        ).note,
      ).toBe("Showing top 50 of 100")
    })
  })

  describe("truncation (docs/decisions/05 'must show \"10,000+\", never a fabricated number')", () => {
    it('shows "10,000+" instead of a fabricated exact total when the result was truncated', () => {
      expect(
        capBarCategories(
          capInput({
            totalCategoryCount: 10000,
            truncated: true,
            ordering: rankedByRevenueDefault,
            valueField: revenueMeasure,
          }),
        ),
      ).toEqual({
        visibleCount: 50,
        droppedCount: 9950,
        note: "Showing top 50 of 10,000+",
      })
    })

    it('combines with ranking: "first" of "10,000+" when neither the count nor the ranking is trustworthy as "top N"', () => {
      expect(
        capBarCategories(
          capInput({
            totalCategoryCount: 10000,
            truncated: true,
            ordering: { kind: "explicit", ref: nameDimension, direction: "asc" },
            valueField: revenueMeasure,
          }),
        ).note,
      ).toBe("Showing first 50 of 10,000+")
    })
  })
})
