import { describe, expect, it } from "vitest"
import type { DatalizeColumnType, ResolvedQuery } from "@/modules/queries"
import { AppError } from "@/shared/errors"

import { compileQuery } from "./compile-query"

const TABLE = `"analytical"."dv_test"`
const TZ = "America/New_York"

function col(id: string, name: string, type: DatalizeColumnType) {
  return { id, name, type }
}

// Every id/name/alias below is deliberately distinctive so a leak into
// `text` is unmistakable — see "never leaks a Column ID, alias, or value".
const statusColumn = col("col_status_LEAK", "status", "string")
const amountColumn = col("col_amount_LEAK", "amount", "decimal")
const createdAtColumn = col("col_created_at_LEAK", "created_at", "timestamptz")
const signupDateColumn = col("col_signup_date_LEAK", "signup_date", "date")

const mapping = new Map([
  [statusColumn.id, "c_0"],
  [amountColumn.id, "c_1"],
  [createdAtColumn.id, "c_2"],
  [signupDateColumn.id, "c_3"],
])

function baseQuery(overrides: Partial<ResolvedQuery>): ResolvedQuery {
  return {
    version: 1,
    datasetId: "dataset_1",
    dimensions: [],
    measures: [{ column: null, aggregation: "count", alias: "n" }],
    filters: [],
    ...overrides,
  }
}

function compile(query: ResolvedQuery, engineLimit = 51) {
  return compileQuery(query, mapping, TABLE, TZ, engineLimit)
}

