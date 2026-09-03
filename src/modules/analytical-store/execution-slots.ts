/**
 * Advisory-lock keys for the 5-concurrent-queries-per-Organization limit
 * (docs/decisions/05 §(c), docs/decisions/06 #18).
 *
 * `pg_try_advisory_xact_lock` has a single-`bigint` form and a two-`int4`
 * form. The single-`bigint` form is deliberately avoided: deriving one
 * 64-bit key from a 32-bit Organization-ID hash XORed with a slot number
 * only ever exercises 32 of the 64 available bits, so two unrelated
 * Organizations collide far more often than the "5 per Organization"
 * guarantee assumes. The two-`int4` form spends the full SHA-256 digest —
 * `key1` from its first 4 bytes, `key2` from its next 4 bytes XORed with
 * the slot number — so a collision needs both independently-derived halves
 * to match, at a negligible rate for any realistic Organization count.
 */

import { createHash } from "node:crypto"

const SLOT_COUNT = 5

export interface AdvisoryLockKey {
  readonly key1: number
  readonly key2: number
}

/**
 * The 5 candidate lock keys for one Organization, slots 1..5 in order.
 * Deterministic and pure — same `organizationId` in, same keys out — so the
 * caller can attempt them in sequence against `pg_try_advisory_xact_lock`
 * without this function ever touching a connection.
 */
export function slotKeys(organizationId: string): readonly AdvisoryLockKey[] {
  const digest = createHash("sha256").update(organizationId).digest()
  const key1 = digest.readInt32BE(0)
  const key2Base = digest.readInt32BE(4)

  return Array.from({ length: SLOT_COUNT }, (_unused, index) => {
    const slot = index + 1
    return { key1, key2: key2Base ^ slot }
  })
}
