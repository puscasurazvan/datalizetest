// Timestamp formatting for fixture rows. Every formatter reads a millisecond
// instant with the UTC getters (getUTCFullYear, etc.), never getHours() or
// toLocaleString() — those read the host machine's timezone, which would make
// "byte-identical for the same seed" true on one laptop and false on the next.
//
// The three fixtures deliberately use three different timestamp shapes,
// because the import pipeline has to handle all of them (docs/adr/0004):
//   - transactions_stripe.created_at   -> ISO 8601 with a trailing Z (an instant)
//   - customers_saaS timestamps        -> naive local, no offset (ambiguous)
//   - events_product.timestamp         -> a mix of both, chosen per row

import { pad } from "./format"
import { type Rng, nextInt } from "./prng"

/** A naive local timestamp that does not exist: it falls inside the
 * America/New_York spring-forward gap, when clocks jump from 02:00 to 03:00. */
export const SPRING_FORWARD_GAP = "2026-03-08 02:30:00"

/** A naive local timestamp that is ambiguous: it falls inside the
 * America/New_York fall-back overlap, when 01:00-02:00 occurs twice. */
export const FALL_BACK_OVERLAP = "2026-11-01 01:30:00"

const RANGE_START_MS = Date.UTC(2025, 0, 1, 0, 0, 0)
const RANGE_END_MS = Date.UTC(2026, 8, 1, 0, 0, 0) // before "today" so nothing is future-dated

/** A random millisecond instant within the fixtures' shared date range. */
export function randomInstantMs(rng: Rng): number {
  return nextInt(rng, RANGE_START_MS, RANGE_END_MS)
}

/** Formats an instant as ISO 8601 with a trailing Z, seconds precision. */
export function formatIsoZ(ms: number): string {
  const d = new Date(ms)
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`
  const time = `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}`
  return `${date}T${time}Z`
}

/** Formats an instant as a naive local timestamp: same wall-clock digits, no offset. */
export function formatNaiveLocal(ms: number): string {
  const d = new Date(ms)
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`
  const time = `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}`
  return `${date} ${time}`
}
