import Link from "next/link"

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { configuredSocialProviders, devSignInEnabled } from "@/shared/env"

import { SOCIAL_PROVIDER_LABELS } from "../social-providers"
import { SocialSignInButtons } from "../social-sign-in-buttons"
import { SignInForm } from "./sign-in-form"

interface SignInPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Turns the OAuth callback's own query params into copy naming the
 * provider and what to do — never the raw `error`/`error_description`
 * Better Auth (or the provider itself) put on the redirect
 * (docs/decisions/07: "never a raw provider error string or an error code
 * alone"). `provider` only ever names google/github — it comes from the
 * `errorCallbackURL` this app set in `SocialSignInButtons`, not from the
 * provider — so an unrecognised value here means the failure happened
 * before Better Auth got that far, not that a third provider exists.
 */
function oauthCallbackErrorMessage(provider: string | string[] | undefined): string {
  const id = Array.isArray(provider) ? provider[0] : provider
  const label = id === "google" || id === "github" ? SOCIAL_PROVIDER_LABELS[id] : undefined

  if (label === undefined) {
    return "Something went wrong signing you in. Try again, or use your email and password below."
  }

  return `Continue with ${label} didn't complete. Try again, or use your email and password below.`
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams
  const oauthError =
    params.error !== undefined ? oauthCallbackErrorMessage(params.provider) : undefined

  return (
    <Card>
      <CardHeader className="border-b border-hairline">
        <CardTitle className="text-[15px] font-semibold">Sign in</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {oauthError ? (
          <p role="alert" className="text-sm text-danger">
            {oauthError}
          </p>
        ) : null}
        <SocialSignInButtons providers={configuredSocialProviders()} />
        <SignInForm />
        {devSignInEnabled() ? (
          // A real document navigation, not `next/link`: the target is a Route
          // Handler rather than a page, and the browser has to follow its
          // redirect and store the `set-cookie` it carries. A client-side
          // transition would do neither.
          // oxlint-disable-next-line next/no-html-link-for-pages
          <a
            href="/api/dev/sign-in"
            className="block rounded-md border border-dashed border-border px-3 py-2 text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Sign in as the demo user (development only)
          </a>
        ) : null}
      </CardContent>
      <CardFooter className="border-t border-hairline pt-4 font-mono text-[11px] text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href="/sign-up"
          className="ml-1 font-medium text-foreground underline underline-offset-4"
        >
          Create one
        </Link>
      </CardFooter>
    </Card>
  )
}
