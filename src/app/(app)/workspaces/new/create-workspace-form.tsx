"use client"

import { useRouter } from "next/navigation"
import { useActionState, useEffect } from "react"

import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field-error"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createWorkspaceAction } from "./actions"

/**
 * Used both as the zero-workspace onboarding view (rendered by
 * `(app)/layout.tsx` in place of the shell) and as the page at
 * `/workspaces/new` for a signed-in user adding another workspace — one
 * form, two entry points.
 */
export function CreateWorkspaceForm() {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(createWorkspaceAction, null)

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
  const nameErrorId = fieldErrors.name ? "workspace-name-error" : undefined

  return (
    <form action={formAction} className="flex flex-col gap-space-lg" noValidate>
      <div className="flex flex-col gap-space-sm">
        <Label htmlFor="workspace-name">Workspace name</Label>
        <Input
          id="workspace-name"
          name="name"
          autoComplete="off"
          required
          aria-invalid={Boolean(fieldErrors.name)}
          aria-describedby={nameErrorId}
        />
        <FieldError id="workspace-name-error" message={fieldErrors.name} />
      </div>
      {formError ? (
        <p role="alert" className="text-body-sm text-refused">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Create workspace"}
      </Button>
    </form>
  )
}
