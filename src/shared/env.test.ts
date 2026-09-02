import { describe, expect, it } from "vitest"

import { EnvironmentError, parseEnv } from "./env"

const valid = {
  DATABASE_URL: "postgresql://datalize:datalize@localhost:5433/datalize",
  ANALYTICAL_DATABASE_URL: "postgresql://datalize:datalize@localhost:5433/datalize",
  BETTER_AUTH_SECRET: "a-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
} satisfies Record<string, string | undefined>

describe("parseEnv", () => {
  it("accepts a complete environment", () => {
    expect(parseEnv(valid).DATABASE_URL).toBe(valid.DATABASE_URL)
  })

  it("defaults NODE_ENV to development", () => {
    expect(parseEnv(valid).NODE_ENV).toBe("development")
  })

  it("throws a named error naming the missing variable", () => {
    const { DATABASE_URL: _omitted, ...withoutDatabaseUrl } = valid

    expect(() => parseEnv(withoutDatabaseUrl)).toThrowError(EnvironmentError)
    expect(() => parseEnv(withoutDatabaseUrl)).toThrowError(/DATABASE_URL/)
  })

  it("rejects a secret that is too short to be a secret", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrowError(
      /BETTER_AUTH_SECRET/,
    )
  })

  // A present-but-blank optional secret (e.g. `TRIGGER_SECRET_KEY=""` from a
  // freshly copied .env.example, or a Vercel env var declared and left
  // empty) must parse the same as an absent one. selectJobDispatcher
  // (src/modules/jobs/index.ts) branches on `=== undefined` only, so `""`
  // slipping through as `""` would make it construct a TriggerDevDispatcher
  // with an empty access token instead of falling back to InlineDispatcher.
  it("normalizes a blank optional secret to undefined, not empty string", () => {
    expect(parseEnv({ ...valid, TRIGGER_SECRET_KEY: "" }).TRIGGER_SECRET_KEY).toBeUndefined()
  })

  it("still accepts a real value for an optional secret", () => {
    expect(parseEnv({ ...valid, TRIGGER_SECRET_KEY: "tr_dev_abc123" }).TRIGGER_SECRET_KEY).toBe(
      "tr_dev_abc123",
    )
  })

  it("normalizes a whitespace-only optional secret to undefined", () => {
    expect(parseEnv({ ...valid, SENTRY_DSN: "   " }).SENTRY_DSN).toBeUndefined()
  })
})
