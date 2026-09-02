// Applies deliberately-dirty overrides to specific data rows. Each fixture
// generator ships a small map of "row index -> column overrides"; this is
// the one place that turns an override map into an actual row mutation, so
// the three fixture files don't each reimplement the same lookup.

export type DirtyOverrides = ReadonlyMap<number, Readonly<Record<string, string>>>

/** Replaces the named columns of `row` with the override values for `rowIndex`, if any are set. */
export function applyDirtyOverrides(
  header: readonly string[],
  row: readonly string[],
  overrides: DirtyOverrides,
  rowIndex: number,
): string[] {
  const forThisRow = overrides.get(rowIndex)
  if (!forThisRow) return [...row]

  return header.map((column, position) => {
    const override = forThisRow[column]
    return override ?? row[position] ?? ""
  })
}