describe("compileQuery — leak-proofing", () => {
  it("never puts a Column ID, alias, physical-name-shaped literal, or filter value in `text`", () => {
    const result = compile(
      baseQuery({
        dimensions: [{ column: statusColumn }],
        measures: [{ column: amountColumn, aggregation: "sum", alias: "total_alias_LEAK" }],
        filters: [{ operator: "eq", column: statusColumn, value: "SECRET_VALUE_LEAK" }],
      }),
    )

    expect(result.text).not.toContain("LEAK")
    expect(result.text).not.toMatch(/\$\{|SECRET_VALUE/)
    // Only `$n` binds and quoted, registry-derived physical names appear.
    expect(result.text).toContain('"c_0"')
    expect(result.text).toContain('"c_1"')
    expect(result.text).toMatch(/\$1/)
    expect(result.values).toContain("SECRET_VALUE_LEAK")
  })
})

describe("compileQuery — ordering", () => {
  it("defaults to the first measure, descending, when orderBy is absent", () => {
    const result = compile(
      baseQuery({
        dimensions: [{ column: statusColumn }],
        measures: [{ column: amountColumn, aggregation: "sum", alias: "total" }],
      }),
    )
    expect(result.text).toMatch(/ORDER BY sum\("c_1"\) DESC/)
  })

  it("defaults to the first dimension, ascending, for a dimension-only (measure-less) query", () => {
    const result = compile(baseQuery({ dimensions: [{ column: statusColumn }], measures: [] }))
    expect(result.text).toMatch(/ORDER BY "c_0" ASC/)
  })

  it("orderBy: [] takes the default rather than emitting an empty ORDER BY", () => {
    const withEmpty = compile(
      baseQuery({
        dimensions: [{ column: statusColumn }],
        measures: [{ column: amountColumn, aggregation: "sum", alias: "total" }],
        orderBy: [],
      }),
    )
    const withoutKey = compile(
      baseQuery({
        dimensions: [{ column: statusColumn }],
        measures: [{ column: amountColumn, aggregation: "sum", alias: "total" }],
      }),
    )
    expect(withEmpty.text).toBe(withoutKey.text)
  })

  it("an explicit orderBy replaces the default", () => {
    const result = compile(
      baseQuery({
        dimensions: [{ column: statusColumn }],
        measures: [{ column: amountColumn, aggregation: "sum", alias: "total" }],
        orderBy: [{ kind: "dimension", columnId: statusColumn.id, direction: "asc" }],
      }),
    )
    expect(result.text).toMatch(/ORDER BY "c_0" ASC/)
    expect(result.text).not.toMatch(/"c_1" DESC/)
  })

  it("ORDER BY names the un-cast expression — never ::text, never an ordinal", () => {
    const result = compile(
      baseQuery({
        dimensions: [{ column: createdAtColumn, granularity: "month" }],
        measures: [{ column: amountColumn, aggregation: "sum", alias: "total" }],
        orderBy: [{ kind: "dimension", columnId: createdAtColumn.id, direction: "asc" }],
      }),
    )
    const orderByFragment = result.text.slice(result.text.indexOf("ORDER BY"))
    expect(orderByFragment).not.toContain("::text")
    expect(orderByFragment).toMatch(
      /^ORDER BY date_trunc\('month', "c_2" AT TIME ZONE '[^']+'\)::date ASC/,
    )
  })
})

describe("compileQuery — SELECT aliasing (ORDER BY name-collision regression)", () => {
  // Real Postgres, not just this file's regex assertions, is what proves
  // this: a bare `"c_0"::text` with no alias is itself still named `c_0`,
  // and `ORDER BY "c_0"` then binds to that *output* column (sorting the
  // text cast) rather than the input one — see this function's own doc
  // comment and execute-query.integration.test.ts's
  // "orders an integer dimension numerically" case, which failed against a
  // live database before `AS "s{i}"` was added. This test only pins the
  // shape that fix depends on, so a future edit can't silently drop it.
  it("gives every SELECT item a positional alias — s0, s1, … — that carries no Column ID or measure alias", () => {
    const result = compile(
      baseQuery({
        dimensions: [{ column: statusColumn }],
        measures: [{ column: amountColumn, aggregation: "sum", alias: "total" }],
      }),
    )
    expect(result.text).toContain('"c_0"::text AS "s0"')
    expect(result.text).toContain('sum("c_1")::text AS "s1"')
  })
})

describe("compileQuery — granularity and column types (G5)", () => {
  it("projects date_trunc(...)::date for a timestamptz granularity dimension", () => {
    const result = compile(
      baseQuery({ dimensions: [{ column: createdAtColumn, granularity: "month" }], measures: [] }),
    )
    expect(result.text).toContain(`date_trunc('month', "c_2" AT TIME ZONE '${TZ}')::date::text`)
  })

  it("emits no date_trunc for a plain (non-granularity) date column", () => {
    const result = compile(baseQuery({ dimensions: [{ column: signupDateColumn }], measures: [] }))
    expect(result.text).not.toContain("date_trunc")
    expect(result.text).toContain('"c_3"::text')
  })
})

describe("compileQuery — GROUP BY (G1)", () => {
  it("omits GROUP BY entirely for a zero-dimension (bare aggregate) query", () => {
    const result = compile(
      baseQuery({
        dimensions: [],
        measures: [{ column: amountColumn, aggregation: "sum", alias: "total" }],
      }),
    )
    expect(result.text).not.toContain("GROUP BY")
  })

  it("emits GROUP BY over the dimension expressions when dimensions are present", () => {
    const result = compile(
      baseQuery({
        dimensions: [{ column: statusColumn }],
        measures: [{ column: amountColumn, aggregation: "sum", alias: "total" }],
      }),
    )
    expect(result.text).toContain('GROUP BY "c_0"')
  })
})

describe("compileQuery — measures", () => {
  it("count-all compiles to count(*)", () => {
    const result = compile(baseQuery({}))
    expect(result.text).toContain("count(*)")
  })

  it("count_distinct compiles to count(DISTINCT col)", () => {
    const result = compile(
      baseQuery({
        measures: [{ column: statusColumn, aggregation: "count_distinct", alias: "n" }],
      }),
    )
    expect(result.text).toContain('count(DISTINCT "c_0")')
  })

  it("sum/avg/min/max compile to their own SQL function name", () => {
    for (const aggregation of ["sum", "avg", "min", "max"] as const) {
      const result = compile(
        baseQuery({ measures: [{ column: amountColumn, aggregation, alias: "m" }] }),
      )
      expect(result.text).toContain(`${aggregation}("c_1")`)
    }
  })
})

describe("compileQuery — filters (G2)", () => {
  it("is_null / is_not_null bind nothing", () => {
    const isNull = compile(baseQuery({ filters: [{ operator: "is_null", column: statusColumn }] }))
    expect(isNull.text).toContain('"c_0" IS NULL')
    expect(isNull.values).toHaveLength(1) // just the LIMIT bind

    const isNotNull = compile(
      baseQuery({ filters: [{ operator: "is_not_null", column: statusColumn }] }),
    )
    expect(isNotNull.text).toContain('"c_0" IS NOT NULL')
    expect(isNotNull.values).toHaveLength(1)
  })

  it("between binds two values", () => {
    const result = compile(
      baseQuery({ filters: [{ operator: "between", column: amountColumn, value: [10, 20] }] }),
    )
    expect(result.text).toMatch(/"c_1" BETWEEN \$1 AND \$2/)
    expect(result.values.slice(0, 2)).toEqual([10, 20])
  })

  it("in compiles to IN ($1, $2, …) with individual binds — never = ANY($1)", () => {
    const result = compile(
      baseQuery({
        filters: [
          { operator: "in", column: signupDateColumn, value: ["2026-01-01", "2026-02-01"] },
        ],
      }),
    )
    expect(result.text).toMatch(/"c_3" IN \(\$1, \$2\)/)
    expect(result.text).not.toContain("ANY(")
    expect(result.values.slice(0, 2)).toEqual(["2026-01-01", "2026-02-01"])
  })

  it("a comparison operator binds one value", () => {
    const result = compile(
      baseQuery({ filters: [{ operator: "gte", column: amountColumn, value: 100 }] }),
    )
    expect(result.text).toMatch(/"c_1" >= \$1/)
    expect(result.values[0]).toBe(100)
  })
})

describe("compileQuery — timezone", () => {
  it("rejects a timezone outside the canonical allowlist before any interpolation", () => {
    expect(() => compile(baseQuery({}), 51)).not.toThrow() // sanity: TZ itself is valid
    expect(() => compileQuery(baseQuery({}), mapping, TABLE, "Not/AZone", 51)).toThrow(AppError)
  })
})

describe("compileQuery — limit", () => {
  it("binds engineLimit — never a literal in `text`", () => {
    const result = compile(baseQuery({}), 12345)
    expect(result.text).not.toContain("12345")
    expect(result.values.at(-1)).toBe(12345)
    expect(result.text).toMatch(/LIMIT \$\d+$/)
  })
})
