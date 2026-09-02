"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field-error"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"

import { updateTimezoneAction } from "./actions"

export interface TimezoneFormProps {
  currentTimezone: string
  availableTimezones: string[]
  canEdit: boolean
}

export function TimezoneForm({ currentTimezone, availableTimezones, canEdit }: TimezoneFormProps) {
  const [state, formAction, pending] = useActionState(updateTimezoneAction, null)

  const fieldErrors = state && !state.ok ? state.fieldErrors : {}
  const formError = state && !state.ok ? state.formError : undefined
  const savedTimezone = state && state.ok ? state.data.timezone : undefined
  const timezoneErrorId = fieldErrors.timezone ? "timezone-error" : undefined

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="timezone">Timezone</Label>
        <Select
          id="timezone"
          name="timezone"
          defaultValue={savedTimezone ?? currentTimezone}
          disabled={!canEdit}
          aria-describedby={`timezone-warning ${timezoneErrorId ?? ""}`.trim()}
        >
          {availableTimezones.map((timezone) => (
            <option key={timezone} value={timezone}>
              {timezone}
            </option>
          ))}
        </Select>
        <FieldError id="timezone-error" message={fieldErrors.timezone} />
      </div>

      <p id="timezone-warning" className="text-sm text-muted-foreground">
        Changing this will affect how all date-based charts group data. Historical query results are
        not retroactively updated.
      </p>

      {formError ? (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      ) : null}

      {savedTimezone ? (
        <output className="block text-sm text-foreground">
          Timezone updated to {savedTimezone}.
        </output>
      ) : null}

      {canEdit ? (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save timezone"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only an owner or admin can change the workspace timezone.
        </p>
      )}
    </form>
  )
}
