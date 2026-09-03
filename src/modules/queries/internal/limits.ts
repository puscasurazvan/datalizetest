/**
 * Row-limit arithmetic (docs/decisions/05 "Summary Table" + "Implications for
 * Slice 1" #1). Pure and store-agnostic on purpose: the compiler binds
 * `engineLimit` as `LIMIT $n`, the store runs the query, and this module never
 * imports either — see queries/CLAUDE.md "Limits & execution".
 */

// The one product-wide row cap. `query-ast.ts` imports this for its own
// `.max()` so the two 10,000s the plan calls out (G11) can't drift apart.
export const MAX_ROWS = 10_000

export interface RowLimits {
  readonly effectiveLimit: number
  readonly engineLimit: number
}

/**
 * `??`, never `||`: a user-supplied `limit: 0` (docs/decisions/05:458, an
 * existence probe) is falsy but must NOT fall back to MAX_ROWS.
 */
export function rowLimits(limit: number | undefined): RowLimits {
  const effectiveLimit = Math.min(limit ?? MAX_ROWS, MAX_ROWS)
  return { effectiveLimit, engineLimit: effectiveLimit + 1 }
}

export interface FinishedRows<T> {
  readonly rows: readonly T[]
  readonly rowCount: number
  readonly hasMore: boolean
  readonly truncated: boolean
}

/**
 * `raw` is whatever the store returned for `LIMIT engineLimit` — at most
 * `effectiveLimit + 1` rows. One extra row over `effectiveLimit` means more
 * exist; drop it. `truncated` is `hasMore` narrowed to the case that's the
 * product's fault, not the user's: `effectiveLimit` only lands on MAX_ROWS
 * when the 10,000 cap did the clamping, per decisions/05:447.
 */
export function finishRows<T>(raw: readonly T[], effectiveLimit: number): FinishedRows<T> {
  const hasMore = raw.length > effectiveLimit
  const rows = hasMore ? raw.slice(0, effectiveLimit) : raw
  return {
    rows,
    rowCount: rows.length,
    hasMore,
    truncated: hasMore && effectiveLimit === MAX_ROWS,
  }
}
