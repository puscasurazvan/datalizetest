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
})
