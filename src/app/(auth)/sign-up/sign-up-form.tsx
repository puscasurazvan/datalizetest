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

// Better Auth's `emailAndPassword` config (src/modules/auth/auth.ts) uses
// its own default `minPasswordLength` of 8 — mirrored here so a client-side
// rejection and the server's agree.
const signUpSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
})

async function signUp(
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  })
  if (!parsed.success) {
    const { formError, fieldErrors } = formErrorsFromZod(parsed.error)
    return { ok: false, formError: formError ?? "Check the form and try again.", fieldErrors }
  }

  const { error } = await authClient.signUp.email(parsed.data)
  if (error) {
    return {
      ok: false,
      formError: error.message ?? "Could not create your account.",
      fieldErrors: {},
    }
  }

  return { ok: true, data: null }
}

export function SignUpForm() {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(signUp, null)

  // Navigation is a side effect of a server response we can't act on
  // during render (the action result), not something to derive — this is
  // the one legitimate use of an effect here.
  useEffect(() => {
    if (state?.ok) {
      router.push("/datasets")
    }
  }, [state, router])

  const fieldErrors = state && !state.ok ? state.fieldErrors : {}
  const formError = state && !state.ok ? state.formError : undefined

  return (
    <form action={formAction} className="flex flex-col gap-space-lg" noValidate>
      <div className="flex flex-col gap-space-base">
        <div className="flex flex-col gap-space-sm">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            required
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
          />
          <FieldError id="name-error" message={fieldErrors.name} />
        </div>
        <div className="flex flex-col gap-space-sm">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
          />
          <FieldError id="email-error" message={fieldErrors.email} />
        </div>
        <div className="flex flex-col gap-space-sm">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
          />
          <FieldError id="password-error" message={fieldErrors.password} />
        </div>
      </div>
      {formError ? (
        <p role="alert" className="text-body-sm text-refused">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  )
}
