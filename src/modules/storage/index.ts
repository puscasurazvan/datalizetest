/**
 * Public surface of src/modules/storage. Other modules obtain a
 * `StorageProvider` through `getStorageProvider()`, never by importing
 * `./s3` or `./in-memory` directly.
 *
 * `getStorageProvider` is the env-driven factory (mirrors
 * `getJobDispatcher()` in src/modules/jobs/index.ts): it selects
 * `S3StorageProvider` when storage is configured, or
 * `InMemoryStorageProvider` when none of the `STORAGE_*` variables are set
 * at all (a fresh clone, CI, a unit test) — so this file, not ./s3.ts,
 * is the one place that knows the fallback exists.
 */
import { env } from "@/shared/env"
import { InMemoryStorageProvider } from "./in-memory"
import { S3StorageProvider, StorageConfigurationError } from "./s3"
import type { S3StorageConfig } from "./s3"
import type { StorageProvider } from "./provider"

export type { ObjectStat, StorageProvider, UploadTarget } from "./provider"
export { MAX_UPLOAD_BYTES, PresignedUploadUrl, UPLOAD_URL_TTL_MS } from "./provider"
export { ObjectKey } from "./object-key"
export type { ObjectKeyParseResult } from "./object-key"
export { InMemoryStorageProvider } from "./in-memory"
export type { Clock } from "./in-memory"
export { S3StorageProvider, StorageConfigurationError } from "./s3"
export type { S3StorageConfig } from "./s3"

type StorageEnv = {
  // `?: string | undefined`, not `?: string` — under `exactOptionalPropertyTypes`
  // only this form accepts both an omitted key (a `StorageEnv` built by
  // hand in a test) and one explicitly set to `undefined` (`env()`'s
  // actual return type, since Zod's `.optional()` fields are typed that
  // way too).
  readonly STORAGE_ENDPOINT?: string | undefined
  readonly STORAGE_REGION?: string | undefined
  readonly STORAGE_BUCKET?: string | undefined
  readonly STORAGE_ACCESS_KEY_ID?: string | undefined
  readonly STORAGE_SECRET_ACCESS_KEY?: string | undefined
}

/**
 * Selects `S3StorageProvider` when storage has been configured, or
 * `InMemoryStorageProvider` when none of the `STORAGE_*` variables are
 * set at all (a fresh clone, CI, a unit test). Configuring only some of
 * them is treated as a mistake, not as "unconfigured" — it throws
 * `StorageConfigurationError` naming what's missing, so the failure
 * surfaces at boot/construction rather than as an opaque AWS SDK error the
 * first time an upload target is requested.
 */
export function selectStorageProvider(storageEnv: StorageEnv): StorageProvider {
  const isUnconfigured =
    storageEnv.STORAGE_ENDPOINT === undefined &&
    storageEnv.STORAGE_REGION === undefined &&
    storageEnv.STORAGE_BUCKET === undefined &&
    storageEnv.STORAGE_ACCESS_KEY_ID === undefined &&
    storageEnv.STORAGE_SECRET_ACCESS_KEY === undefined

  if (isUnconfigured) {
    return new InMemoryStorageProvider()
  }

  return new S3StorageProvider(requireS3Config(storageEnv))
}

/**
 * Validates that every required `STORAGE_*` variable is present, naming
 * whichever are not. Individually re-checked (rather than trusting a
 * `missing.length === 0` computed elsewhere) because that is the only way
 * to narrow each field from `string | undefined` to `string` without a
 * cast — TypeScript does not carry narrowing computed over an array back
 * onto the object it was computed from.
 */
function requireS3Config(storageEnv: StorageEnv): S3StorageConfig {
  const missing: string[] = []
  if (storageEnv.STORAGE_REGION === undefined) missing.push("STORAGE_REGION")
  if (storageEnv.STORAGE_BUCKET === undefined) missing.push("STORAGE_BUCKET")
  if (storageEnv.STORAGE_ACCESS_KEY_ID === undefined) missing.push("STORAGE_ACCESS_KEY_ID")
  if (storageEnv.STORAGE_SECRET_ACCESS_KEY === undefined) missing.push("STORAGE_SECRET_ACCESS_KEY")

  const { STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY } =
    storageEnv
  if (
    missing.length > 0 ||
    STORAGE_REGION === undefined ||
    STORAGE_BUCKET === undefined ||
    STORAGE_ACCESS_KEY_ID === undefined ||
    STORAGE_SECRET_ACCESS_KEY === undefined
  ) {
    throw new StorageConfigurationError(missing)
  }

  return {
    region: STORAGE_REGION,
    bucket: STORAGE_BUCKET,
    accessKeyId: STORAGE_ACCESS_KEY_ID,
    secretAccessKey: STORAGE_SECRET_ACCESS_KEY,
    // Same `exactOptionalPropertyTypes` reasoning as the S3Client config
    // in ./s3.ts: omit the key entirely rather than assign it `undefined`.
    ...(storageEnv.STORAGE_ENDPOINT !== undefined ? { endpoint: storageEnv.STORAGE_ENDPOINT } : {}),
  }
}

let provider: StorageProvider | undefined

/**
 * Lazily selects and memoizes the `StorageProvider`, so importing this
 * module never reads `process.env` by itself — only calling
 * `getStorageProvider()` does.
 */
export function getStorageProvider(): StorageProvider {
  provider ??= selectStorageProvider(env())
  return provider
}
