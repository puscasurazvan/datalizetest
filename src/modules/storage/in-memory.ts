/**
 * `InMemoryStorageProvider` — a `StorageProvider` backed by a `Map`, so
 * tests never need S3 or MinIO (src/modules/storage/CLAUDE.md).
 *
 * The real interface has no `upload` method — object storage accepts the
 * PUT directly against the presigned URL, never through the application
 * server (docs/decisions/01). `receiveUpload` stands in for that PUT in
 * tests: it is deliberately NOT part of `StorageProvider`, because no real
 * implementation would ever expose it.
 */
import { ObjectKey } from "./object-key"
import { MAX_UPLOAD_BYTES, PresignedUploadUrl, UPLOAD_URL_TTL_MS } from "./provider"
import type { ObjectStat, StorageProvider, UploadTarget } from "./provider"

/** Injected so expiry can be tested without fake timers. */
export type Clock = {
  now(): Date
}

const systemClock: Clock = {
  now: () => new Date(),
}

type StoredObject = {
  readonly bytes: Uint8Array
  readonly lastModified: Date
}

export class InMemoryStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, StoredObject>()
  private readonly clock: Clock

  constructor(clock: Clock = systemClock) {
    this.clock = clock
  }

  async createUploadTarget(organizationId: string): Promise<UploadTarget> {
    const key = ObjectKey.forOrganization(organizationId)
    const expiresAt = new Date(this.clock.now().getTime() + UPLOAD_URL_TTL_MS)

    return {
      key,
      url: PresignedUploadUrl.from(`memory://${key.value}`),
      maxSizeBytes: MAX_UPLOAD_BYTES,
      expiresAt,
    }
  }

  /**
   * Stands in for the client's PUT to `target.url`, enforcing the same
   * size limit and expiry a real presigned URL would enforce. Throws on
   * refusal — this is a test helper, not part of the `StorageProvider`
   * contract, so it has no need for a typed result.
   */
  async receiveUpload(target: UploadTarget, bytes: Uint8Array): Promise<void> {
    if (this.clock.now().getTime() >= target.expiresAt.getTime()) {
      throw new Error("upload target has expired")
    }

    if (bytes.byteLength > target.maxSizeBytes) {
      throw new Error(`upload exceeds the ${target.maxSizeBytes}-byte limit`)
    }

    this.objects.set(target.key.value, { bytes, lastModified: this.clock.now() })
  }

  async readObject(key: ObjectKey): Promise<ReadableStream<Uint8Array> | undefined> {
    const stored = this.objects.get(key.value)
    if (stored === undefined) {
      return undefined
    }

    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(stored.bytes)
        controller.close()
      },
    })
  }

  async deleteObject(key: ObjectKey): Promise<void> {
    this.objects.delete(key.value)
  }

  async statObject(key: ObjectKey): Promise<ObjectStat | undefined> {
    const stored = this.objects.get(key.value)
    if (stored === undefined) {
      return undefined
    }

    return { key, sizeBytes: stored.bytes.byteLength, lastModified: stored.lastModified }
  }
}
