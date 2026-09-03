/**
 * Bounded-memory recorder for `import.load`'s row-level errors (docs/decisions/06 #5).
 *
 * Confirmed defect this replaces: `load.ts` used to accumulate every
 * `import_errors` row in a plain array, and every rejected row number in a
 * `Set`, for the entire COPY window — up to ~1,000,000 objects (a full
 * ceiling load with a systematically misinferred column) held live in
 * memory for the whole 10-minute import, enough to OOM the `small-1x`
 * Trigger.dev worker mid-load. This recorder buffers at most `batchSize`
 * errors before flushing them through `sink`, awaited — so the generator
 * filling it (`load.ts`'s `encodeRows`) never gets more than one batch
 * ahead of what has actually been written to `import_errors`.
 *
 * Row rejection is a plain counter, not a `Set<number>` of row numbers:
 * only `.size` was ever read from that Set (`imports.rowsRejected`), so a
 * counter gives the same answer at O(1) memory instead of O(rows rejected).
 */
import type { NewImportError } from "../repository/import-error-repository"

/** Persists one flushed batch. `insertImportErrors` (../repository/import-error-repository.ts)
 * is the production sink; tests inject their own to assert batching behavior without a
 * real database or a million-row fixture. */
export type ImportErrorSink = (batch: readonly NewImportError[]) => Promise<void>

const DEFAULT_BATCH_SIZE = 1_000

export class ImportErrorRecorder {
  private buffer: NewImportError[] = []
  private rejectedRowCount = 0

  constructor(
    private readonly sink: ImportErrorSink,
    private readonly batchSize: number = DEFAULT_BATCH_SIZE,
  ) {}

  /** How many distinct rows had at least one error — mirrors `imports.rowsRejected`.
   * Independent of how many individual error rows were recorded or flushed. */
  get rowsRejected(): number {
    return this.rejectedRowCount
  }

  /** Call once per row that had at least one cell/field error, regardless of how many
   * `record()` calls that row produced — `rowsRejected` counts rows, not error rows. */
  markRowRejected(): void {
    this.rejectedRowCount += 1
  }

  /** Buffers one `import_errors` row, flushing automatically once `batchSize` is reached. */
  async record(error: NewImportError): Promise<void> {
    this.buffer.push(error)
    if (this.buffer.length >= this.batchSize) {
      await this.flush()
    }
  }

  /** Flushes whatever remains buffered. Call exactly once, after the row stream this
   * recorder is attached to has been fully drained — a no-op if nothing is buffered. */
  async finish(): Promise<void> {
    await this.flush()
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const batch = this.buffer
    this.buffer = []
    await this.sink(batch)
  }
}
