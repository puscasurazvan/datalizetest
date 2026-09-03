import { describe, expect, it } from "vitest"
import type { QueryAst } from "../schema/query-ast"
import type { DatasetColumn, ResolvedQuery } from "./validator"
import { singleCurrencyRefusal, validateQueryAgainstDataset } from "./validator"

const columns: DatasetColumn[] = [
  { id: "col_amount", name: "amount", type: "decimal", nullable: false },
  { id: "col_status", name: "status", type: "string", nullable: false },
  { id: "col_active", name: "active", type: "boolean", nullable: false },
  { id: "col_created_at", name: "created_at", type: "timestamptz", nullable: false },
  { id: "col_signup_date", name: "signup_date", type: "date", nullable: false },
]

function query(overrides: Partial<QueryAst>): QueryAst {
  return {
    version: 1,
    datasetId: "dataset_1",
    dimensions: [],
    measures: [{ field: null, aggregation: "count", alias: "n" }],
    filters: [],
    ...overrides,
  }
}

function resolve(ast: QueryAst, datasetColumns: DatasetColumn[]): ResolvedQuery {
  const result = validateQueryAgainstDataset(ast, datasetColumns)
  if (!result.ok) throw new Error("test setup query failed to validate")
  return result.query
}

describe("validateQueryAgainstDataset — happy path", () => {
  it("resolves a query whose columns all exist, carrying resolved column info", () => {
    const result = validateQueryAgainstDataset(
      query({
        dimensions: [{ columnId: "col_status" }],
        measures: [{ field: "col_amount", aggregation: "sum", alias: "total" }],
      }),
      columns,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.query.dimensions[0]).toEqual({
      column: { id: "col_status", name: "status", type: "string" },
    })
    expect(result.query.measures[0]).toMatchObject({
      column: { id: "col_amount", name: "amount", type: "decimal" },
      aggregation: "sum",
      alias: "total",
    })
  })

  it("resolves a count-all measure with a null column", () => {
    const result = validateQueryAgainstDataset(query({}), columns)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.query.measures[0]).toMatchObject({ column: null, aggregation: "count" })
  })

  it("resolves orderBy referring to a grouped dimension", () => {
    const result = validateQueryAgainstDataset(
      query({
        dimensions: [{ columnId: "col_status" }],
        orderBy: [{ kind: "dimension", columnId: "col_status", direction: "asc" }],
      }),
      columns,
    )
    expect(result.ok).toBe(true)
  })

  it("resolves orderBy referring to a defined measure alias", () => {
    const result = validateQueryAgainstDataset(
      query({
        measures: [{ field: "col_amount", aggregation: "sum", alias: "total" }],
        orderBy: [{ kind: "measure", alias: "total", direction: "desc" }],
      }),
      columns,
    )
    expect(result.ok).toBe(true)
  })

  it("resolves a datetime granularity on a timestamptz column, keeping the granularity", () => {
    const result = validateQueryAgainstDataset(
      query({ dimensions: [{ columnId: "col_created_at", granularity: "month" }] }),
      columns,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.query.dimensions[0]).toEqual({
      column: { id: "col_created_at", name: "created_at", type: "timestamptz" },
      granularity: "month",
    })
  })

  it("resolves a filter's columnId to its column, keeping operator and value", () => {
    const result = validateQueryAgainstDataset(
      query({ filters: [{ columnId: "col_status", operator: "eq", value: "active" }] }),
      columns,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.query.filters[0]).toEqual({
      column: { id: "col_status", name: "status", type: "string" },
      operator: "eq",
      value: "active",
    })
  })
})

describe("validateQueryAgainstDataset — COLUMN_REMOVED", () => {
  it("flags a dimension columnId absent from the dataset, naming it by column ID", () => {
    const result = validateQueryAgainstDataset(
      query({ dimensions: [{ columnId: "col_missing" }] }),
      columns,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe("SCHEMA_INCOMPATIBLE")
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "COLUMN_REMOVED", columnId: "col_missing" }),
    )
  })

  it("flags a measure field absent from the dataset", () => {
    const result = validateQueryAgainstDataset(
      query({ measures: [{ field: "col_missing", aggregation: "sum", alias: "n" }] }),
      columns,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "COLUMN_REMOVED", columnId: "col_missing" }),
    )
  })

  it("flags a filter columnId absent from the dataset", () => {
    const result = validateQueryAgainstDataset(
      query({ filters: [{ columnId: "col_missing", operator: "is_null" }] }),
      columns,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "COLUMN_REMOVED", columnId: "col_missing" }),
    )
  })

  it("collects more than one COLUMN_REMOVED issue in a single pass", () => {
    const result = validateQueryAgainstDataset(
      query({
        dimensions: [{ columnId: "col_missing_1" }],
        filters: [{ columnId: "col_missing_2", operator: "is_null" }],
      }),
      columns,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    const removedIds = result.error.issues
      .filter((issue) => issue.code === "COLUMN_REMOVED")
      .map((issue) => (issue.code === "COLUMN_REMOVED" ? issue.columnId : null))
    expect(removedIds).toEqual(expect.arrayContaining(["col_missing_1", "col_missing_2"]))
  })
})

