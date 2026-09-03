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

/**
 * A social provider (docs/decisions/07) needs both halves of its pair to
 * function — an id with no secret, or a secret with no id, can never be a
 * deliberate configuration, only a copy-paste mistake (one value pasted,
 * the other forgotten) that would otherwise leave the provider silently
 * absent from the sign-in UI instead of surfacing as the boot-time error
 * it actually is. Called once per provider from the schema's
 * `superRefine` below; `ctx.addIssue` attaches the message to whichever
 * key is missing, so `EnvironmentError` names the exact variable to set.
 */
function checkProviderPair(
  ctx: z.RefinementCtx,
  idKey: "GOOGLE_CLIENT_ID" | "GITHUB_CLIENT_ID",
  id: string | undefined,
  secretKey: "GOOGLE_CLIENT_SECRET" | "GITHUB_CLIENT_SECRET",
  secret: string | undefined,
): void {
  if (id !== undefined && secret === undefined) {
    ctx.addIssue({
      code: "custom",
      path: [secretKey],
      message: `${secretKey} is required when ${idKey} is set (docs/decisions/07).`,
    })
  }
  if (secret !== undefined && id === undefined) {
    ctx.addIssue({
      code: "custom",
      path: [idKey],
      message: `${idKey} is required when ${secretKey} is set (docs/decisions/07).`,
    })
  }
}

const schema = z
  .object({
    DATABASE_URL: z.url(),
    ANALYTICAL_DATABASE_URL: z.url(),

    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),

    // Social sign-in (docs/decisions/07). Optional: a provider whose
    // credentials are absent is simply not offered in the UI, so a fresh
    // clone runs on email and password alone. See `checkProviderPair`
    // above for why a lone id or a lone secret fails at boot instead.
    GOOGLE_CLIENT_ID: optionalSecret(),
    GOOGLE_CLIENT_SECRET: optionalSecret(),
    GITHUB_CLIENT_ID: optionalSecret(),
    GITHUB_CLIENT_SECRET: optionalSecret(),

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
  .superRefine((value, ctx) => {
    checkProviderPair(
      ctx,
      "GOOGLE_CLIENT_ID",
      value.GOOGLE_CLIENT_ID,
      "GOOGLE_CLIENT_SECRET",
      value.GOOGLE_CLIENT_SECRET,
    )
    checkProviderPair(
      ctx,
      "GITHUB_CLIENT_ID",
      value.GITHUB_CLIENT_ID,
      "GITHUB_CLIENT_SECRET",
      value.GITHUB_CLIENT_SECRET,
    )
  })

export type Env = z.infer<typeof schema>

/** The social providers Datalize can offer (docs/decisions/07) — Google and GitHub only. */
export type SocialProviderId = "google" | "github"

/**
 * Providers with both credential values present. The schema's
 * `superRefine` above guarantees a provider's pair is never partially
 * set by the time `env()` returns, so checking the client id alone is
 * enough here.
 *
 * Used directly by the sign-in/sign-up UI (src/app/(auth)) to decide which
 * buttons to render. `src/modules/auth/auth.ts` builds Better Auth's
 * `socialProviders` map from the same underlying fields (it needs the
 * actual credential values, not just a yes/no per provider, so it can't
 * call this helper itself) — but both read the same env fields behind the
 * same boot-time pair check above, so the set of providers Better Auth
 * accepts and the set the UI offers a button for can never drift apart.
 */
export function configuredSocialProviders(environment: Env = env()): SocialProviderId[] {
  const providers: SocialProviderId[] = []
  if (environment.GOOGLE_CLIENT_ID !== undefined) {
    providers.push("google")
  }
  if (environment.GITHUB_CLIENT_ID !== undefined) {
    providers.push("github")
  }
  return providers
}

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
