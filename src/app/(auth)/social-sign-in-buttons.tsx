"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { authClient } from "@/modules/auth/client"

import { SOCIAL_PROVIDER_LABELS, type SocialProviderId } from "./social-providers"

export interface SocialSignInButtonsProps {
  providers: readonly SocialProviderId[]
}

/**
 * Provider buttons shown above the email form, with a divider below them
 * (docs/decisions/07). Renders nothing at all when `providers` is empty —
 * a fresh clone with no provider configured must not show a floating
 * divider with no buttons above it.
 *
 * A provider without credentials is simply absent from `providers`
 * (`configuredSocialProviders`, src/shared/env.ts) — never rendered here
 * disabled, which would be a button that cannot work, worse than no
 * button at all.
 */
export function SocialSignInButtons({ providers }: SocialSignInButtonsProps) {
  const [pendingProvider, setPendingProvider] = useState<SocialProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (providers.length === 0) {
    return null
  }

  async function startSocialSignIn(provider: SocialProviderId) {
    setError(null)
    setPendingProvider(provider)

    // A callback failure (consent denied, an unverifiable profile, ...) is
    // handled entirely server-side by Better Auth's OAuth callback, which
    // redirects the browser back to /sign-in with `?provider=` set — see
    // that page for the friendly message shown there. `startError` here
    // only ever fires when the request that kicks off the redirect itself
    // could not be made.
    const { error: startError } = await authClient.signIn.social({
      provider,
      callbackURL: "/datasets",
      errorCallbackURL: `/sign-in?provider=${provider}`,
    })

    if (startError) {
      setError(startError.message ?? `Could not start ${SOCIAL_PROVIDER_LABELS[provider]} sign-in.`)
      setPendingProvider(null)
    }
  }

  return (
    <div className="flex flex-col gap-space-base">
      <div className="flex flex-col gap-space-sm">
        {providers.map((provider) => (
          <Button
            key={provider}
            variant="secondary"
            disabled={pendingProvider !== null}
            className="w-full"
            // `Button` is a plain unmemoized wrapper around a native `<button>`
            // (src/components/ui/button.tsx), so there is no memoized child for a
            // fresh closure to defeat.
            // oxlint-disable-next-line react-perf/jsx-no-new-function-as-prop
            onClick={() => void startSocialSignIn(provider)}
          >
            {pendingProvider === provider
              ? `Connecting to ${SOCIAL_PROVIDER_LABELS[provider]}…`
              : `Continue with ${SOCIAL_PROVIDER_LABELS[provider]}`}
          </Button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-body-sm text-refused">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-space-md">
        <hr className="h-px flex-1 border-0 bg-hairline" />
        <span className="font-mono text-label-mono uppercase tracking-wider text-ink-faint">
          or
        </span>
        <hr className="h-px flex-1 border-0 bg-hairline" />
      </div>
    </div>
  )
}
