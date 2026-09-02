import type { ErrorEvent, RequestEventData } from "@sentry/nextjs"

import { describe, expect, it } from "vitest"

import { scrubSentryEvent } from "./sentry-scrub"

function eventWithRequest(request: RequestEventData): ErrorEvent {
  return { type: undefined, request }
}

describe("scrubSentryEvent / scrubRequest", () => {
  it("redacts a single-use auth token carried in request.url's query string", () => {
    const event = eventWithRequest({
      url: "https://app.example.com/api/auth/verify-email?token=eyJhbGciOiJIUzI1NiJ9.super-secret",
    })

    const result = scrubSentryEvent(event)

    expect(result.request?.url).toBe(
      "https://app.example.com/api/auth/verify-email?token=[REDACTED]",
    )
  })

  it("redacts a token in request.query_string given as a plain string", () => {
    const event = eventWithRequest({
      url: "https://app.example.com/api/auth/verify-email",
      query_string: "token=eyJhbGciOiJIUzI1NiJ9.super-secret&callbackURL=/dashboard",
    })

    const result = scrubSentryEvent(event)

    expect(result.request?.query_string).toBe("token=[REDACTED]&callbackURL=/dashboard")
  })

  it("redacts a token in request.query_string given as an array of tuples", () => {
    const event = eventWithRequest({
      query_string: [
        ["token", "eyJhbGciOiJIUzI1NiJ9.super-secret"],
        ["callbackURL", "/dashboard"],
      ],
    })

    const result = scrubSentryEvent(event)

    expect(result.request?.query_string).toEqual([
      ["token", "[REDACTED:credential]"],
      ["callbackURL", "/dashboard"],
    ])
  })

  it("redacts a token in request.query_string given as a key/value record", () => {
    const event = eventWithRequest({
      query_string: { token: "eyJhbGciOiJIUzI1NiJ9.super-secret", callbackURL: "/dashboard" },
    })

    const result = scrubSentryEvent(event)

    expect(result.request?.query_string).toEqual({
      token: "[REDACTED:credential]",
      callbackURL: "/dashboard",
    })
  })

  it("redacts a password-reset token carried as a URL path segment", () => {
    const event = eventWithRequest({
      url: "https://app.example.com/api/auth/reset-password/aVeryLongOneTimeResetToken123",
    })

    const result = scrubSentryEvent(event)

    expect(result.request?.url).toBe("https://app.example.com/api/auth/reset-password/[REDACTED]")
  })

  it("redacts a presigned-URL signature carried in the query string", () => {
    const event = eventWithRequest({
      url: "https://s3.example.com/bucket/key?X-Amz-Signature=abc123&X-Amz-Credential=AKIA.../scope",
    })

    const result = scrubSentryEvent(event)

    expect(result.request?.url).toBe(
      "https://s3.example.com/bucket/key?X-Amz-Signature=[REDACTED]&X-Amz-Credential=[REDACTED]",
    )
  })

  it("leaves a benign URL and query string untouched", () => {
    const event = eventWithRequest({
      url: "https://app.example.com/datasets/ds_123?page=2&sort=name",
      query_string: "page=2&sort=name",
    })

    const result = scrubSentryEvent(event)

    expect(result.request?.url).toBe("https://app.example.com/datasets/ds_123?page=2&sort=name")
    expect(result.request?.query_string).toBe("page=2&sort=name")
  })

  it("still empties cookies and scrubs headers/data as before", () => {
    const event = eventWithRequest({
      cookies: { session: "abc" },
      headers: { authorization: "Bearer abc123", "x-request-id": "req_1" },
      data: { password: "hunter2" },
    })

    const result = scrubSentryEvent(event)

    expect(result.request?.cookies).toEqual({})
    expect(result.request?.headers).toEqual({
      authorization: "[REDACTED:credential]",
      "x-request-id": "req_1",
    })
    expect(result.request?.data).toEqual({ password: "[REDACTED:credential]" })
  })
})
