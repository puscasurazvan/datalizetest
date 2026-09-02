import { inspect } from "node:util"

import { describe, expect, it } from "vitest"

import { MAX_UPLOAD_BYTES, PresignedUploadUrl, UPLOAD_URL_TTL_MS } from "./provider"

const SECRET_URL =
  "https://bucket.example.com/org/org_a/uploads/x.csv?X-Signature=super-secret-value"

describe("MAX_UPLOAD_BYTES", () => {
  it("matches the 50 MB ceiling from docs/decisions/01", () => {
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024)
  })
})

describe("UPLOAD_URL_TTL_MS", () => {
  it("is a positive duration", () => {
    expect(UPLOAD_URL_TTL_MS).toBeGreaterThan(0)
  })
})

describe("PresignedUploadUrl", () => {
  it("returns the real URL only from reveal()", () => {
    const url = PresignedUploadUrl.from(SECRET_URL)

    expect(url.reveal()).toBe(SECRET_URL)
  })

  it("does not leak the secret through toString()", () => {
    const url = PresignedUploadUrl.from(SECRET_URL)

    expect(url.toString()).not.toContain("super-secret-value")
  })

  it("does not leak the secret through template-literal interpolation", () => {
    const url = PresignedUploadUrl.from(SECRET_URL)

    expect(`${url}`).not.toContain("super-secret-value")
  })

  it("does not leak the secret through JSON.stringify", () => {
    const url = PresignedUploadUrl.from(SECRET_URL)

    expect(JSON.stringify({ url })).not.toContain("super-secret-value")
  })

  it("does not leak the secret through util.inspect (what console.log and Sentry breadcrumbs use)", () => {
    const url = PresignedUploadUrl.from(SECRET_URL)

    expect(inspect(url)).not.toContain("super-secret-value")
  })
})
