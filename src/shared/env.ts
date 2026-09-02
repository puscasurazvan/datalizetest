import { z } from "zod"

/**
 * Environment is validated once, at first import, and fails loudly.
 * A missing variable must never reach runtime as `undefined`.
 */

/**
 * An optional secret/config value: present-and-non-blank, or absent —
 * never present-but-blank. `z.string().optional()` alone accepts `""`,
 * which is a real, distinct footgun here: `.env.example` ships these keys
 * with an empty value (e.g. `TRIGGER_SECRET_KEY=""`), a freshly declared
 * but unset Vercel env var resolves to `""` too, and callers such as
 * `selectJobDispatcher` (src/modules/jobs/index.ts) branch on
 * `=== undefined` to decide "not configured" — so a blank string must
 * normalize to `undefined` before it ever reaches that check, not merely
 * fail validation (which would turn a fresh `.env.example` clone into a
 * boot failure).
 */
const optionalSecret = () =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(1).optional(),
  )

const schema = z.object({
  DATABASE_URL: z.url(),
  ANALYTICAL_DATABASE_URL: z.url(),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),

  STORAGE_ENDPOINT: optionalSecret(),
  STORAGE_REGION: optionalSecret(),
  STORAGE_BUCKET: optionalSecret(),
  STORAGE_ACCESS_KEY_ID: optionalSecret(),
  STORAGE_SECRET_ACCESS_KEY: optionalSecret(),

  TRIGGER_SECRET_KEY: optionalSecret(),
  TRIGGER_PROJECT_ID: optionalSecret(),

  SENTRY_DSN: optionalSecret(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
})

export type Env = z.infer<typeof schema>

export class EnvironmentError extends Error {
  constructor(issues: string) {
    super(`Invalid environment:\n${issues}`)
    this.name = "EnvironmentError"
  }
}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source)

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n")
    throw new EnvironmentError(issues)
  }

  return result.data
}

let cached: Env | undefined

export function env(): Env {
  cached ??= parseEnv()
  return cached
}
