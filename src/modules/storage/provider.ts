/**
 * `StorageProvider` — the boundary between the import path and object
 * storage (src/modules/storage/CLAUDE.md, docs/reference/Datalize.md §22).
 *
 * Only what the CSV import path needs: create a presigned upload target,
 * read an object back as a stream, delete an object, and stat one. There is
 * no S3-compatible implementation here — the AWS SDK is not installed in
 * this repo; `InMemoryStorageProvider` (./in-memory.ts) is the only
 * implementation. An S3 adapter is a follow-up, written against this
 * interface once the AWS SDK is a dependency.
 *
 * Every method takes an `ObjectKey`, never a bare `string` — see
 * ./object-key.ts for why a client-supplied key cannot reach these methods.
 */
import type { ObjectKey } from "./object-key"

/** The 50 MB ceiling on an uploaded CSV (docs/decisions/01, docs/decisions/06 #15). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/**
 * How long a presigned upload target stays valid. No doc pins an exact
 * number — docs/decisions/06 and src/modules/storage/CLAUDE.md only say
 * "signed URLs expire" — so this is a conservative default chosen here,
 * long enough for a large upload over a slow connection, short enough that
 * a leaked URL doesn't stay live for long.
 */
export const UPLOAD_URL_TTL_MS = 15 * 60 * 1000

const REDACTED = "[PresignedUploadUrl: redacted]"
const NODE_INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom")

/**
 * A presigned upload URL is a credential (src/modules/storage/CLAUDE.md
 * "Credential hygiene") — it must never end up in a job payload or a log.
 * `PresignedUploadUrl` makes the accidental case safe: every surface a
 * logger or `JSON.stringify` might reach (`toString`, template
 * interpolation, `JSON.stringify`, `util.inspect`/`console.log`) reports a
 * fixed redacted string. `reveal()` is the one deliberate way out, for the
 * single caller that hands the URL to the browser for the PUT.
 */
export class PresignedUploadUrl {
  #url: string

  private constructor(url: string) {
    this.#url = url
    // A computed member name needs a `unique symbol` type to be declared on
    // the class itself, which `Symbol.for` does not produce — this method
    // is attached at construction time instead so `util.inspect`/
    // `console.log` still redact it without needing a cast.
    Object.defineProperty(this, NODE_INSPECT_CUSTOM, {
      value: () => REDACTED,
      enumerable: false,
    })
  }

  static from(url: string): PresignedUploadUrl {
    return new PresignedUploadUrl(url)
  }

  reveal(): string {
    return this.#url
  }

  toString(): string {
    return REDACTED
  }

  toJSON(): string {
    return REDACTED
  }
}

/** What `createUploadTarget` hands back for the client to PUT its file to. */
export type UploadTarget = {
  readonly key: ObjectKey
  readonly url: PresignedUploadUrl
  readonly maxSizeBytes: number
  readonly expiresAt: Date
}

/** What `statObject` reports for an object that exists. */
export type ObjectStat = {
  readonly key: ObjectKey
  readonly sizeBytes: number
  readonly lastModified: Date
}

export interface StorageProvider {
  /** Mints a fresh, organization-scoped key and a presigned target to upload to it. */
  createUploadTarget(organizationId: string): Promise<UploadTarget>

  /** Reads an object's bytes as a stream, or `undefined` if no object exists at `key`. */
  readObject(key: ObjectKey): Promise<ReadableStream<Uint8Array> | undefined>

  /** Deletes an object. A missing key is not an error — deleting is idempotent. */
  deleteObject(key: ObjectKey): Promise<void>

  /** Reports an object's size and last-modified time, or `undefined` if it does not exist. */
  statObject(key: ObjectKey): Promise<ObjectStat | undefined>
}
