/**
 * `S3StorageProvider`, with the AWS SDK stubbed — these tests never make a
 * network call. See ./index.test.ts for `selectStorageProvider`, the
 * config-selecting factory.
 */
import type * as AwsS3 from "@aws-sdk/client-s3"
import { beforeEach, describe, expect, it, vi } from "vitest"

// `vi.mock` factories are hoisted above every import in this file, so any
// outer variable they close over must be created through `vi.hoisted` —
// a plain `const` here would still be in its temporal dead zone by the
// time the hoisted factory runs.
const { sendMock, s3ClientConfigs, getSignedUrlMock } = vi.hoisted(() => {
  const configs: unknown[] = []
  return {
    sendMock: vi.fn<(command: unknown) => Promise<unknown>>(),
    s3ClientConfigs: configs,
    getSignedUrlMock: vi.fn<
      (client: unknown, command: unknown, options: unknown) => Promise<string>
    >(async (_client, _command, _options) => "https://bucket.example.com/signed-put-url"),
  }
})

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof AwsS3>()
  return {
    ...actual,
    // A plain `function`, not an arrow function: `new S3Client(...)` in
    // ./s3.ts invokes this mock with `new`, which only a real function
    // (never an arrow function) can be called with.
    S3Client: vi
      .fn<(config: unknown) => { send: typeof sendMock }>()
      .mockImplementation(function (config) {
        s3ClientConfigs.push(config)
        return { send: sendMock }
      }),
  }
})

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}))

import { DeleteObjectCommand, NotFound, NoSuchKey, PutObjectCommand } from "@aws-sdk/client-s3"

import { ObjectKey } from "./object-key"
import { MAX_UPLOAD_BYTES, UPLOAD_URL_TTL_MS } from "./provider"
import { S3StorageProvider } from "./s3"

const CONFIG = {
  region: "auto",
  bucket: "datalize-uploads",
  accessKeyId: "AKIAFAKE",
  secretAccessKey: "fake-secret",
}

const ORG_A = "org_a"
const ORG_B = "org_b"

function newNoSuchKeyError(): NoSuchKey {
  return new NoSuchKey({ message: "not found", $metadata: {} })
}

function newNotFoundError(): NotFound {
  return new NotFound({ message: "not found", $metadata: {} })
}

function readSigningDate(options: unknown): Date | undefined {
  if (typeof options !== "object" || options === null || !("signingDate" in options)) {
    return undefined
  }
  const { signingDate } = options
  return signingDate instanceof Date ? signingDate : undefined
}

beforeEach(() => {
  sendMock.mockReset()
  getSignedUrlMock.mockClear()
  s3ClientConfigs.length = 0
})

describe("S3StorageProvider construction", () => {
  it("uses path-style addressing when a custom endpoint is configured, for MinIO/R2", () => {
    const provider = new S3StorageProvider({
      ...CONFIG,
      endpoint: "https://minio.internal:9000",
    })

    expect(provider).toBeInstanceOf(S3StorageProvider)
    expect(s3ClientConfigs).toEqual([
      expect.objectContaining({
        endpoint: "https://minio.internal:9000",
        forcePathStyle: true,
      }),
    ])
  })

  it("does not force path-style addressing against real AWS S3 (no endpoint)", () => {
    const provider = new S3StorageProvider(CONFIG)

    expect(provider).toBeInstanceOf(S3StorageProvider)
    expect(s3ClientConfigs).toEqual([expect.objectContaining({ forcePathStyle: false })])
  })
})

