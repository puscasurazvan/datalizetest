/**
 * `selectStorageProvider` (the config-selecting factory) — see ./s3.test.ts
 * for `S3StorageProvider`'s own behaviour with the SDK stubbed.
 */
import { describe, expect, it } from "vitest"

import { InMemoryStorageProvider } from "./in-memory"
import { S3StorageProvider, StorageConfigurationError, selectStorageProvider } from "./index"

const CONFIG = {
  region: "auto",
  bucket: "datalize-uploads",
  accessKeyId: "AKIAFAKE",
  secretAccessKey: "fake-secret",
}

describe("selectStorageProvider", () => {
  it("selects the in-memory provider when no STORAGE_* variable is set", () => {
    const provider = selectStorageProvider({
      STORAGE_ENDPOINT: undefined,
      STORAGE_REGION: undefined,
      STORAGE_BUCKET: undefined,
      STORAGE_ACCESS_KEY_ID: undefined,
      STORAGE_SECRET_ACCESS_KEY: undefined,
    })

    expect(provider).toBeInstanceOf(InMemoryStorageProvider)
  })

  it("selects S3StorageProvider when fully configured", () => {
    const provider = selectStorageProvider({
      STORAGE_ENDPOINT: undefined,
      STORAGE_REGION: CONFIG.region,
      STORAGE_BUCKET: CONFIG.bucket,
      STORAGE_ACCESS_KEY_ID: CONFIG.accessKeyId,
      STORAGE_SECRET_ACCESS_KEY: CONFIG.secretAccessKey,
    })

    expect(provider).toBeInstanceOf(S3StorageProvider)
  })

  it("throws a named error naming the missing variables, rather than failing later at first use", () => {
    let caught: unknown
    try {
      selectStorageProvider({
        STORAGE_ENDPOINT: undefined,
        STORAGE_REGION: undefined,
        STORAGE_BUCKET: CONFIG.bucket,
        STORAGE_ACCESS_KEY_ID: undefined,
        STORAGE_SECRET_ACCESS_KEY: CONFIG.secretAccessKey,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(StorageConfigurationError)
    expect(caught).toMatchObject({ message: expect.stringContaining("STORAGE_REGION") })
    expect(caught).toMatchObject({ message: expect.stringContaining("STORAGE_ACCESS_KEY_ID") })
  })

  it("treats STORAGE_ENDPOINT alone as an attempted-but-incomplete configuration, not as unconfigured", () => {
    // Setting only the optional endpoint should not silently fall back to
    // in-memory storage — that would hide a real misconfiguration.
    expect(() =>
      selectStorageProvider({
        STORAGE_ENDPOINT: "https://minio.internal:9000",
        STORAGE_REGION: undefined,
        STORAGE_BUCKET: undefined,
        STORAGE_ACCESS_KEY_ID: undefined,
        STORAGE_SECRET_ACCESS_KEY: undefined,
      }),
    ).toThrow(StorageConfigurationError)
  })
})
