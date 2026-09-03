import Link from "next/link"
import { connection } from "next/server"

import { Card } from "@/components/ui/card"
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
      <h1 className="mb-6 text-xl font-semibold text-foreground">Create your account</h1>
      <SocialSignInButtons providers={configuredSocialProviders()} />
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </Card>
  )
}
