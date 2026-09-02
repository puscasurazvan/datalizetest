// Pure row generator for customers_saaS.csv. Columns match docs/decisions/01
// exactly. created_at and canceled_at are naive local (no offset) — the
// opposite shape from transactions_stripe — and canceled_at is empty for any
// customer who hasn't churned.

import { applyDirtyOverrides, type DirtyOverrides } from "./dirty"
import { pad } from "./format"
import { COUNTRIES, EMAIL_DOMAINS, FULL_NAMES, slugifyName } from "./pools"
import { chance, nextDecimal, pick, type Rng } from "./prng"
import {
  FALL_BACK_OVERLAP,
  formatNaiveLocal,
  randomInstantMs,
  SPRING_FORWARD_GAP,
} from "./timestamps"

export const HEADER = [
  "id",
  "name",
  "email",
  "plan",
  "status",
  "created_at",
  "canceled_at",
  "mrr",
  "country",
] as const

const PLANS = ["starter", "pro", "enterprise"] as const
const STATUSES = ["active", "active", "active", "churned", "paused"] as const

// Row indices (0-based, header excluded) carrying deliberately dirty values.
// Kept low so they land inside the first-10,000-row type-inference sample
// even for the 1,000,000-row variant. See tests/fixtures/README.md.
export const DIRTY_ROWS: DirtyOverrides = new Map([
  [4, { mrr: "N/A" }], // unparseable decimal
  [8, { mrr: "$1,234.56" }], // currency-formatted decimal
  [12, { id: "0005678" }], // leading-zero identifier, must stay a string
  [16, { canceled_at: "" }], // empty cell on a nullable column
  [20, { created_at: SPRING_FORWARD_GAP }], // naive time that never occurred (DST spring-forward)
  [24, { canceled_at: FALL_BACK_OVERLAP }], // naive time that occurred twice (DST fall-back)
  [28, { name: 'O, "Really" Big\nCo' }], // comma + quote + newline in one field
])

function generateRow(rng: Rng, index: number): string[] {
  const id = `c${pad(index + 1, 6)}`
  const name = pick(rng, FULL_NAMES)
  const email = `${slugifyName(name)}${index}@${pick(rng, EMAIL_DOMAINS)}`
  const plan = pick(rng, PLANS)
  const status = pick(rng, STATUSES)
  const createdAt = formatNaiveLocal(randomInstantMs(rng))
  const hasCanceled = status === "churned" || (status === "paused" && chance(rng, 0.5))
  const canceledAt = hasCanceled ? formatNaiveLocal(randomInstantMs(rng)) : ""
  const mrr = nextDecimal(rng, 0, 2000, 2).toFixed(2)
  const country = pick(rng, COUNTRIES)

  return [id, name, email, plan, status, createdAt, canceledAt, mrr, country]
}

/** Yields `count` data rows (header not included), applying dirty overrides in place. */
export function* generateRows(rng: Rng, count: number): Generator<string[]> {
  for (let index = 0; index < count; index++) {
    const row = generateRow(rng, index)
    yield applyDirtyOverrides(HEADER, row, DIRTY_ROWS, index)
  }
}
