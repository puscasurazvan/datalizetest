import { describe, expect, it } from "vitest"
import { queryAstSchema } from "./query-ast"

function baseQuery(): Record<string, unknown> {
  const dimensions: unknown[] = []
  const filters: unknown[] = []
  return {
    version: 1,
    datasetId: "dataset_1",
    dimensions,
    measures: [{ field: null, aggregation: "count", alias: "total" }],
    filters,
  }
}

describe("queryAstSchema — envelope", () => {
  it("accepts a minimal valid query", () => {
    const result = queryAstSchema.safeParse(baseQuery())
    expect(result.success).toBe(true)
  })

  it("rejects a version other than 1", () => {
    const result = queryAstSchema.safeParse({ ...baseQuery(), version: 2 })
    expect(result.success).toBe(false)
  })

  it("rejects a missing datasetId", () => {
    const query = baseQuery()
    const { datasetId: _datasetId, ...rest } = query
    const result = queryAstSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it("rejects an empty datasetId", () => {
    const result = queryAstSchema.safeParse({ ...baseQuery(), datasetId: "" })
    expect(result.success).toBe(false)
  })

  it("rejects an unrecognized top-level key", () => {
    const result = queryAstSchema.safeParse({ ...baseQuery(), bogus: true })
    expect(result.success).toBe(false)
  })
})

describe("queryAstSchema — dimensions", () => {
  it("accepts a dimension with no granularity", () => {
    const query = { ...baseQuery(), dimensions: [{ columnId: "col_1" }] }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })

  it("accepts every legal granularity value", () => {
    for (const granularity of ["day", "week", "month", "quarter", "year"]) {
      const query = { ...baseQuery(), dimensions: [{ columnId: "col_1", granularity }] }
      expect(queryAstSchema.safeParse(query).success).toBe(true)
    }
  })

  it("rejects an illegal granularity value", () => {
    const query = { ...baseQuery(), dimensions: [{ columnId: "col_1", granularity: "hour" }] }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("rejects a 4th dimension (max 3)", () => {
    const query = {
      ...baseQuery(),
      dimensions: [{ columnId: "c1" }, { columnId: "c2" }, { columnId: "c3" }, { columnId: "c4" }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("accepts exactly 3 dimensions", () => {
    const query = {
      ...baseQuery(),
      dimensions: [{ columnId: "c1" }, { columnId: "c2" }, { columnId: "c3" }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })
})

describe("queryAstSchema — measures", () => {
  it("accepts zero measures when at least one dimension is present (dimension-only, e.g. distinct values)", () => {
    const query = { ...baseQuery(), dimensions: [{ columnId: "col_1" }], measures: [] }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })

  it("rejects a 6th measure (max 5)", () => {
    const measures = Array.from({ length: 6 }, (_, i) => ({
      field: "col_1",
      aggregation: "sum" as const,
      alias: `m${i}`,
    }))
    const result = queryAstSchema.safeParse({ ...baseQuery(), measures })
    expect(result.success).toBe(false)
  })

  it("accepts exactly 5 measures", () => {
    const measures = Array.from({ length: 5 }, (_, i) => ({
      field: "col_1",
      aggregation: "sum" as const,
      alias: `m${i}`,
    }))
    const result = queryAstSchema.safeParse({ ...baseQuery(), measures })
    expect(result.success).toBe(true)
  })

  it("accepts field: null with aggregation count (count-all)", () => {
    const query = { ...baseQuery(), measures: [{ field: null, aggregation: "count", alias: "n" }] }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })

  it("accepts a non-null field with aggregation count", () => {
    const query = {
      ...baseQuery(),
      measures: [{ field: "col_1", aggregation: "count", alias: "n" }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })

  it("rejects field: null with a non-count aggregation", () => {
    const query = { ...baseQuery(), measures: [{ field: null, aggregation: "sum", alias: "n" }] }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("rejects a missing alias", () => {
    const query = { ...baseQuery(), measures: [{ field: "col_1", aggregation: "sum" }] }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("rejects an alias starting with a digit", () => {
    const query = {
      ...baseQuery(),
      measures: [{ field: "col_1", aggregation: "sum", alias: "1total" }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("rejects an alias with uppercase letters", () => {
    const query = {
      ...baseQuery(),
      measures: [{ field: "col_1", aggregation: "sum", alias: "Total" }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("accepts an alias at the 30-character length ceiling", () => {
    const alias = "a" + "b".repeat(29)
    expect(alias).toHaveLength(30)
    const query = { ...baseQuery(), measures: [{ field: "col_1", aggregation: "sum", alias }] }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })

  it("rejects an alias past the 30-character length ceiling", () => {
    const alias = "a" + "b".repeat(30)
    const query = { ...baseQuery(), measures: [{ field: "col_1", aggregation: "sum", alias }] }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("rejects two measures sharing the same alias, flagging the second", () => {
    const query = {
      ...baseQuery(),
      measures: [
        { field: "col_1", aggregation: "sum", alias: "total" },
        { field: "col_2", aggregation: "avg", alias: "total" },
      ],
    }
    const result = queryAstSchema.safeParse(query)
    expect(result.success).toBe(false)
    if (result.success) return
    const duplicateIssue = result.error.issues.find(
      (issue) => issue.path.join(".") === "measures.1.alias",
    )
    expect(duplicateIssue).toBeDefined()
  })

  it("rejects a measure alias equal to a dimension's Column ID — the collision docs/decisions/06 #9 exists to prevent", () => {
    const query = {
      ...baseQuery(),
      dimensions: [{ columnId: "status" }],
      measures: [{ field: "col_1", aggregation: "sum", alias: "status" }],
    }
    const result = queryAstSchema.safeParse(query)
    expect(result.success).toBe(false)
    if (result.success) return
    const collisionIssue = result.error.issues.find(
      (issue) => issue.path.join(".") === "measures.0.alias",
    )
    expect(collisionIssue).toBeDefined()
  })
})

describe("queryAstSchema — dimensions or measures required", () => {
  it("rejects a query with zero dimensions and zero measures", () => {
    const query = { ...baseQuery(), dimensions: [], measures: [] }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("accepts zero dimensions when at least one measure is present (KPI-style total)", () => {
    const query = {
      ...baseQuery(),
      dimensions: [],
      measures: [{ field: null, aggregation: "count", alias: "total" }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })
})

describe("queryAstSchema — filters", () => {
  it("accepts eq with a single scalar value", () => {
    const query = { ...baseQuery(), filters: [{ columnId: "c1", operator: "eq", value: "a" }] }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })

  it.each(["eq", "neq", "gt", "gte", "lt", "lte"] as const)(
    "rejects %s with no value",
    (operator) => {
      const query = { ...baseQuery(), filters: [{ columnId: "c1", operator }] }
      expect(queryAstSchema.safeParse(query).success).toBe(false)
    },
  )

  it("accepts between with exactly two values", () => {
    const query = {
      ...baseQuery(),
      filters: [{ columnId: "c1", operator: "between", value: [1, 10] }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })

  it("rejects between with one value", () => {
    const query = { ...baseQuery(), filters: [{ columnId: "c1", operator: "between", value: [1] }] }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("rejects between with three values", () => {
    const query = {
      ...baseQuery(),
      filters: [{ columnId: "c1", operator: "between", value: [1, 2, 3] }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("accepts in with a non-empty array", () => {
    const query = {
      ...baseQuery(),
      filters: [{ columnId: "c1", operator: "in", value: ["a", "b"] }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })

  it("rejects in with an empty array", () => {
    const query = { ...baseQuery(), filters: [{ columnId: "c1", operator: "in", value: [] }] }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it.each(["is_null", "is_not_null"] as const)("accepts %s with no value at all", (operator) => {
    const query = { ...baseQuery(), filters: [{ columnId: "c1", operator }] }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })

  it.each(["is_null", "is_not_null"] as const)(
    "rejects %s carrying a value — must fail, not be ignored",
    (operator) => {
      const query = { ...baseQuery(), filters: [{ columnId: "c1", operator, value: "x" }] }
      const result = queryAstSchema.safeParse(query)
      expect(result.success).toBe(false)
    },
  )

  it("rejects an unknown operator", () => {
    const query = { ...baseQuery(), filters: [{ columnId: "c1", operator: "like", value: "x" }] }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("rejects an 11th filter (max 10)", () => {
    const filters = Array.from({ length: 11 }, (_, i) => ({
      columnId: `c${i}`,
      operator: "is_null" as const,
    }))
    expect(queryAstSchema.safeParse({ ...baseQuery(), filters }).success).toBe(false)
  })

  it("accepts exactly 10 filters", () => {
    const filters = Array.from({ length: 10 }, (_, i) => ({
      columnId: `c${i}`,
      operator: "is_null" as const,
    }))
    expect(queryAstSchema.safeParse({ ...baseQuery(), filters }).success).toBe(true)
  })
})

describe("queryAstSchema — orderBy", () => {
  it("accepts a dimension ref", () => {
    const query = {
      ...baseQuery(),
      dimensions: [{ columnId: "c1" }],
      orderBy: [{ kind: "dimension", columnId: "c1", direction: "asc" }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })

  it("accepts a measure ref", () => {
    const query = {
      ...baseQuery(),
      orderBy: [{ kind: "measure", alias: "total", direction: "desc" }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(true)
  })

  it("rejects a bare string field — must be a discriminated ref", () => {
    const query = { ...baseQuery(), orderBy: [{ field: "total", direction: "desc" }] }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("rejects an unknown kind", () => {
    const query = {
      ...baseQuery(),
      orderBy: [{ kind: "column", columnId: "c1", direction: "asc" }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })

  it("rejects a dimension ref carrying an alias field", () => {
    const query = {
      ...baseQuery(),
      orderBy: [{ kind: "dimension", columnId: "c1", alias: "x", direction: "asc" }],
    }
    expect(queryAstSchema.safeParse(query).success).toBe(false)
  })
})

describe("queryAstSchema — limit", () => {
  it("accepts a valid limit", () => {
    expect(queryAstSchema.safeParse({ ...baseQuery(), limit: 100 }).success).toBe(true)
  })

  it("accepts an absent limit", () => {
    expect(queryAstSchema.safeParse(baseQuery()).success).toBe(true)
  })

  it("accepts limit 0 — an existence probe, not an error (docs/decisions/05:449)", () => {
    expect(queryAstSchema.safeParse({ ...baseQuery(), limit: 0 }).success).toBe(true)
  })

  it("rejects a limit above 10000", () => {
    expect(queryAstSchema.safeParse({ ...baseQuery(), limit: 10001 }).success).toBe(false)
  })

  it("accepts a limit at the 10000 ceiling", () => {
    expect(queryAstSchema.safeParse({ ...baseQuery(), limit: 10000 }).success).toBe(true)
  })

  it("rejects a non-integer limit", () => {
    expect(queryAstSchema.safeParse({ ...baseQuery(), limit: 1.5 }).success).toBe(false)
  })

  it("rejects a negative limit", () => {
    expect(queryAstSchema.safeParse({ ...baseQuery(), limit: -1 }).success).toBe(false)
  })
})
