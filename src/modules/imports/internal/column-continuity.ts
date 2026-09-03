/**
 * Column ID continuity across Dataset Versions (CONTEXT.md "Column ID",
 * docs/decisions/02(c)). Pure: no I/O, no ID generation policy beyond
 * `crypto.randomUUID()` for a genuinely new column.
 *
 * A column carries its Column ID into the next version only when both its
 * name AND type are unchanged from the dataset's current version. A rename
 * or retype mints a new Column ID; the old one is simply not carried
 * forward — previous versions are immutable and never annotated, so the
 * absence of the old id in the new version is the only signal (CONTEXT.md).
 *
 * Matching is by exact name (case-sensitive), matching `dataset_columns`'
 * own `unique(organization_id, dataset_version_id, name)` — decisions/02's
 * example table matches this literally: `plan` -> `plan_name` mints a new
 * id because the *name* changed, even though nothing about the type did.
 */
import { randomUUID } from "node:crypto"

import type { DatalizeType } from "./inference"

export interface PreviousColumn {
  readonly columnId: string
  readonly name: string
  readonly type: DatalizeType
}

export interface NewColumn {
  readonly position: number
  readonly name: string
  readonly type: DatalizeType
}

export interface ResolvedColumn extends NewColumn {
  readonly columnId: string
}

/**
 * `previousColumns` is empty for a dataset's first version (nothing to
 * continue from) — every column mints a fresh id, which is just the
 * general case with no match ever found.
 */
export function resolveColumnIds(
  previousColumns: readonly PreviousColumn[],
  newColumns: readonly NewColumn[],
): readonly ResolvedColumn[] {
  const previousByName = new Map<string, PreviousColumn>(
    previousColumns.map((column) => [column.name, column] as const),
  )

  return newColumns.map((column): ResolvedColumn => {
    const previous = previousByName.get(column.name)
    const continues = previous !== undefined && previous.type === column.type
    return { ...column, columnId: continues ? previous.columnId : randomUUID() }
  })
}
