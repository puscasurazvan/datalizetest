import { describe, expect, it } from "vitest"

import { configuredSocialProviders, devSignInEnabled, EnvironmentError, parseEnv } from "./env"

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

  // docs/decisions/07: a social provider configured with only one of its
  // two values is a configuration error, not a partially-working provider,
  // and must fail at boot rather than silently disabling itself.
  describe("social provider pair validation", () => {
    it("rejects a Google client id with no secret", () => {
      expect(() => parseEnv({ ...valid, GOOGLE_CLIENT_ID: "id-only" })).toThrowError(
        /GOOGLE_CLIENT_SECRET/,
      )
    })

    it("rejects a Google client secret with no id", () => {
      expect(() => parseEnv({ ...valid, GOOGLE_CLIENT_SECRET: "secret-only" })).toThrowError(
        /GOOGLE_CLIENT_ID/,
      )
    })

    it("rejects a GitHub client id with no secret", () => {
      expect(() => parseEnv({ ...valid, GITHUB_CLIENT_ID: "id-only" })).toThrowError(
        /GITHUB_CLIENT_SECRET/,
      )
    })

    it("rejects a GitHub client secret with no id", () => {
      expect(() => parseEnv({ ...valid, GITHUB_CLIENT_SECRET: "secret-only" })).toThrowError(
        /GITHUB_CLIENT_ID/,
      )
    })

    it("accepts a provider configured with both values", () => {
      const result = parseEnv({
        ...valid,
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      })
      expect(result.GOOGLE_CLIENT_ID).toBe("id")
      expect(result.GOOGLE_CLIENT_SECRET).toBe("secret")
    })

    it("accepts an environment with neither value for a provider", () => {
      expect(parseEnv(valid).GOOGLE_CLIENT_ID).toBeUndefined()
      expect(parseEnv(valid).GOOGLE_CLIENT_SECRET).toBeUndefined()
    })

    // A blank pasted value must normalize to undefined before the pair
    // check runs, the same as any other optional secret — otherwise a
    // fresh .env.example clone (which ships both keys as `""`) would fail
    // to boot instead of simply not offering the provider.
    it("does not treat a blank pasted value as configuring the provider", () => {
      expect(() =>
        parseEnv({ ...valid, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }),
      ).not.toThrowError()
    })
  })
})

describe("configuredSocialProviders", () => {
  it("lists no providers when neither is configured", () => {
    expect(configuredSocialProviders(parseEnv(valid))).toEqual([])
  })

  it("lists google once its pair is set, github still absent", () => {
    const environment = parseEnv({
      ...valid,
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
    })
    expect(configuredSocialProviders(environment)).toEqual(["google"])
  })

  it("lists both once both pairs are set", () => {
    const environment = parseEnv({
      ...valid,
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
    })
    expect(configuredSocialProviders(environment)).toEqual(["google", "github"])
  })
})

// The development sign-in route establishes a real session. What keeps it a
// dev tool rather than a backdoor is that production refuses to boot with it
// set — so that refusal is the test that matters, not the route's own check.
describe("DEV_SIGN_IN", () => {
  it("refuses to boot in production when it is set", () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: "production", DEV_SIGN_IN: "true" })).toThrowError(
      EnvironmentError,
    )
    expect(() => parseEnv({ ...valid, NODE_ENV: "production", DEV_SIGN_IN: "true" })).toThrowError(
      /DEV_SIGN_IN/,
    )
  })

  it("boots in production when it is unset or blank", () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: "production" })).not.toThrow()
    // `.env.example` ships it blank, and a declared-but-unset Vercel variable
    // arrives as "" — neither may be read as "on".
    expect(() => parseEnv({ ...valid, NODE_ENV: "production", DEV_SIGN_IN: "" })).not.toThrow()
    expect(devSignInEnabled(parseEnv({ ...valid, NODE_ENV: "production", DEV_SIGN_IN: "" }))).toBe(
      false,
    )
  })

  it("is off unless explicitly set, even in development", () => {
    expect(devSignInEnabled(parseEnv({ ...valid, NODE_ENV: "development" }))).toBe(false)
    expect(devSignInEnabled(parseEnv({ ...valid, NODE_ENV: "development", DEV_SIGN_IN: "" }))).toBe(
      false,
    )
  })

  it("is on in development once set", () => {
    expect(
      devSignInEnabled(parseEnv({ ...valid, NODE_ENV: "development", DEV_SIGN_IN: "true" })),
    ).toBe(true)
  })
})
