"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field-error"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"

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
  const timezoneDescribedBy = ["timezone-warning", timezoneErrorId].filter(Boolean).join(" ")

  // A native <select> whose value matches no option silently selects the first
  // one, so submitting the form unchanged would overwrite the workspace timezone
  // with whatever sorted first. Surface the stored value instead of swallowing it.
  const selectedTimezone = savedTimezone ?? currentTimezone
  const isRecognised = availableTimezones.includes(selectedTimezone)

  return (
    <form action={formAction} className="flex flex-col gap-space-lg">
      <div className="flex flex-col gap-space-sm">
        <Label htmlFor="timezone">Timezone</Label>
        <NativeSelect
          id="timezone"
          name="timezone"
          defaultValue={selectedTimezone}
          disabled={!canEdit}
          aria-describedby={timezoneDescribedBy}
        >
          {!isRecognised && (
            <option value={selectedTimezone}>{selectedTimezone} — not recognised</option>
          )}
          {availableTimezones.map((timezone) => (
            <option key={timezone} value={timezone}>
              {timezone}
            </option>
          ))}
        </NativeSelect>
        <FieldError id="timezone-error" message={fieldErrors.timezone} />
        <p id="timezone-warning" className="text-body-sm text-ink-muted">
          Changing this will affect how all date-based charts group data. Historical query results
          are not retroactively updated.
        </p>
      </div>

      {formError ? (
        <p role="alert" className="text-body-sm text-refused">
          {formError}
        </p>
      ) : null}

      {savedTimezone ? (
        <output className="block text-body-sm text-ink">
          Timezone updated to {savedTimezone}.
        </output>
      ) : null}

      {canEdit ? (
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Saving…" : "Save timezone"}
        </Button>
      ) : (
        <p className="text-body-sm text-ink-muted">
          Only an owner or admin can change the workspace timezone.
        </p>
      )}
    </form>
  )
}
