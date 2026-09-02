import { z } from "zod"

/**
 * The structured, versioned query contract. Never raw SQL from a user or model
 * (CONTEXT.md, docs/reference/Datalize-architecture-review.md).
 *
 * Columns are named only by opaque Column ID — never by name (docs/adr/0002).
 * Whether an operator, a granularity, or an aggregation fits a given column's
 * type is NOT checked here: this schema only enforces shape. That check needs
 * the dataset's columns and lives in ../internal/validator.ts.
 */

const columnIdSchema = z.string().min(1)

const aliasSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,29}$/, "alias must match ^[a-z][a-z0-9_]{0,29}$")

const granularitySchema = z.enum(["day", "week", "month", "quarter", "year"])

const dimensionSchema = z.strictObject({
  columnId: columnIdSchema,
  granularity: granularitySchema.optional(),
})

const aggregationSchema = z.enum(["count", "count_distinct", "sum", "avg", "min", "max"])

const measureSchema = z
  .strictObject({
    field: columnIdSchema.nullable(),
    aggregation: aggregationSchema,
    alias: aliasSchema,
  })
  .refine((measure) => measure.field !== null || measure.aggregation === "count", {
    message: "field may be null only when aggregation is 'count' (count-all)",
    path: ["field"],
  })

// A single filter value, as it arrives over JSON: string columns and
// timestamptz (ISO 8601) carry a string, integer/decimal carry a finite
// number, boolean carries a boolean. Whether the value's JS type actually
// matches the referenced column's Datalize type is left to the compiler,
// not checked here or in the validator.
const filterValueSchema = z.union([z.string(), z.number().finite(), z.boolean()])

const comparisonFilterSchema = z.strictObject({
  columnId: columnIdSchema,
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
  value: filterValueSchema,
})

const betweenFilterSchema = z.strictObject({
  columnId: columnIdSchema,
  operator: z.literal("between"),
  value: z.tuple([filterValueSchema, filterValueSchema]),
})

const inFilterSchema = z.strictObject({
  columnId: columnIdSchema,
  operator: z.literal("in"),
  value: z.array(filterValueSchema).min(1),
})

const nullFilterSchema = z.strictObject({
  columnId: columnIdSchema,
  operator: z.enum(["is_null", "is_not_null"]),
})

const filterSchema = z.discriminatedUnion("operator", [
  comparisonFilterSchema,
  betweenFilterSchema,
  inFilterSchema,
  nullFilterSchema,
])

const sortDirectionSchema = z.enum(["asc", "desc"])

// A discriminated ref, never a bare string field: a user-supplied alias could
// otherwise collide with a Column ID (docs/decisions/06 #9).
const orderBySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("dimension"),
    columnId: columnIdSchema,
    direction: sortDirectionSchema,
  }),
  z.strictObject({
    kind: z.literal("measure"),
    alias: aliasSchema,
    direction: sortDirectionSchema,
  }),
])

export const queryAstSchema = z
  .strictObject({
    version: z.literal(1),
    datasetId: z.string().min(1),
    // A dimension-less query (a single KPI-style total, e.g. COUNT(*)) and a
    // measure-less query (dimension-only, e.g. distinct values — docs/decisions/05
    // "Default Ordering, and Why Truncation Needs It") are both legal on their own.
    // Only having neither is meaningless; the superRefine below rejects that case.
    dimensions: z.array(dimensionSchema).max(3),
    measures: z.array(measureSchema).max(5),
    filters: z.array(filterSchema).max(10),
    orderBy: z.array(orderBySchema).optional(),
    // 0 is a legal limit — an existence probe ("does this match anything?"),
    // with defined semantics in docs/decisions/05:449 (returnedRows: [], hasMore
    // reflects whether any row exists, truncated: false). Only negative and
    // non-integer values are rejected.
    limit: z.number().int().min(0).max(10000).optional(),
  })
  .superRefine((query, ctx) => {
    if (query.dimensions.length === 0 && query.measures.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "a query needs at least one dimension or one measure",
        path: ["measures"],
      })
    }

    // A measure alias must collide with neither another alias nor a dimension's
    // Column ID: orderBy resolves a bare name to either kind (docs/decisions/06 #9),
    // and downstream, a query result keys rows by that same name (docs/decisions/05),
    // so either collision makes one entry silently unreachable.
    const dimensionColumnIds = new Set(query.dimensions.map((dimension) => dimension.columnId))
    const seenAliases = new Set<string>()
    query.measures.forEach((measure, index) => {
      if (dimensionColumnIds.has(measure.alias)) {
        ctx.addIssue({
          code: "custom",
          message: `measure alias "${measure.alias}" collides with a dimension's Column ID`,
          path: ["measures", index, "alias"],
        })
      }

      if (seenAliases.has(measure.alias)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate measure alias "${measure.alias}" — aliases must be unique`,
          path: ["measures", index, "alias"],
        })
        return
      }
      seenAliases.add(measure.alias)
    })
  })

export type QueryAst = z.infer<typeof queryAstSchema>
export type Dimension = z.infer<typeof dimensionSchema>
export type Measure = z.infer<typeof measureSchema>
export type Filter = z.infer<typeof filterSchema>
export type FilterOperator = Filter["operator"]
export type FilterValue = z.infer<typeof filterValueSchema>
export type OrderBy = z.infer<typeof orderBySchema>
export type Granularity = z.infer<typeof granularitySchema>
export type Aggregation = z.infer<typeof aggregationSchema>
