// Pure row generator for the wide variant, which exercises the 100-column
// ceiling (docs/decisions/01). It is transactions_stripe's 9 columns plus 91
// synthetic metric columns — it does NOT match decision 01's canonical
// column list, so it is generated on demand and never committed.

import { pad } from "./format"
import { chance, nextDecimal, type Rng } from "./prng"
import {
  generateRows as generateTransactionRows,
  HEADER as TRANSACTIONS_HEADER,
} from "./transactions"

const EXTRA_COLUMN_COUNT = 91
const CATEGORIES = ["a", "b", "c", "d"] as const

const EXTRA_COLUMNS = Array.from(
  { length: EXTRA_COLUMN_COUNT },
  (_, i) => `metric_${pad(i + 1, 2)}`,
)

export const HEADER = [...TRANSACTIONS_HEADER, ...EXTRA_COLUMNS] as const

function generateExtraCells(rng: Rng): string[] {
  const cells: string[] = []
  for (let i = 0; i < EXTRA_COLUMN_COUNT; i++) {
    const isNumeric = i % 2 === 0
    if (isNumeric) {
      cells.push(nextDecimal(rng, 0, 1000, 2).toFixed(2))
      continue
    }
    const category = CATEGORIES[i % CATEGORIES.length] ?? CATEGORIES[0]
    cells.push(chance(rng, 0.1) ? "" : category)
  }
  return cells
}

/** Yields `count` data rows (header not included) at the 100-column width. */
export function* generateRows(rng: Rng, count: number): Generator<string[]> {
  for (const baseRow of generateTransactionRows(rng, count)) {
    yield [...baseRow, ...generateExtraCells(rng)]
  }
}
