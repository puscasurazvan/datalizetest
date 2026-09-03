/**
 * `imports.proposed_schema` / `imports.confirmed_schema` are untyped `jsonb`
 * columns (Slice 1 schema notes: "Zod-parse at the boundary"). This module
 * is that boundary — the only place either column's shape is declared.
 *
 * Proposed schema: written by `import.profile` (../internal/profile.ts),
 * one entry per `inferColumns` result (docs/decisions/06 #1-2). Confirmed
 * schema: written by the confirm step (../internal/confirm.ts) after
 * applying the user's column-type and timezone overrides (docs/decisions/04)
 * — this is what `import.load` (../internal/load.ts) actually loads
 * against, so it additionally carries the one resolved timezone applied to
 * every naive value in this import.
 */
import { z } from "zod"

import { DATALIZE_TYPES } from "./inference"
import type { ColumnDatetimeOffset, DatalizeType, HeaderIssue } from "./inference"

const datalizeTypeSchema = z.enum(DATALIZE_TYPES)

// Keep in sync with ColumnDatetimeOffset / HeaderIssue in ./inference — that
// module is read-only to this one, so these are declared here rather than
// imported as runtime values (only their types are exported).
const datetimeOffsetSchema = z.enum(["explicit", "naive", "mixed"])
const headerIssueSchema = z.enum(["bom_stripped", "blank_header", "duplicate_header"])

export const proposedSchemaColumnSchema = z.strictObject({
  position: z.number().int().positive(),
  name: z.string().min(1),
  originalHeader: z.string(),
  headerRenamed: z.boolean(),
  headerIssues: z.array(headerIssueSchema),
  type: datalizeTypeSchema,
  nullable: z.boolean(),
  unparseableCount: z.number().int().nonnegative(),
  datetimeOffset: datetimeOffsetSchema.optional(),
})

export const proposedSchemaSchema = z.strictObject({
  rowsRead: z.number().int().nonnegative(),
  rowsWithBadFieldCount: z.number().int().nonnegative(),
  columns: z.array(proposedSchemaColumnSchema),
})

export type ProposedSchemaColumn = z.infer<typeof proposedSchemaColumnSchema>
export type ProposedSchema = z.infer<typeof proposedSchemaSchema>

/** One column's final type as the user confirmed it, before or after an override. */
export const confirmedSchemaColumnSchema = z.strictObject({
  position: z.number().int().positive(),
  name: z.string().min(1),
  type: datalizeTypeSchema,
})

/**
 * `timezone` is the ONE timezone actually applied to every naive value in
 * this import (docs/decisions/03 `timezoneUsedForNaiveTimestamps`) — the
 * organization's default or the user's per-import override, already
 * resolved by the confirm step. `import.load` never re-derives it.
 */
export const confirmedSchemaSchema = z.strictObject({
  timezone: z.string().min(1),
  columns: z.array(confirmedSchemaColumnSchema),
})

export type ConfirmedSchemaColumn = z.infer<typeof confirmedSchemaColumnSchema>
export type ConfirmedSchema = z.infer<typeof confirmedSchemaSchema>

/** A user's override of one proposed column's inferred type, by position. */
export const columnOverrideSchema = z.strictObject({
  position: z.number().int().positive(),
  type: datalizeTypeSchema,
})
export type ColumnOverride = z.infer<typeof columnOverrideSchema>

/**
 * Parses a `jsonb` column's value (typed `unknown` by Drizzle) into a
 * `ProposedSchema`/`ConfirmedSchema` — the one boundary crossing this
 * module exists for. Throws `z.ZodError` on a malformed row; callers treat
 * that the same as any other unexpected failure, since a row this module
 * itself wrote should never fail to parse back.
 */
export function parseProposedSchema(value: unknown): ProposedSchema {
  return proposedSchemaSchema.parse(value)
}

export function parseConfirmedSchema(value: unknown): ConfirmedSchema {
  return confirmedSchemaSchema.parse(value)
}

export type { ColumnDatetimeOffset, DatalizeType, HeaderIssue }
