import Link from "next/link"

import { Card } from "@/components/ui/card"

import { SignUpForm } from "./sign-up-form"

export default function SignUpPage() {
  return (
    <Card>
      <h1 className="mb-6 text-xl font-semibold text-foreground">Create your account</h1>
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
