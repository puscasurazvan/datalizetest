import { describe, expect, it } from "vitest"

import type { BarVisualizationConfig, TableVisualizationConfig } from "./config"
import type { QueryResultShape } from "./validate"
import { validateVisualizationConfig } from "./validate"

const monthDimension = { name: "col_month", type: "timestamptz" } as const
const revenueMeasure = { name: "total_revenue", type: "decimal" } as const
const nameDimension = { name: "col_customer_name", type: "string" } as const
const countMeasure = { name: "signup_count", type: "integer" } as const
const signupDateDimension = { name: "col_signup_date", type: "date" } as const

const resultWith = (columns: QueryResultShape["columns"]): QueryResultShape => ({
  columns,
  rowCount: columns.length === 0 ? 0 : 3,
  truncated: false,
})

describe("validateVisualizationConfig — table", () => {
  it("is always ok, since a table has no fields to check against the result", () => {
    const config: TableVisualizationConfig = { type: "table" }
    const result = resultWith([monthDimension, revenueMeasure])

    expect(validateVisualizationConfig(config, result)).toEqual({ ok: true })
  })

  it("is ok even against an empty result", () => {
    const config: TableVisualizationConfig = { type: "table" }

    expect(validateVisualizationConfig(config, resultWith([]))).toEqual({ ok: true })
  })
})

describe("validateVisualizationConfig — bar", () => {
  it("is ok when the category is groupable and the value is numeric", () => {
    const config: BarVisualizationConfig = {
      type: "bar",
      categoryField: { kind: "dimension", columnId: "col_month" },
      valueField: { kind: "measure", alias: "total_revenue" },
    }
    const result = resultWith([monthDimension, revenueMeasure])

    expect(validateVisualizationConfig(config, result)).toEqual({ ok: true })
  })

  it("is ok for an integer measure value field", () => {
    const config: BarVisualizationConfig = {
      type: "bar",
      categoryField: { kind: "dimension", columnId: "col_customer_name" },
      valueField: { kind: "measure", alias: "signup_count" },
    }
    const result = resultWith([nameDimension, countMeasure])

    expect(validateVisualizationConfig(config, result)).toEqual({ ok: true })
  })

  it("reports the category field when it is absent from the result", () => {
    const config: BarVisualizationConfig = {
      type: "bar",
      categoryField: { kind: "dimension", columnId: "col_missing" },
      valueField: { kind: "measure", alias: "total_revenue" },
    }
    const result = resultWith([monthDimension, revenueMeasure])

    expect(validateVisualizationConfig(config, result)).toEqual({
      ok: false,
      mismatch: {
        kind: "field_not_found",
        role: "category",
        field: { kind: "dimension", columnId: "col_missing" },
      },
    })
  })

  it("reports the value field when it is absent from the result", () => {
    const config: BarVisualizationConfig = {
      type: "bar",
      categoryField: { kind: "dimension", columnId: "col_month" },
      valueField: { kind: "measure", alias: "missing_alias" },
    }
    const result = resultWith([monthDimension, revenueMeasure])

    expect(validateVisualizationConfig(config, result)).toEqual({
      ok: false,
      mismatch: {
        kind: "field_not_found",
        role: "value",
        field: { kind: "measure", alias: "missing_alias" },
      },
    })
  })

  it("reports a value field that is not numeric", () => {
    const config: BarVisualizationConfig = {
      type: "bar",
      categoryField: { kind: "dimension", columnId: "col_month" },
      valueField: { kind: "dimension", columnId: "col_customer_name" },
    }
    const result = resultWith([monthDimension, nameDimension])

    expect(validateVisualizationConfig(config, result)).toEqual({
      ok: false,
      mismatch: {
        kind: "value_not_numeric",
        field: { kind: "dimension", columnId: "col_customer_name" },
        actualType: "string",
      },
    })
  })

  it("reports a category field that is not groupable", () => {
    const config: BarVisualizationConfig = {
      type: "bar",
      categoryField: { kind: "measure", alias: "total_revenue" },
      valueField: { kind: "measure", alias: "signup_count" },
    }
    const result = resultWith([revenueMeasure, countMeasure])

    expect(validateVisualizationConfig(config, result)).toEqual({
      ok: false,
      mismatch: {
        kind: "category_not_groupable",
        field: { kind: "measure", alias: "total_revenue" },
        actualType: "decimal",
      },
    })
  })

  it("treats a calendar date category field as groupable (docs/decisions/03: the six canonical Datalize types)", () => {
    const config: BarVisualizationConfig = {
      type: "bar",
      categoryField: { kind: "dimension", columnId: "col_signup_date" },
      valueField: { kind: "measure", alias: "signup_count" },
    }
    const result = resultWith([signupDateDimension, countMeasure])

    expect(validateVisualizationConfig(config, result)).toEqual({ ok: true })
  })

  it("treats a boolean category field as groupable", () => {
    const config: BarVisualizationConfig = {
      type: "bar",
      categoryField: { kind: "dimension", columnId: "col_is_active" },
      valueField: { kind: "measure", alias: "signup_count" },
    }
    const result = resultWith([{ name: "col_is_active", type: "boolean" }, countMeasure])

    expect(validateVisualizationConfig(config, result)).toEqual({ ok: true })
  })

  it("checks the category field before the value field when both are missing", () => {
    const config: BarVisualizationConfig = {
      type: "bar",
      categoryField: { kind: "dimension", columnId: "col_missing_category" },
      valueField: { kind: "measure", alias: "missing_value" },
    }

    expect(validateVisualizationConfig(config, resultWith([]))).toEqual({
      ok: false,
      mismatch: {
        kind: "field_not_found",
        role: "category",
        field: { kind: "dimension", columnId: "col_missing_category" },
      },
    })
  })
})
