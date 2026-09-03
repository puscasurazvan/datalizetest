/**
 * Public types for the analytical store's write surface (this module's
 * CLAUDE.md, docs/adr/0002). `execute()` and its result types are not
 * defined here yet — they follow the load benchmark (docs/decisions/06
 * #15), per this module's CLAUDE.md "Build order".
 */
import type { RequestContext } from "@/shared/context/request-context"

/** The six canonical Datalize column types (docs/decisions/04). */
export const ANALYTICAL_COLUMN_TYPES = [
  "string",
  "integer",
  "decimal",
  "boolean",
  "date",
  "timestamptz",
] as const
export type AnalyticalColumnType = (typeof ANALYTICAL_COLUMN_TYPES)[number]

/**
 * One logical column to materialize on a Dataset Version's physical table.
 * `columnId` is the opaque Column ID (CONTEXT.md) — the only handle a
 * caller ever uses to refer to a column, before and after this call.
 * Ordinal position (and so the generated physical column name) is each
 * entry's index in the `columns` array passed to `createVersionTable`,
 * never a caller-supplied number, so it cannot disagree with the array
 * order the caller and `loadRows` both iterate.
 */
export interface AnalyticalColumnDefinition {
  readonly columnId: string
  readonly type: AnalyticalColumnType
}

/**
 * What `createVersionTable` hands back. Deliberately just the Column IDs
 * in the ordinal order actually materialized — never a physical table or
 * column name, never the Postgres type. This is what makes "nothing this
 * module returns may contain a physical name" a property of the return
 * *type*, not a promise about what today's implementation happens to omit.
 */
export interface AnalyticalTableSummary {
  readonly datasetVersionId: string
  readonly columnIds: readonly string[]
}

/** What `loadRows` hands back: how many data rows the COPY actually wrote. */
export interface LoadRowsResult {
  readonly rowCount: number
}

/**
 * One row to load, keyed by Column ID (never a physical column name — the
 * caller does not have one to give). A value is the cell's already-typed,
 * already-parsed string form (a `timestamptz` cell is an offset-bearing
 * ISO-8601 string, a `decimal` cell is a decimal literal string with no
 * loss of precision — docs/decisions/06 #11) or `null`. Deliberately not
 * `number | boolean | Date`: those would ask this module to re-decide a
 * textual encoding a value already had, and for `decimal` specifically
 * would reintroduce exactly the precision loss #11 exists to avoid — the
 * one Postgres type this module never treats as a JS number.
 */
export type AnalyticalRow = Readonly<Record<string, string | null>>

/**
 * The write surface of the analytical store (docs/adr/0002; this module's
 * CLAUDE.md "Build order" — `execute()` is added later). Every method
 * takes the branded `RequestContext`; none accepts a bare `datasetId` or
 * trusts `datasetVersionId` without re-checking it belongs to
 * `context.organizationId`.
 */
export interface AnalyticalStore {
  /**
   * Creates (or, on a retry, resets) the physical table for
   * `datasetVersionId` and persists the Column ID -> physical name mapping.
   * Idempotent: `CREATE TABLE IF NOT EXISTS` with a deterministic name,
   * then `TRUNCATE`, so a Trigger.dev retry of `import.load` converges
   * instead of duplicating or failing (docs/decisions/06 #16).
   */
  createVersionTable(
    context: RequestContext,
    datasetVersionId: string,
    columns: readonly AnalyticalColumnDefinition[],
  ): Promise<AnalyticalTableSummary>

  /**
   * Streams `rows` into the physical table via `COPY ... FROM STDIN`
   * (docs/decisions/06 #15 benchmarks the load strategy; this is today's
   * choice, not yet the benchmarked one). Requires `createVersionTable` to
   * have already run for this `datasetVersionId`.
   */
  loadRows(
    context: RequestContext,
    datasetVersionId: string,
    rows: AsyncIterable<AnalyticalRow>,
  ): Promise<LoadRowsResult>

  /**
   * Drops the physical table and deletes its Column ID -> physical name
   * mapping rows. Idempotent: a `datasetVersionId` with no registered
   * table is a no-op, not an error (mirrors `StorageProvider.deleteObject`
   * — src/modules/storage/provider.ts).
   */
  dropVersion(context: RequestContext, datasetVersionId: string): Promise<void>
}
