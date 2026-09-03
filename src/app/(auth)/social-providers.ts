import type { SocialProviderId } from "@/shared/env"

export type { SocialProviderId }

/**
 * Display name for provider copy — "Continue with Google" — never a bare
 * icon, which is unreadable to a screen reader and ambiguous to everyone
 * else (docs/decisions/07). Shared by `SocialSignInButtons` and the
 * sign-in page's OAuth-callback-error message so the two never name a
 * provider differently.
 */
export const SOCIAL_PROVIDER_LABELS: Record<SocialProviderId, string> = {
  google: "Google",
  github: "GitHub",
}
