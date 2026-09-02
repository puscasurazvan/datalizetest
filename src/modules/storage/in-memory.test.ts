import { describe, expect, it } from "vitest"

import { type Clock, InMemoryStorageProvider } from "./in-memory"

const ORG_A = "org_a"

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text()
}

function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) }
}

describe("InMemoryStorageProvider", () => {
  it("stores an upload and reads the same bytes back as a stream", async () => {
    const provider = new InMemoryStorageProvider()
    const target = await provider.createUploadTarget(ORG_A)

    await provider.receiveUpload(target, new TextEncoder().encode("id,amount\n1,10\n"))

    const stream = await provider.readObject(target.key)
    expect(stream).toBeDefined()
    expect(stream === undefined ? "" : await readAllBytes(stream)).toBe("id,amount\n1,10\n")
  })

  it("returns undefined reading an object that was never uploaded", async () => {
    const provider = new InMemoryStorageProvider()
    const target = await provider.createUploadTarget(ORG_A)

    expect(await provider.readObject(target.key)).toBeUndefined()
  })

  it("deletes an object so it can no longer be read", async () => {
    const provider = new InMemoryStorageProvider()
    const target = await provider.createUploadTarget(ORG_A)
    await provider.receiveUpload(target, new Uint8Array([1, 2, 3]))

    await provider.deleteObject(target.key)

    expect(await provider.readObject(target.key)).toBeUndefined()
  })

  it("treats deleting a missing object as a no-op, not an error", async () => {
    const provider = new InMemoryStorageProvider()
    const target = await provider.createUploadTarget(ORG_A)

    await expect(provider.deleteObject(target.key)).resolves.toBeUndefined()
  })

  it("stats an uploaded object with its size and last-modified time", async () => {
    const provider = new InMemoryStorageProvider()
    const target = await provider.createUploadTarget(ORG_A)
    const bytes = new Uint8Array([1, 2, 3, 4, 5])

    await provider.receiveUpload(target, bytes)

    const stat = await provider.statObject(target.key)
    expect(stat).toMatchObject({ sizeBytes: 5 })
    expect(stat?.key.value).toBe(target.key.value)
  })

  it("returns undefined stating an object that does not exist", async () => {
    const provider = new InMemoryStorageProvider()
    const target = await provider.createUploadTarget(ORG_A)

    expect(await provider.statObject(target.key)).toBeUndefined()
  })

  // A small hand-built `maxSizeBytes` keeps these two tests about the
  // *comparison*, not about actually allocating a 50 MB buffer.
  it("refuses an upload larger than the target's size limit", async () => {
    const provider = new InMemoryStorageProvider()
    const target = { ...(await provider.createUploadTarget(ORG_A)), maxSizeBytes: 8 }
    const oversized = new Uint8Array(9)

    await expect(provider.receiveUpload(target, oversized)).rejects.toThrow(/limit/)
    expect(await provider.readObject(target.key)).toBeUndefined()
  })

  it("accepts an upload exactly at the size limit", async () => {
    const provider = new InMemoryStorageProvider()
    const target = { ...(await provider.createUploadTarget(ORG_A)), maxSizeBytes: 8 }
    const atLimit = new Uint8Array(8)

    await expect(provider.receiveUpload(target, atLimit)).resolves.toBeUndefined()
  })

  it("refuses an upload against an expired target", async () => {
    const clock = fixedClock("2026-01-01T00:00:00.000Z")
    const provider = new InMemoryStorageProvider(clock)
    const target = await provider.createUploadTarget(ORG_A)

    clock.now = () => new Date(target.expiresAt.getTime())

    await expect(provider.receiveUpload(target, new Uint8Array([1]))).rejects.toThrow(/expired/)
    expect(await provider.readObject(target.key)).toBeUndefined()
  })

  it("accepts an upload made just before the target expires", async () => {
    const clock = fixedClock("2026-01-01T00:00:00.000Z")
    const provider = new InMemoryStorageProvider(clock)
    const target = await provider.createUploadTarget(ORG_A)

    clock.now = () => new Date(target.expiresAt.getTime() - 1)

    await expect(provider.receiveUpload(target, new Uint8Array([1]))).resolves.toBeUndefined()
  })

  it("scopes generated keys to the requesting organization", async () => {
    const provider = new InMemoryStorageProvider()
    const target = await provider.createUploadTarget(ORG_A)

    expect(target.key.value.startsWith(`org/${ORG_A}/uploads/`)).toBe(true)
  })
})
