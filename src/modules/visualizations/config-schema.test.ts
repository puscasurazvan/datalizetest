import { describe, expect, it } from "vitest"

import type {
  BarVisualizationConfig,
  FieldRef,
  TableVisualizationConfig,
  VisualizationConfig,
} from "./config"
import { fieldRefSchema, visualizationConfigSchema } from "./config-schema"

// --- Compile-time equality: config.ts's interfaces must agree exactly with
// what config-schema.ts's Zod schemas infer, so a future edit to either side
// (a renamed field, a forgotten `| undefined` widening, a dropped optional
// field) fails typecheck instead of drifting apart silently.
//
// `Equal` is the strict type-identity check (not mere assignability — plain
// mutual `extends` would call a schema that's missing an optional field
// "equal" to one that has it, since a missing optional prop satisfies both
// directions). `Writable` strips config.ts's `readonly` modifiers first,
// since a plain Zod `z.infer` never produces one and that mismatch is not
// the drift this check exists to catch. Both are written as conditional
// types over a naked `T` so they distribute over a union like
// VisualizationConfig and FieldRef instead of collapsing it.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 0) extends <T>() => T extends B ? 1 : 0 ? true : false
// Recursive: BarVisualizationConfig nests FieldRef, which is itself readonly
// two levels down, so a shallow strip would still see a mismatch there.
type Writable<T> = T extends unknown
  ? T extends object
    ? { -readonly [K in keyof T]: Writable<T[K]> }
    : T
  : never

const fieldRefMatchesSchema = true satisfies Equal<
  Writable<FieldRef>,
  ReturnType<typeof fieldRefSchema.parse>
>
const tableConfigMatchesSchema = true satisfies Equal<
  Writable<TableVisualizationConfig>,
  Extract<ReturnType<typeof visualizationConfigSchema.parse>, { type: "table" }>
>
const barConfigMatchesSchema = true satisfies Equal<
  Writable<BarVisualizationConfig>,
  Extract<ReturnType<typeof visualizationConfigSchema.parse>, { type: "bar" }>
>
const visualizationConfigMatchesSchema = true satisfies Equal<
  Writable<VisualizationConfig>,
  ReturnType<typeof visualizationConfigSchema.parse>
>

describe("visualizationConfigSchema types", () => {
  it("agree exactly with config.ts's interfaces (compile-time check above)", () => {
    expect(fieldRefMatchesSchema).toBe(true)
    expect(tableConfigMatchesSchema).toBe(true)
    expect(barConfigMatchesSchema).toBe(true)
    expect(visualizationConfigMatchesSchema).toBe(true)
  })
})

describe("visualizationConfigSchema", () => {
  it("round-trips a valid table config", () => {
    const config: TableVisualizationConfig = { type: "table", title: "Revenue by month" }
    expect(visualizationConfigSchema.parse(config)).toEqual(config)
  })

  it("round-trips a valid bar config", () => {
    const config: BarVisualizationConfig = {
      type: "bar",
      title: "Top customers",
      categoryField: { kind: "dimension", columnId: "col_customer_name" },
      valueField: { kind: "measure", alias: "total_revenue" },
      format: "currency",
    }
    expect(visualizationConfigSchema.parse(config)).toEqual(config)
  })

  it("round-trips a table config with no title", () => {
    const config: TableVisualizationConfig = { type: "table" }
    expect(visualizationConfigSchema.parse(config)).toEqual(config)
  })

  // Matched against a `/./`, not an exact Zod message: this is a parse
  // module, not a Zod-wording contract — pinning literal Zod error text
  // would break on a Zod version bump for a reason unrelated to this
  // schema. oxlint's require-to-throw-message still gets a real assertion
  // that *something* threw, not a silently-vacuous `.toThrow()`.
  const ANY_ERROR = /./

  it("rejects an unknown type", () => {
    expect(() => visualizationConfigSchema.parse({ type: "line" })).toThrow(ANY_ERROR)
  })

  it("rejects an unknown extra key", () => {
    expect(() =>
      visualizationConfigSchema.parse({ type: "table", title: "x", extra: "nope" }),
    ).toThrow(ANY_ERROR)
  })

  it("rejects a bar config missing categoryField", () => {
    expect(() =>
      visualizationConfigSchema.parse({
        type: "bar",
        valueField: { kind: "measure", alias: "total_revenue" },
      }),
    ).toThrow(ANY_ERROR)
  })

  it("rejects a malformed FieldRef", () => {
    expect(() =>
      visualizationConfigSchema.parse({
        type: "bar",
        categoryField: { kind: "dimension" },
        valueField: { kind: "measure", alias: "total_revenue" },
      }),
    ).toThrow(ANY_ERROR)
  })

  it("rejects a FieldRef with an unknown kind", () => {
    expect(() => fieldRefSchema.parse({ kind: "metric", alias: "x" })).toThrow(ANY_ERROR)
  })
})
