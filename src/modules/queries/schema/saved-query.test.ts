import { describe, expect, it } from "vitest"

import {
  SAVED_QUERY_NAME_MAX_LENGTH,
  parseSavedQueryAst,
  parseSavedQueryVisualization,
  savedQueryNameSchema,
} from "./saved-query"

const VALID_AST = {
  version: 1,
  datasetId: "dataset-1",
  dimensions: [],
  measures: [{ field: null, aggregation: "count", alias: "n" }],
  filters: [],
}

const VALID_TABLE_VISUALIZATION = { type: "table" }

describe("savedQueryNameSchema", () => {
  it("accepts a plain name and trims surrounding whitespace", () => {
    expect(savedQueryNameSchema.parse("  Monthly Revenue  ")).toBe("Monthly Revenue")
  })

  it("rejects an empty (or whitespace-only) name", () => {
    expect(savedQueryNameSchema.safeParse("").success).toBe(false)
    expect(savedQueryNameSchema.safeParse("   ").success).toBe(false)
  })

  it("rejects a name over the max length", () => {
    const tooLong = "x".repeat(SAVED_QUERY_NAME_MAX_LENGTH + 1)
    expect(savedQueryNameSchema.safeParse(tooLong).success).toBe(false)
  })

  it("accepts a name exactly at the max length", () => {
    const atLimit = "x".repeat(SAVED_QUERY_NAME_MAX_LENGTH)
    expect(savedQueryNameSchema.safeParse(atLimit).success).toBe(true)
  })
})

describe("parseSavedQueryAst", () => {
  it("parses a stored value that matches queryAstSchema", () => {
    expect(parseSavedQueryAst("sq-1", VALID_AST)).toEqual(VALID_AST)
  })

  it("throws a plain Error — never an AppError, never a ZodError — for a value that no longer parses", () => {
    const malformed = { version: 1, datasetId: "dataset-1" } // missing dimensions/measures/filters

    let thrown: unknown
    try {
      parseSavedQueryAst("sq-1", malformed)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toHaveProperty("code") // not an AppError
    expect((thrown as Error).name).not.toBe("ZodError")
    expect((thrown as Error).message).toContain("sq-1")
  })

  it("rejects a completely unrelated shape (e.g. null, or a stray string)", () => {
    expect(() => parseSavedQueryAst("sq-2", null)).toThrow()
    expect(() => parseSavedQueryAst("sq-2", "not an ast")).toThrow()
  })
})

describe("parseSavedQueryVisualization", () => {
  it("parses a stored value that matches visualizationConfigSchema", () => {
    expect(parseSavedQueryVisualization("sq-1", VALID_TABLE_VISUALIZATION)).toEqual(
      VALID_TABLE_VISUALIZATION,
    )
  })

  it("parses a bar config", () => {
    const bar = {
      type: "bar",
      categoryField: { kind: "dimension", columnId: "col_region" },
      valueField: { kind: "measure", alias: "n" },
    }
    expect(parseSavedQueryVisualization("sq-1", bar)).toEqual(bar)
  })

  it("throws a plain Error for a value that no longer parses", () => {
    let thrown: unknown
    try {
      parseSavedQueryVisualization("sq-1", { type: "line" }) // not a Slice 1 chart type
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toHaveProperty("code")
    expect((thrown as Error).message).toContain("sq-1")
  })
})
