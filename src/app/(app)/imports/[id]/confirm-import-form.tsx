"use client"

import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { PENDING_CLASS } from "@/components/ui/pending"
import type { DatalizeType, ProposedSchema } from "@/modules/imports"
// Reaches past the module's barrel on purpose (matches
// `import-csv-button.tsx`'s `startImportAction` precedent, one file over):
// `@/modules/imports`'s index also re-exports the pipeline's non-action
// internals, which pull in `@/db/client`'s `pg` — fine in a Server Action,
// fatal for a "use client" bundle if this import forced that barrel module
// to actually evaluate. `confirm-action.ts` carries its own "use server"
// directive, so importing it directly here is exactly as safe either way,
// and it's the one binding this file needs.
import { confirmImportAction } from "@/modules/imports/confirm-action"

import { ProposedSchemaTable } from "./proposed-schema-table"

type SubmitState =
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | { readonly status: "error"; readonly message: string }

/**
 * The confirm step: pick column overrides and a timezone, then commit. A
 * success moves the import to QUEUED (phase "loading" — read.ts) on the
 * SAME route, so this refreshes rather than navigating. H1: the write is a
 * compare-and-set (`recordConfirmedSchema`'s status predicate), so a second
 * tab racing this one can lose and get back the same VALIDATION message a
 * late arrival gets — refreshing there is what shows that tab the other
 * tab's outcome instead of leaving it stuck on a form for an import that
 * already moved on.
 */
export function ConfirmImportForm({
  importId,
  proposedSchema,
  organizationTimezone,
  timezones,
  typeOptions,
  sampleSize,
}: {
  importId: string
  proposedSchema: ProposedSchema
  organizationTimezone: string
  timezones: readonly string[]
  /** `DATALIZE_TYPES` (index.ts) — passed down rather than imported here; see the import comment above. */
  typeOptions: readonly DatalizeType[]
  /** `SAMPLE_SIZE` (H9) — same reason. */
  sampleSize: number
}) {
  const router = useRouter()
  const [overrides, setOverrides] = useState<Map<number, DatalizeType>>(new Map())
  const [timezone, setTimezone] = useState(organizationTimezone)
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" })
  const pending = submit.status === "pending"

  function handleOverrideChange(position: number, type: DatalizeType) {
    setOverrides((previous) => new Map(previous).set(position, type))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmit({ status: "pending" })

    const result = await confirmImportAction({
      importId,
      columnOverrides: [...overrides].map(([position, type]) => ({ position, type })),
      timezoneOverride: timezone === organizationTimezone ? undefined : timezone,
    })

    setSubmit(result.ok ? { status: "idle" } : { status: "error", message: result.formError })
    // Both branches need this: success moves the phase past this form
    // entirely, and the VALIDATION failure above is specifically the sign
    // that the OTHER side of a race already did (H1's doc comment above).
    router.refresh()
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-space-lg">
      <div className="flex flex-col gap-space-sm sm:max-w-sm">
        <Label htmlFor="import-timezone">Timezone for naive timestamps</Label>
        <NativeSelect
          id="import-timezone"
          value={timezone}
          disabled={pending}
          onChange={(event) => setTimezone(event.target.value)}
        >
          {timezones.map((name) => (
            <option key={name} value={name}>
              {name === organizationTimezone ? `${name} (workspace default)` : name}
            </option>
          ))}
        </NativeSelect>
        <p className="text-body-sm text-ink-muted">
          Every timestamp in this file with no UTC offset of its own is read as wall-clock time
          here. This is stamped on the Dataset Version and cannot change afterward.
        </p>
      </div>

      <ProposedSchemaTable
        columns={proposedSchema.columns}
        overrides={overrides}
        onOverrideChange={handleOverrideChange}
        typeOptions={typeOptions}
        sampleSize={sampleSize}
      />

      {submit.status === "error" ? (
        <p role="alert" className="text-body-sm text-refused">
          {submit.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <Button
          type="button"
          variant="outline"
          disabled
          title="Abandoning an import isn't built yet."
          className={PENDING_CLASS}
        >
          Refuse / Abandon
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Committing…" : "Confirm and load"}
        </Button>
      </div>
    </form>
  )
}
