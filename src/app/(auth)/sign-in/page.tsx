import Link from "next/link"

import { Card } from "@/components/ui/card"

import { SignInForm } from "./sign-in-form"

export default function SignInPage() {
  return (
    <Card>
      <h1 className="mb-6 text-xl font-semibold text-foreground">Sign in</h1>
      <SignInForm />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="font-medium text-foreground underline underline-offset-4">
          Create one
        </Link>
      </p>
    </Card>
  )
}
