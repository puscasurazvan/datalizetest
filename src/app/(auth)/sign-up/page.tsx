import Link from "next/link"
import { connection } from "next/server"

import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { configuredSocialProviders } from "@/shared/env"

import { SocialSignInButtons } from "../social-sign-in-buttons"
import { SignUpForm } from "./sign-up-form"

export default async function SignUpPage() {
  // Unlike /sign-in (dynamic because it reads `searchParams`), nothing here
  // reads a dynamic API on its own, so Next would otherwise prerender this
  // page once at build time — freezing `configuredSocialProviders()` to
  // whatever env the build machine had, and making the two pages able to
  // disagree about which providers are offered. `connection()` forces this
  // render to happen per request instead, the same as /sign-in.
  await connection()

  return (
    <Card>
      <CardHeader className="border-b border-hairline">
        <h1 className="text-headline-md text-ink">Create your account</h1>
      </CardHeader>
      <CardContent className="flex flex-col gap-space-lg">
        <SocialSignInButtons providers={configuredSocialProviders()} />
        <SignUpForm />
      </CardContent>
      <CardFooter className="border-t border-hairline pt-space-base text-body-sm text-ink-muted">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="ml-space-xs font-medium text-ink underline underline-offset-4"
        >
          Sign in
        </Link>
      </CardFooter>
    </Card>
  )
}
