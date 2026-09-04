/**
 * Zod parse boundary for `VisualizationConfig` — the shape stored in the
 * `saved_queries.visualization` / `dashboard_widgets` jsonb columns. A jsonb
 * column comes back untyped (`unknown`); this is what turns it back into a
 * `VisualizationConfig` the compiler can trust, mirroring the TS interfaces
 * in ./config.ts exactly (proven in config-schema.test.ts via a compile-time
 * equality check, not a runtime one).
 *
 * Strict by construction: every object is `z.strictObject`, so an unknown
 * key on a stored config fails to parse instead of being silently dropped
 * or silently accepted.
 */
import { z } from "zod"
import { VALUE_FORMATS } from "./config"

const MAX_TITLE_LENGTH = 200

const columnIdSchema = z.string().min(1)
const measureAliasSchema = z.string().min(1)
const titleSchema = z.string().max(MAX_TITLE_LENGTH).optional()

/** Mirrors `FieldRef` in ./config.ts: a Column ID for a raw dimension, or a
 * user-chosen alias for an aggregated measure — never a bare string. */
export const fieldRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dimension"), columnId: columnIdSchema }),
  z.strictObject({ kind: z.literal("measure"), alias: measureAliasSchema }),
])

const tableConfigSchema = z.strictObject({
  type: z.literal("table"),
  title: titleSchema,
})

const barConfigSchema = z.strictObject({
  type: z.literal("bar"),
  title: titleSchema,
  categoryField: fieldRefSchema,
  valueField: fieldRefSchema,
  format: z.enum(VALUE_FORMATS).optional(),
})

/** Discriminated on `type` over exactly `table` and `bar` — Slice 1's two
 * chart types (this module's CLAUDE.md). Do not add a third member here
 * without adding it to `VisualizationConfig` in ./config.ts first. */
export const visualizationConfigSchema = z.discriminatedUnion("type", [
  tableConfigSchema,
  barConfigSchema,
])
