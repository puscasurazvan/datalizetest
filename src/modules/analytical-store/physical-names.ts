/**
 * Server-generated physical identifiers for the analytical store (this
 * module's CLAUDE.md, docs/adr/0002).
 *
 * Pure and deterministic: same `datasetVersionId` / ordinal in, same
 * physical name out, every time — which is what makes `CREATE TABLE IF NOT
 * EXISTS` + `TRUNCATE` (postgres-store.ts) converge on a Trigger.dev retry
 * (docs/decisions/06 #16). Nothing here reads a caller-supplied name: a
 * table name is derived only from `datasetVersionId`, a column name only
 * from its ordinal position.
 *
 * Postgres truncates identifiers at 63 bytes (`NAMEDATALEN` 64, minus the
 * trailing NUL). Both name shapes below are fixed-length for a given input
 * class rather than merely "usually short," so neither can ever reach that
 * boundary and no two distinct inputs can collide by being truncated to
 * the same 63-byte prefix:
 *
 * - `ANALYTICAL_SCHEMA` is a hard-coded literal, never derived.
 * - A table name is `dv_` (3 bytes) + a 32-hex-digit UUID with its hyphens
 *   stripped (32 bytes) = 35 bytes, always. `datasetVersionId` is
 *   validated as a UUID before use, so this length never varies.
 * - A column name is `c_` (2 bytes) + a small non-negative integer.
 *   docs/decisions/01's 100-column ceiling keeps this well under 63 bytes
 *   in practice; the code does not special-case ordinals beyond that
 *   ceiling, since nothing upstream of this module is expected to call it
 *   with more columns than the product allows.
 */

/** The one schema every Dataset Version's physical table lives in (docs/adr/0002). */
export const ANALYTICAL_SCHEMA = "analytical"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Throws unless `datasetVersionId` is a well-formed UUID. `datasets.ts`
 * types the column as a JS-defaulted `randomUUID()`, but nothing at the
 * type level stops some other caller from passing an arbitrary string —
 * and the fixed-length guarantee above depends on this actually holding.
 */
export function assertDatasetVersionId(datasetVersionId: string): void {
  if (!UUID_PATTERN.test(datasetVersionId)) {
    throw new Error(`datasetVersionId must be a UUID, got: ${JSON.stringify(datasetVersionId)}`)
  }
}

/** The physical table name for a Dataset Version: `dv_{32 lowercase hex digits}`. */
export function physicalTableName(datasetVersionId: string): string {
  assertDatasetVersionId(datasetVersionId)
  return `dv_${datasetVersionId.toLowerCase().replaceAll("-", "")}`
}

/** The physical column name for a column at `ordinal` (0-based): `c_{ordinal}`. */
export function physicalColumnName(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    throw new Error(`ordinal must be a non-negative integer, got: ${ordinal}`)
  }
  return `c_${ordinal}`
}

/**
 * Double-quotes a Postgres identifier, doubling any embedded `"` per
 * Postgres's own quoting rule. Every identifier interpolated into DDL in
 * this module (postgres-store.ts) is quoted through this function — never
 * bare string concatenation — even though every identifier reaching it is
 * already server-generated (`ANALYTICAL_SCHEMA`, `physicalTableName`,
 * `physicalColumnName`) and therefore never needs escaping in practice.
 * Postgres has no bind-parameter position for identifiers, so quoting is
 * the only defense DDL has; this function is that defense, applied
 * unconditionally rather than trusted-by-convention.
 */
export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

/** `"analytical"."dv_..."`, ready to interpolate into DDL/COPY text. */
export function qualifiedTableName(datasetVersionId: string): string {
  return `${quoteIdentifier(ANALYTICAL_SCHEMA)}.${quoteIdentifier(physicalTableName(datasetVersionId))}`
}
