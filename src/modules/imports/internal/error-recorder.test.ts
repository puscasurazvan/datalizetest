import { describe, expect, it, vi } from "vitest"

import { ImportErrorRecorder } from "./error-recorder"
import type { NewImportError } from "../repository/import-error-repository"

function errorAt(rowNumber: number): NewImportError {
  return {
    rowNumber,
    columnName: "amount",
    errorCode: "UNPARSEABLE_VALUE",
    message: 'Value in column "amount" could not be parsed as decimal.',
  }
}

describe("ImportErrorRecorder — bounded-memory batching (docs/decisions/06 #5)", () => {
  it("does not flush before the batch size is reached", async () => {
    const sink = vi.fn<() => Promise<void>>(async () => {})
    const recorder = new ImportErrorRecorder(sink, 3)

    await recorder.record(errorAt(1))
    await recorder.record(errorAt(2))

    expect(sink).not.toHaveBeenCalled()
  })

  it("flushes automatically the instant the batch size is reached, awaited before returning", async () => {
    const flushed: (readonly NewImportError[])[] = []
    const sink = vi.fn<(batch: readonly NewImportError[]) => Promise<void>>(async (batch) => {
      flushed.push(batch)
    })
    const recorder = new ImportErrorRecorder(sink, 3)

    await recorder.record(errorAt(1))
    await recorder.record(errorAt(2))
    await recorder.record(errorAt(3))

    expect(sink).toHaveBeenCalledTimes(1)
    expect(flushed[0]).toHaveLength(3)
  })

  it("never buffers more than batchSize errors at once, across many more than one batch", async () => {
    const batchSizes: number[] = []
    const sink = vi.fn<(batch: readonly NewImportError[]) => Promise<void>>(async (batch) => {
      batchSizes.push(batch.length)
    })
    const recorder = new ImportErrorRecorder(sink, 100)

    for (let row = 1; row <= 2_530; row += 1) {
      // Exercising the recorder's own sequential flush-on-threshold
      // behavior, not a hot loop to parallelize.
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await recorder.record(errorAt(row))
    }
    await recorder.finish()

    expect(batchSizes.every((size) => size <= 100)).toBe(true)
    expect(batchSizes.reduce((sum, size) => sum + size, 0)).toBe(2_530)
    // 25 full batches of 100 plus one final partial batch of 30, flushed by finish().
    expect(batchSizes).toHaveLength(26)
    expect(batchSizes.at(-1)).toBe(30)
  })

  it("finish() flushes a partial buffer and is a no-op when nothing is buffered", async () => {
    const sink = vi.fn<() => Promise<void>>(async () => {})
    const recorder = new ImportErrorRecorder(sink, 1_000)

    await recorder.record(errorAt(1))
    await recorder.finish()
    expect(sink).toHaveBeenCalledTimes(1)

    await recorder.finish()
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it("rowsRejected counts markRowRejected calls, independent of record()", () => {
    const recorder = new ImportErrorRecorder(async () => {})

    recorder.markRowRejected()
    recorder.markRowRejected()

    expect(recorder.rowsRejected).toBe(2)
  })

  it("defaults to a batch size of 1,000", async () => {
    const batchSizes: number[] = []
    const sink = vi.fn<(batch: readonly NewImportError[]) => Promise<void>>(async (batch) => {
      batchSizes.push(batch.length)
    })
    const recorder = new ImportErrorRecorder(sink)

    for (let row = 1; row <= 1_000; row += 1) {
      // oxlint-disable-next-line no-await-in-loop -- see the first describe block above.
      await recorder.record(errorAt(row))
    }

    expect(sink).toHaveBeenCalledTimes(1)
    expect(batchSizes[0]).toBe(1_000)
  })
})
