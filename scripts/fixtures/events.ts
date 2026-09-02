// Pure row generator for events_product.csv. Columns match docs/decisions/01
// exactly. timestamp is a MIX of the other two fixtures' shapes — roughly
// half ISO 8601 with a Z offset, half naive local — because the import
// pipeline has to infer a single column type across both within one file.

import { applyDirtyOverrides, type DirtyOverrides } from "./dirty"
import { pad } from "./format"
import { chance, nextInt, pick, type Rng } from "./prng"
import {
  FALL_BACK_OVERLAP,
  formatIsoZ,
  formatNaiveLocal,
  randomInstantMs,
  SPRING_FORWARD_GAP,
} from "./timestamps"

export const HEADER = [
  "event_id",
  "user_id",
  "event_type",
  "timestamp",
  "session_id",
  "metadata_json",
] as const

const EVENT_TYPES = [
  "page_view",
  "page_view",
  "page_view",
  "feature_used",
  "signup",
  "login",
  "logout",
  "purchase",
] as const

const METADATA_SAMPLES = [
  '{"path":"/pricing"}',
  '{"path":"/dashboard"}',
  '{"plan":"pro"}',
  '{"feature":"export"}',
] as const

const USER_POOL_SIZE = 2000

// Row indices (0-based, header excluded) carrying deliberately dirty values.
// Kept low so they land inside the first-10,000-row type-inference sample
// even for the 1,000,000-row variant. See tests/fixtures/README.md.
export const DIRTY_ROWS: DirtyOverrides = new Map([
  [5, { session_id: "" }], // empty cell on a nullable column
  [9, { user_id: "0009012" }], // leading-zero identifier, must stay a string
  [13, { timestamp: SPRING_FORWARD_GAP }], // naive time that never occurred (DST spring-forward)
  [17, { timestamp: FALL_BACK_OVERLAP }], // naive time that occurred twice (DST fall-back)
  [21, { metadata_json: '{"note":"has, comma \\"quote\\"\nline"}' }], // comma + quote + newline
])

function generateRow(rng: Rng, index: number): string[] {
  const eventId = `e${pad(index + 1, 8)}`
  const userId = `u${pad(nextInt(rng, 1, USER_POOL_SIZE), 6)}`
  const eventType = pick(rng, EVENT_TYPES)
  const instantMs = randomInstantMs(rng)
  const timestamp = chance(rng, 0.5) ? formatIsoZ(instantMs) : formatNaiveLocal(instantMs)
  const sessionId = chance(rng, 0.15) ? "" : `s${pad(nextInt(rng, 1, 50_000), 6)}`
  const metadataJson = chance(rng, 0.4) ? "" : pick(rng, METADATA_SAMPLES)

  return [eventId, userId, eventType, timestamp, sessionId, metadataJson]
}

/** Yields `count` data rows (header not included), applying dirty overrides in place. */
export function* generateRows(rng: Rng, count: number): Generator<string[]> {
  for (let index = 0; index < count; index++) {
    const row = generateRow(rng, index)
    yield applyDirtyOverrides(HEADER, row, DIRTY_ROWS, index)
  }
}
