import { describe, expect, it } from "vitest"

import {
  aggregationOptions,
  buildQueryAst,
  filterOperatorOptions,
  parseFilterValue,
  resolveFilterChoice,
} from "./build-query-ast"

describe("aggregationOptions", () => {
  it("offers no sum for a string column", () => {
    expect(aggregationOptions("string")).not.toContain("sum")
  })

  it("offers sum for a decimal column", () => {
    expect(aggregationOptions("decimal")).toContain("sum")
  })
})

describe("filterOperatorOptions", () => {
  it("never offers between or in — the builder has no multi-value input", () => {
    const options = filterOperatorOptions("integer")
    expect(options).not.toContain("between")
    expect(options).not.toContain("in")
  })

  it("still offers eq and the null checks", () => {
    expect(filterOperatorOptions("string")).toEqual(
      expect.arrayContaining(["eq", "is_null", "is_not_null"]),
    )
  })
})

describe("parseFilterValue", () => {
  it("returns null for an empty string, on every type", () => {
    expect(parseFilterValue("string", "")).toBeNull()
    expect(parseFilterValue("integer", "")).toBeNull()
  })

  it("parses a finite number for integer/decimal, null when it does not parse", () => {
    expect(parseFilterValue("integer", "42")).toBe(42)
    expect(parseFilterValue("decimal", "3.5")).toBe(3.5)
    expect(parseFilterValue("integer", "not-a-number")).toBeNull()
  })

  it("parses true/false for boolean", () => {
    expect(parseFilterValue("boolean", "true")).toBe(true)
    expect(parseFilterValue("boolean", "false")).toBe(false)
  })

  it("passes string/date/timestamptz through as-is", () => {
    expect(parseFilterValue("string", "USD")).toBe("USD")
    expect(parseFilterValue("timestamptz", "2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z")
  })
})

describe("resolveFilterChoice", () => {
  const currencyColumn = { columnId: "col_currency", type: "string" as const }

  it("returns null when no column is chosen", () => {
    expect(resolveFilterChoice(null, "eq", "USD")).toBeNull()
  })

  it("returns null while a value-needing operator's value has not parsed", () => {
    expect(resolveFilterChoice(currencyColumn, "eq", "")).toBeNull()
  })

  it("resolves a comparison operator once its value parses", () => {
    expect(resolveFilterChoice(currencyColumn, "eq", "USD")).toEqual({
      columnId: "col_currency",
      operator: "eq",
      value: "USD",
    })
  })

  it("resolves is_null/is_not_null with no value key, regardless of raw input", () => {
    expect(resolveFilterChoice(currencyColumn, "is_null", "")).toEqual({
      columnId: "col_currency",
      operator: "is_null",
    })
  })
})

describe("buildQueryAst", () => {
  it("returns null when neither a dimension nor a measure is chosen", () => {
    expect(
      buildQueryAst({ datasetId: "ds_1", dimension: null, measure: null, filter: null }),
    ).toBeNull()
  })

  it("emits the charted measure aliased 'value' before the count-all 'rows'", () => {
    const ast = buildQueryAst({
      datasetId: "ds_1",
      dimension: { columnId: "col_date", granularity: "month" },
      measure: { fieldColumnId: "col_amount", aggregation: "sum" },
      filter: null,
    })

    expect(ast?.measures).toEqual([
      { field: "col_amount", aggregation: "sum", alias: "value" },
      { field: null, aggregation: "count", alias: "rows" },
    ])
  })

  it("omits granularity from the dimension when none is chosen", () => {
    const ast = buildQueryAst({
      datasetId: "ds_1",
      dimension: { columnId: "col_category", granularity: null },
      measure: null,
      filter: null,
    })

    expect(ast?.dimensions).toEqual([{ columnId: "col_category" }])
  })

  it("carries a single-value filter through unchanged", () => {
    const ast = buildQueryAst({
      datasetId: "ds_1",
      dimension: null,
      measure: { fieldColumnId: null, aggregation: "count" },
      filter: { columnId: "col_currency", operator: "eq", value: "USD" },
    })

    expect(ast?.filters).toEqual([{ columnId: "col_currency", operator: "eq", value: "USD" }])
  })

  it("carries an is_null filter with no value key", () => {
    const ast = buildQueryAst({
      datasetId: "ds_1",
      dimension: null,
      measure: { fieldColumnId: null, aggregation: "count" },
      filter: { columnId: "col_currency", operator: "is_null" },
    })

    expect(ast?.filters).toEqual([{ columnId: "col_currency", operator: "is_null" }])
  })

  it("a measure-only query (dimension-less) omits GROUP BY input entirely", () => {
    const ast = buildQueryAst({
      datasetId: "ds_1",
      dimension: null,
      measure: { fieldColumnId: null, aggregation: "count" },
      filter: null,
    })

    expect(ast?.dimensions).toEqual([])
  })
})
