import { randomUUID } from "node:crypto"

import { ZodError } from "zod"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { InlineDispatcher } from "./inline-dispatcher"
import { JobRegistry, type TaskFunction } from "./registry"

describe("InlineDispatcher", () => {
  let registry: JobRegistry
  let dispatcher: InlineDispatcher

  beforeEach(() => {
    registry = new JobRegistry()
    dispatcher = new InlineDispatcher(registry)
  })

  it("runs the registered task and receives exactly the payload", async () => {
    const fakeTask = vi.fn<TaskFunction<"IMPORT_PROFILE">>(async () => {})
    registry.register("IMPORT_PROFILE", fakeTask)

    const importId = randomUUID()
    await dispatcher.enqueue("IMPORT_PROFILE", { importId })

    expect(fakeTask).toHaveBeenCalledTimes(1)
    expect(fakeTask).toHaveBeenCalledWith({ importId })
  })

  it("returns a run reference", async () => {
    registry.register(
      "IMPORT_LOAD",
      vi.fn<TaskFunction<"IMPORT_LOAD">>(async () => {}),
    )

    const result = await dispatcher.enqueue("IMPORT_LOAD", { importId: randomUUID() })

    expect(typeof result.runId).toBe("string")
    expect(result.runId.length).toBeGreaterThan(0)
  })

  it("rejects a payload carrying a presigned URL, and never runs the task", async () => {
    const fakeTask = vi.fn<TaskFunction<"IMPORT_PROFILE">>(async () => {})
    registry.register("IMPORT_PROFILE", fakeTask)

    const rejection = dispatcher.enqueue("IMPORT_PROFILE", {
      importId: randomUUID(),
      // @ts-expect-error a presigned URL is not part of the payload schema
      url: "https://bucket.s3.amazonaws.com/object?X-Amz-Signature=deadbeef",
    })

    await expect(rejection).rejects.toThrow(ZodError)
    await expect(rejection).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "unrecognized_keys" })],
    })
    expect(fakeTask).not.toHaveBeenCalled()
  })

  it("throws a named error for an unregistered job type", async () => {
    await expect(dispatcher.enqueue("IMPORT_LOAD", { importId: randomUUID() })).rejects.toThrow(
      /No task registered/,
    )
  })
})