describe("validateQueryAgainstDataset — TYPE_INCOMPATIBLE", () => {
  it("rejects gt on a boolean column, naming it by column name", () => {
    const result = validateQueryAgainstDataset(
      query({ filters: [{ columnId: "col_active", operator: "gt", value: true }] }),
      columns,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "TYPE_INCOMPATIBLE", columnName: "active" }),
    )
  })

  it("accepts eq on a boolean column", () => {
    const result = validateQueryAgainstDataset(
      query({ filters: [{ columnId: "col_active", operator: "eq", value: true }] }),
      columns,
    )
    expect(result.ok).toBe(true)
  })

  it("rejects between on a string column", () => {
    const result = validateQueryAgainstDataset(
      query({ filters: [{ columnId: "col_status", operator: "between", value: ["a", "b"] }] }),
      columns,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "TYPE_INCOMPATIBLE", columnName: "status" }),
    )
  })

  it("rejects a granularity on a non-datetime column", () => {
    const result = validateQueryAgainstDataset(
      query({ dimensions: [{ columnId: "col_status", granularity: "month" }] }),
      columns,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "TYPE_INCOMPATIBLE", columnName: "status" }),
    )
  })

  it("rejects sum on a string column", () => {
    const result = validateQueryAgainstDataset(
      query({ measures: [{ field: "col_status", aggregation: "sum", alias: "n" }] }),
      columns,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "TYPE_INCOMPATIBLE", columnName: "status" }),
    )
  })

  it("accepts min/max on a string column", () => {
    const result = validateQueryAgainstDataset(
      query({ measures: [{ field: "col_status", aggregation: "min", alias: "n" }] }),
      columns,
    )
    expect(result.ok).toBe(true)
  })

  it("rejects avg on a boolean column", () => {
    const result = validateQueryAgainstDataset(
      query({ measures: [{ field: "col_active", aggregation: "avg", alias: "n" }] }),
      columns,
    )
    expect(result.ok).toBe(false)
  })

  it("accepts count and count_distinct on every column type", () => {
    for (const column of columns) {
      const result = validateQueryAgainstDataset(
        query({ measures: [{ field: column.id, aggregation: "count_distinct", alias: "n" }] }),
        columns,
      )
      expect(result.ok).toBe(true)
    }
  })
})

describe("validateQueryAgainstDataset — date (canonical type vocabulary)", () => {
  it("resolves a filter on a date column", () => {
    const result = validateQueryAgainstDataset(
      query({ filters: [{ columnId: "col_signup_date", operator: "eq", value: "2026-01-01" }] }),
      columns,
    )
    expect(result.ok).toBe(true)
  })

  it("accepts min/max on a date column", () => {
    const result = validateQueryAgainstDataset(
      query({ measures: [{ field: "col_signup_date", aggregation: "max", alias: "n" }] }),
      columns,
    )
    expect(result.ok).toBe(true)
  })

  it("rejects sum on a date column", () => {
    const result = validateQueryAgainstDataset(
      query({ measures: [{ field: "col_signup_date", aggregation: "sum", alias: "n" }] }),
      columns,
    )
    expect(result.ok).toBe(false)
  })

  it("rejects a granularity on a date column — a calendar date carries no instant and is never passed through AT TIME ZONE (docs/decisions/03)", () => {
    const result = validateQueryAgainstDataset(
      query({ dimensions: [{ columnId: "col_signup_date", granularity: "month" }] }),
      columns,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "TYPE_INCOMPATIBLE", columnName: "signup_date" }),
    )
  })
})