describe("S3StorageProvider.createUploadTarget", () => {
  it("presigns a PUT for a server-minted key and carries the size limit and expiry", async () => {
    const provider = new S3StorageProvider(CONFIG)
    const before = Date.now()

    const target = await provider.createUploadTarget(ORG_A)

    // The size limit: no presigned PUT can make S3 enforce an upper bound
    // (see the file-level comment in ./s3.ts), so `maxSizeBytes` is what
    // carries the 50 MB ceiling to the caller.
    expect(target.maxSizeBytes).toBe(MAX_UPLOAD_BYTES)

    // The expiry: this *is* something the presign call itself carries,
    // via `expiresIn` (and a pinned `signingDate`) on the SDK's
    // `getSignedUrl`.
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1)
    const call = getSignedUrlMock.mock.calls[0]
    const command = call?.[1]
    const options = call?.[2]
    expect(command).toBeInstanceOf(PutObjectCommand)
    expect(options).toMatchObject({ expiresIn: UPLOAD_URL_TTL_MS / 1000 })

    // `expiresAt` is `signingDate + TTL` for the exact `signingDate`
    // passed to `getSignedUrl`, so it is exactly the signed URL's real
    // expiry — not merely close to it.
    const signingDate = readSigningDate(options)
    expect(signingDate).toBeInstanceOf(Date)
    expect(signingDate?.getTime()).toBe(target.expiresAt.getTime() - UPLOAD_URL_TTL_MS)
    expect(target.expiresAt.getTime()).toBeGreaterThanOrEqual(before + UPLOAD_URL_TTL_MS)
    expect(target.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + UPLOAD_URL_TTL_MS)
  })

  it("mints a server-generated, organization-scoped key rather than accepting one", async () => {
    const provider = new S3StorageProvider(CONFIG)

    const target = await provider.createUploadTarget(ORG_A)

    expect(target.key.value).toMatch(new RegExp(`^org/${ORG_A}/uploads/.+\\.csv$`))
  })

  it("never reveals the presigned URL through logging surfaces", async () => {
    const provider = new S3StorageProvider(CONFIG)

    const target = await provider.createUploadTarget(ORG_A)

    expect(String(target.url)).not.toContain("signed-put-url")
    expect(target.url.reveal()).toBe("https://bucket.example.com/signed-put-url")
  })
})

describe("a key from another organization", () => {
  it("is rejected by ObjectKey.parse before it can become an ObjectKey — so no S3StorageProvider method can ever be called with it", () => {
    const mintedForOrgA = ObjectKey.forOrganization(ORG_A)

    const result = ObjectKey.parse(mintedForOrgA.value, ORG_B)

    expect(result.ok).toBe(false)
    // Every S3StorageProvider method requires an ObjectKey, not a string
    // (provider.ts) — since no ObjectKey was ever produced, the SDK was
    // never touched.
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe("S3StorageProvider.readObject", () => {
  it("returns the object body as a stream, without buffering it first", async () => {
    const provider = new S3StorageProvider(CONFIG)
    const key = ObjectKey.forOrganization(ORG_A)
    const fakeStream = new ReadableStream<Uint8Array>()
    sendMock.mockResolvedValueOnce({
      Body: { transformToWebStream: () => fakeStream },
    })

    const stream = await provider.readObject(key)

    expect(stream).toBe(fakeStream)
  })

  it("returns undefined for a missing object instead of throwing", async () => {
    const provider = new S3StorageProvider(CONFIG)
    const key = ObjectKey.forOrganization(ORG_A)
    sendMock.mockRejectedValueOnce(newNoSuchKeyError())

    const stream = await provider.readObject(key)

    expect(stream).toBeUndefined()
  })

  it("propagates an unrelated SDK failure", async () => {
    const provider = new S3StorageProvider(CONFIG)
    const key = ObjectKey.forOrganization(ORG_A)
    sendMock.mockRejectedValueOnce(new Error("network unreachable"))

    await expect(provider.readObject(key)).rejects.toThrow("network unreachable")
  })
})

describe("S3StorageProvider.deleteObject", () => {
  it("sends a DeleteObjectCommand for the bucket and key", async () => {
    const provider = new S3StorageProvider(CONFIG)
    const key = ObjectKey.forOrganization(ORG_A)
    sendMock.mockResolvedValueOnce({})

    await provider.deleteObject(key)

    expect(sendMock).toHaveBeenCalledTimes(1)
    const command = sendMock.mock.calls[0]?.[0]
    expect(command).toBeInstanceOf(DeleteObjectCommand)
    expect(command).toMatchObject({ input: { Bucket: CONFIG.bucket, Key: key.value } })
  })
})

describe("S3StorageProvider.statObject", () => {
  it("reports size and last-modified time for an existing object", async () => {
    const provider = new S3StorageProvider(CONFIG)
    const key = ObjectKey.forOrganization(ORG_A)
    const lastModified = new Date("2026-01-01T00:00:00Z")
    sendMock.mockResolvedValueOnce({ ContentLength: 1234, LastModified: lastModified })

    const stat = await provider.statObject(key)

    expect(stat).toEqual({ key, sizeBytes: 1234, lastModified })
  })

  it("returns undefined for a missing object instead of throwing", async () => {
    const provider = new S3StorageProvider(CONFIG)
    const key = ObjectKey.forOrganization(ORG_A)
    sendMock.mockRejectedValueOnce(newNotFoundError())

    const stat = await provider.statObject(key)

    expect(stat).toBeUndefined()
  })
})
