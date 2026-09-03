/**
 * `S3StorageProvider` — the production `StorageProvider` (./provider.ts),
 * backed by any S3-compatible object store (AWS S3, MinIO, Cloudflare R2)
 * through `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
 *
 * `getStorageProvider` (./index.ts) is the one entry point other modules
 * should use — it reads `env()` and picks this class or
 * `InMemoryStorageProvider` depending on whether storage is configured, so
 * a fresh clone and CI still work without S3 credentials
 * (src/modules/storage/CLAUDE.md).
 *
 * ## The size ceiling is advisory here, not enforced by S3
 *
 * `UploadTarget.maxSizeBytes` carries the 50 MB ceiling
 * (docs/decisions/01, "Ceiling Conflict — Resolved"), but a single
 * presigned PUT URL cannot make S3 itself reject an oversized body: SigV4
 * would only sign an exact `Content-Length`, forcing every upload to be
 * precisely 50 MB, which is wrong for CSVs of varying size below the
 * ceiling. Enforcing an upper bound server-side needs a presigned POST
 * with a `content-length-range` policy condition
 * (`@aws-sdk/s3-presigned-post`), which is not among the installed
 * dependencies. The authoritative check happens after the upload
 * completes, via `statObject`, before the import is profiled or loaded —
 * this class only advertises the limit the client is expected to respect.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { ObjectKey } from "./object-key"
import { MAX_UPLOAD_BYTES, PresignedUploadUrl, UPLOAD_URL_TTL_MS } from "./provider"
import type { ObjectStat, StorageProvider, UploadTarget } from "./provider"

export type S3StorageConfig = {
  readonly region: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /**
   * A custom endpoint for an S3-compatible store (MinIO, Cloudflare R2).
   * Unset targets real AWS S3, addressed by `region`.
   */
  readonly endpoint?: string
}

/**
 * Thrown at construction, not at first use, when storage configuration was
 * started but left incomplete — e.g. a bucket was set but the credentials
 * were not. Names exactly which environment variables are missing, so the
 * failure reads like a config error, never like an AWS SDK stack trace
 * three layers down inside a request handler.
 */
export class StorageConfigurationError extends Error {
  constructor(missingVariableNames: readonly string[]) {
    super(
      `Storage is partially configured; missing: ${missingVariableNames.join(", ")}. ` +
        "Set STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID and " +
        "STORAGE_SECRET_ACCESS_KEY together (STORAGE_ENDPOINT is optional, for " +
        "MinIO/R2) to use S3, or leave all of them unset to use in-memory storage.",
    )
    this.name = "StorageConfigurationError"
  }
}

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket
    this.client = new S3Client({
      region: config.region,
      // `exactOptionalPropertyTypes` treats an explicit `endpoint:
      // undefined` differently from omitting the key — `S3ClientConfig`
      // accepts only the latter — so the key is spread in only when a
      // custom endpoint is actually configured.
      ...(config.endpoint !== undefined ? { endpoint: config.endpoint } : {}),
      // A custom endpoint means a non-AWS store; those rarely have
      // per-bucket DNS set up, so they need path-style addressing
      // (endpoint/bucket/key) rather than AWS's virtual-hosted-style
      // (bucket.s3.amazonaws.com/key). This is what lets MinIO and R2
      // work through this same class without a second adapter.
      forcePathStyle: config.endpoint !== undefined,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }

  async createUploadTarget(organizationId: string): Promise<UploadTarget> {
    const key = ObjectKey.forOrganization(organizationId)
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key.value })

    // Pin `signingDate` rather than letting `getSignedUrl` default to its
    // own internal `new Date()` — that way `expiresAt` below is computed
    // from the exact instant the URL was signed from, not from a moment
    // after the (network-free, but non-zero) presign call returns.
    const signingDate = new Date()
    const signedUrl = await getSignedUrl(this.client, command, {
      expiresIn: UPLOAD_URL_TTL_MS / 1000,
      signingDate,
    })

    return {
      key,
      url: PresignedUploadUrl.from(signedUrl),
      maxSizeBytes: MAX_UPLOAD_BYTES,
      expiresAt: new Date(signingDate.getTime() + UPLOAD_URL_TTL_MS),
    }
  }

  async readObject(key: ObjectKey): Promise<ReadableStream<Uint8Array> | undefined> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key.value }),
      )

      if (result.Body === undefined) {
        return undefined
      }

      // `Body` carries the SDK's stream mixin, whose `transformToWebStream`
      // is what lets the import path consume this without buffering the
      // whole object into memory first.
      return result.Body.transformToWebStream()
    } catch (error) {
      if (isMissingObjectError(error)) {
        return undefined
      }
      throw error
    }
  }

  async deleteObject(key: ObjectKey): Promise<void> {
    // Deleting a key that does not exist is not an error on S3 either —
    // it responds 204 either way — so this needs no existence check first.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key.value }))
  }

  async statObject(key: ObjectKey): Promise<ObjectStat | undefined> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key.value }),
      )

      if (result.ContentLength === undefined || result.LastModified === undefined) {
        return undefined
      }

      return { key, sizeBytes: result.ContentLength, lastModified: result.LastModified }
    } catch (error) {
      if (isMissingObjectError(error)) {
        return undefined
      }
      throw error
    }
  }
}

/**
 * `GetObjectCommand` throws `NoSuchKey` for a missing key; `HeadObjectCommand`
 * throws the plainer `NotFound` instead, because a HEAD response carries no
 * body for the SDK to read an error code out of. Both mean the same thing
 * to `StorageProvider`'s callers: `undefined`, not an error.
 */
function isMissingObjectError(error: unknown): boolean {
  return error instanceof NoSuchKey || error instanceof NotFound
}
