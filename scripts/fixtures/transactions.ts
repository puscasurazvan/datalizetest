// Pure row generator for transactions_stripe.csv. Columns match
// docs/decisions/01 exactly. created_at is always ISO 8601 with a Z offset —
// this fixture never carries a naive timestamp, unlike the other two.

import { applyDirtyOverrides, type DirtyOverrides } from "./dirty"
import { pad } from "./format"
import { COUNTRIES, FULL_NAMES } from "./pools"
import { chance, nextDecimal, nextInt, pick, type Rng } from "./prng"
import { formatIsoZ, randomInstantMs } from "./timestamps"

export const HEADER = [
  "id",
  "customer_id",
  "customer_name",
  "amount",
  "currency",
  "status",
  "created_at",
  "plan_name",
  "country",
] as const

const CURRENCIES = ["USD", "GBP", "EUR"] as const
const STATUSES = ["succeeded", "succeeded", "succeeded", "failed", "refunded"] as const
const PLANS = ["starter", "pro", "enterprise"] as const
const CUSTOMER_POOL_SIZE = 500

// Row indices (0-based, header excluded) carrying deliberately dirty values.
// Kept low so they land inside the first-10,000-row type-inference sample
// even for the 1,000,000-row variant. See tests/fixtures/README.md.
export const DIRTY_ROWS: DirtyOverrides = new Map([
  [3, { amount: "N/A" }], // unparseable decimal
  [7, { amount: "$1,234.56" }], // currency-formatted decimal
  [11, { customer_id: "0001234" }], // leading-zero identifier, must stay a string
  [15, { plan_name: "" }], // empty cell on a nullable column
  [19, { customer_name: 'Acme, "The Best" Co.\nSecond line' }], // comma + quote + newline in one field
])

function generateRow(rng: Rng, index: number): string[] {
  const id = `tx${pad(index + 1, 7)}`
  const customerId = `c${pad(nextInt(rng, 1, CUSTOMER_POOL_SIZE), 6)}`
  const customerName = pick(rng, FULL_NAMES)
  const amount = nextDecimal(rng, 5, 5000, 2).toFixed(2)
  const currency = pick(rng, CURRENCIES)
  const status = pick(rng, STATUSES)
  const createdAt = formatIsoZ(randomInstantMs(rng))
  const planName = chance(rng, 0.15) ? "" : pick(rng, PLANS)
  const country = pick(rng, COUNTRIES)

  return [id, customerId, customerName, amount, currency, status, createdAt, planName, country]
}

/** Yields `count` data rows (header not included), applying dirty overrides in place. */
export function* generateRows(rng: Rng, count: number): Generator<string[]> {
  for (let index = 0; index < count; index++) {
    const row = generateRow(rng, index)
    yield applyDirtyOverrides(HEADER, row, DIRTY_ROWS, index)
  }
}
