/**
 * Validates a VisualizationConfig against the shape of the QueryResult it
 * would render — a config referencing a column or alias absent from the
 * result is a render-time error state, never a crash
 * (src/modules/visualizations/CLAUDE.md).
 */
import {
  type BarVisualizationConfig,
  type FieldRef,
  type VisualizationConfig,
  fieldRefName,
} from "./config"

/**
 * The Datalize type tag every result column carries — the six canonical
 * types (docs/decisions/03 "Three Kinds of Date/Time Value", amending
 * decisions/04's original five-type list to add `date`; docs/decisions/06
 * #11). "date" is a calendar date only — never passed through
 * `AT TIME ZONE`. "datetime" names an input shape, never a column type:
 * every datetime-shaped input, offset-bearing or naive, is `timestamptz`.
 *
 * DECISION: defined locally rather than imported, because the real
 * QueryResult contract lives in src/modules/queries, which does not exist
 * yet in this repo. This must be unified with that module's QueryResult
 * once the executor lands — see decisions below.
 */
export const DATALIZE_COLUMN_TYPES = [
  "string",
  "integer",
  "decimal",
  "boolean",
  "date",
  "timestamptz",
] as const
export type DatalizeColumnType = (typeof DATALIZE_COLUMN_TYPES)[number]

export interface QueryResultColumn {
  readonly name: string
  readonly type: DatalizeColumnType
}

/**
 * The shape of a Query Result this module validates a config against — a
 * structural stand-in for docs/decisions/05's QueryResult (columns, row
 * count, truncated flag), not the result contract itself. See the note on
 * DATALIZE_COLUMN_TYPES above.
 */
export interface QueryResultShape {
  readonly columns: readonly QueryResultColumn[]
  readonly rowCount: number
  readonly truncated: boolean
}

const NUMERIC_TYPES = new Set<DatalizeColumnType>(["integer", "decimal"])

// A decimal/continuous measure is not a meaningful bar-chart category —
// it belongs on the value field, not the category field.
const GROUPABLE_TYPES = new Set<DatalizeColumnType>([
  "string",
  "integer",
  "boolean",
  "date",
  "timestamptz",
])

export type ConfigMismatch =
  | {
      readonly kind: "field_not_found"
      readonly role: "category" | "value"
      readonly field: FieldRef
    }
  | {
      readonly kind: "value_not_numeric"
      readonly field: FieldRef
      readonly actualType: DatalizeColumnType
    }
  | {
      readonly kind: "category_not_groupable"
      readonly field: FieldRef
      readonly actualType: DatalizeColumnType
    }

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly mismatch: ConfigMismatch }

export function validateVisualizationConfig(
  config: VisualizationConfig,
  result: QueryResultShape,
): ValidationResult {
  if (config.type === "table") {
    // A table renders whatever columns the result carries — it names no
    // field of its own to check against the result.
    return { ok: true }
  }
  return validateBarConfig(config, result)
}

function validateBarConfig(
  config: BarVisualizationConfig,
  result: QueryResultShape,
): ValidationResult {
  const categoryColumn = findColumn(result, config.categoryField)
  if (!categoryColumn) {
    return {
      ok: false,
      mismatch: { kind: "field_not_found", role: "category", field: config.categoryField },
    }
  }
  if (!GROUPABLE_TYPES.has(categoryColumn.type)) {
    return {
      ok: false,
      mismatch: {
        kind: "category_not_groupable",
        field: config.categoryField,
        actualType: categoryColumn.type,
      },
    }
  }

  const valueColumn = findColumn(result, config.valueField)
  if (!valueColumn) {
    return {
      ok: false,
      mismatch: { kind: "field_not_found", role: "value", field: config.valueField },
    }
  }
  if (!NUMERIC_TYPES.has(valueColumn.type)) {
    return {
      ok: false,
      mismatch: {
        kind: "value_not_numeric",
        field: config.valueField,
        actualType: valueColumn.type,
      },
    }
  }

  return { ok: true }
}

function findColumn(result: QueryResultShape, field: FieldRef): QueryResultColumn | undefined {
  const name = fieldRefName(field)
  return result.columns.find((column) => column.name === name)
}
