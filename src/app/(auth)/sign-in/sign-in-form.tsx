"use client"

import { useRouter } from "next/navigation"
import { useActionState, useEffect } from "react"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field-error"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/modules/auth/client"
import type { ActionResult } from "@/shared/validation/action-result"
import { formErrorsFromZod } from "@/shared/validation/zod-form"

const signInSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
})

async function signIn(
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })
  if (!parsed.success) {
    const { formError, fieldErrors } = formErrorsFromZod(parsed.error)
    return { ok: false, formError: formError ?? "Check the form and try again.", fieldErrors }
  }

  const { error } = await authClient.signIn.email(parsed.data)
  if (error) {
    return { ok: false, formError: error.message ?? "Could not sign you in.", fieldErrors: {} }
  }

  return { ok: true, data: null }
}

export function SignInForm() {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(signIn, null)

  useEffect(() => {
    if (state?.ok) {
      router.push("/datasets")
    }
  }, [state, router])

  const fieldErrors = state && !state.ok ? state.fieldErrors : {}
  const formError = state && !state.ok ? state.formError : undefined

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
        />
        <FieldError id="email-error" message={fieldErrors.email} />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? "password-error" : undefined}
        />
        <FieldError id="password-error" message={fieldErrors.password} />
      </div>
      {formError ? (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  )
}