describe("validateQueryAgainstDataset — orderBy resolution", () => {
  it("rejects an orderBy measure alias that no measure defines", () => {
    const result = validateQueryAgainstDataset(
      query({ orderBy: [{ kind: "measure", alias: "nope", direction: "asc" }] }),
      columns,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        code: "ORDER_BY_UNRESOLVED",
        ref: { kind: "measure", alias: "nope" },
      }),
    )
  })

  it("rejects an orderBy dimension columnId that is not in dimensions", () => {
    const result = validateQueryAgainstDataset(
      query({
        dimensions: [{ columnId: "col_status" }],
        orderBy: [{ kind: "dimension", columnId: "col_active", direction: "asc" }],
      }),
      columns,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        code: "ORDER_BY_UNRESOLVED",
        ref: { kind: "dimension", columnId: "col_active" },
      }),
    )
  })
})

describe("singleCurrencyRefusal", () => {
  const currencyColumns: DatasetColumn[] = [
    { id: "col_amount", name: "amount", type: "decimal", nullable: false },
    { id: "col_currency", name: "currency", type: "string", nullable: false },
  ]

  it("refuses sum(amount) when currency is not pinned", () => {
    const resolved = resolve(
      query({ measures: [{ field: "col_amount", aggregation: "sum", alias: "total" }] }),
      currencyColumns,
    )
    expect(singleCurrencyRefusal(resolved, currencyColumns)).toContain("currency")
  })

  it("allows sum(amount) when currency is pinned by an eq filter", () => {
    const resolved = resolve(
      query({
        measures: [{ field: "col_amount", aggregation: "sum", alias: "total" }],
        filters: [{ columnId: "col_currency", operator: "eq", value: "USD" }],
      }),
      currencyColumns,
    )
    expect(singleCurrencyRefusal(resolved, currencyColumns)).toBeNull()
  })

  it("allows sum(amount) when currency is pinned by an in filter of exactly one value", () => {
    const resolved = resolve(
      query({
        measures: [{ field: "col_amount", aggregation: "sum", alias: "total" }],
        filters: [{ columnId: "col_currency", operator: "in", value: ["USD"] }],
      }),
      currencyColumns,
    )
    expect(singleCurrencyRefusal(resolved, currencyColumns)).toBeNull()
  })

  it("refuses sum(amount) when the in filter names more than one currency", () => {
    const resolved = resolve(
      query({
        measures: [{ field: "col_amount", aggregation: "sum", alias: "total" }],
        filters: [{ columnId: "col_currency", operator: "in", value: ["USD", "EUR"] }],
      }),
      currencyColumns,
    )
    expect(singleCurrencyRefusal(resolved, currencyColumns)).not.toBeNull()
  })

  it("allows sum(amount) when grouped by currency", () => {
    const resolved = resolve(
      query({
        dimensions: [{ columnId: "col_currency" }],
        measures: [{ field: "col_amount", aggregation: "sum", alias: "total" }],
      }),
      currencyColumns,
    )
    expect(singleCurrencyRefusal(resolved, currencyColumns)).toBeNull()
  })

  it("allows avg/min/max the same way it allows sum", () => {
    for (const aggregation of ["avg", "min", "max"] as const) {
      const refused = resolve(
        query({ measures: [{ field: "col_amount", aggregation, alias: "n" }] }),
        currencyColumns,
      )
      expect(singleCurrencyRefusal(refused, currencyColumns)).not.toBeNull()

      const pinned = resolve(
        query({
          measures: [{ field: "col_amount", aggregation, alias: "n" }],
          filters: [{ columnId: "col_currency", operator: "eq", value: "USD" }],
        }),
        currencyColumns,
      )
      expect(singleCurrencyRefusal(pinned, currencyColumns)).toBeNull()
    }
  })

  it("allows a dataset with no currency column", () => {
    const resolved = resolve(
      query({ measures: [{ field: "col_amount", aggregation: "sum", alias: "total" }] }),
      columns,
    )
    expect(singleCurrencyRefusal(resolved, columns)).toBeNull()
  })

  it("allows count(*) regardless of currency, since it aggregates no decimal column", () => {
    const resolved = resolve(query({}), currencyColumns)
    expect(singleCurrencyRefusal(resolved, currencyColumns)).toBeNull()
  })
})

describe("validateQueryAgainstDataset — multiple issues", () => {
  it("reports every issue in one pass, not just the first", () => {
    const result = validateQueryAgainstDataset(
      query({
        dimensions: [{ columnId: "col_missing" }],
        measures: [{ field: "col_status", aggregation: "sum", alias: "n" }],
      }),
      columns,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues.length).toBeGreaterThanOrEqual(2)
  })
})
