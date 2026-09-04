"use client"

import { useRouter } from "next/navigation"
import { useState, type ChangeEvent, type FormEvent } from "react"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field-error"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
// Reaches past the module's barrel on purpose (the same reason
// confirm-import-form.tsx reaches past it for confirmImportAction):
// `@/modules/imports`'s index also re-exports the pipeline's non-action
// internals, which pull in `@/db/client`'s `pg` — fine in a Server Action,
// but `pg` requires Node's `net`/`tls`, which `next build` cannot resolve
// for a "use client" bundle. `start-action.ts` carries its own "use server"
// directive, so importing it directly here is exactly as safe either way.
import { startImportAction } from "@/modules/imports/start-action"
// Reaches past the module's barrel (`@/modules/storage`) on purpose: that
// barrel re-exports `S3StorageProvider`, which pulls in the AWS SDK — fine
// bundled into a Server Action, unwanted in this "use client" file.
// `provider.ts` itself has no runtime imports, so importing it directly is
// the one way to reuse the exact ceiling `start.ts`'s `statObject` check
// enforces server-side, without dragging the SDK into the browser bundle.
import { MAX_UPLOAD_BYTES } from "@/modules/storage/provider"

// Hoisted, not inlined: a fresh element every render is what
// react-perf/jsx-no-jsx-as-prop flags on `render` props (see
// src/app/design/overlay-section.tsx's identical DialogTrigger use).
const triggerButton = <Button />

const presignResponseSchema = z.object({
  key: z.string().min(1),
  url: z.string().min(1),
})

const safeErrorDtoSchema = z.object({
  code: z.string(),
  message: z.string(),
})

type UploadPhase =
  | { readonly status: "idle" }
  | { readonly status: "presigning" }
  | { readonly status: "uploading" }
  | { readonly status: "starting" }
  | {
      readonly status: "error"
      readonly message: string
      readonly fieldErrors: Record<string, string>
    }

const IDLE_PHASE: UploadPhase = { status: "idle" }

export interface ImportCsvButtonProps {
  /** Omit to create a new Dataset; pass an existing Dataset's id to add a version to it. */
  readonly datasetId?: string
}

function deriveDatasetName(filename: string): string {
  return /\.csv$/i.test(filename) ? filename.slice(0, -4) : filename
}

function submitLabelFor(status: UploadPhase["status"]): string {
  switch (status) {
    case "presigning":
      return "Preparing upload…"
    case "uploading":
      return "Uploading…"
    case "starting":
      return "Starting import…"
    case "idle":
    case "error":
      return "Import"
  }
}

/**
 * The product's front door: a person with a CSV and no developer. Uploads
 * straight from the browser to object storage (the presigned PUT `start.ts`
 * expects), then hands the resulting object key to `startImportAction`.
 * Every state this can end in names what to do next — never a bare spinner
 * or a raw fetch error.
 */
export function ImportCsvButton({ datasetId }: ImportCsvButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [datasetName, setDatasetName] = useState("")
  const [phase, setPhase] = useState<UploadPhase>(IDLE_PHASE)

  const isBusy =
    phase.status === "presigning" || phase.status === "uploading" || phase.status === "starting"
  const fieldErrors = phase.status === "error" ? phase.fieldErrors : {}
  const nameMissing = datasetId === undefined && datasetName.trim() === ""
  const canSubmit = file !== null && !isBusy && !nameMissing

  function handleOpenChange(nextOpen: boolean) {
    // Refuses to close mid-upload rather than abandoning an in-flight PUT
    // silently — the dialog itself is the only signal the user has that
    // anything is happening at all.
    if (!nextOpen && isBusy) {
      return
    }
    setOpen(nextOpen)
    if (nextOpen) {
      setFile(null)
      setDatasetName("")
      setPhase(IDLE_PHASE)
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    if (selected === undefined) {
      return
    }
    // Advisory only — `start.ts`'s `statObject` check is what actually
    // enforces the ceiling. This just saves the user a presign round trip
    // and an upload for a file that will be rejected anyway.
    if (selected.size > MAX_UPLOAD_BYTES) {
      setFile(null)
      setPhase({
        status: "error",
        message: `File exceeds the ${MAX_UPLOAD_BYTES}-byte limit (size ${selected.size} bytes). Choose a smaller file.`,
        fieldErrors: {},
      })
      return
    }
    setFile(selected)
    setPhase(IDLE_PHASE)
    if (datasetId === undefined) {
      setDatasetName(deriveDatasetName(selected.name))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || file === null) {
      return
    }

    // Everything below can throw for reasons that have nothing to do with
    // the specific failures handled inline (a dropped connection before the
    // presign response even arrives, a non-JSON body from a proxy's error
    // page, the RSC transport rejecting under `startImportAction`). Without
    // this catch any of those leaves `phase` stuck on "presigning" /
    // "starting" forever — a disabled button reading "Starting import…"
    // with no way out, since `handleOpenChange` also refuses to close the
    // dialog while busy. The PUT's own `catch` below already handles its
    // more specific (and more actionable) MinIO message and returns, so it
    // never reaches this one.
    try {
      setPhase({ status: "presigning" })
      const presignResponse = await fetch("/api/uploads", { method: "POST" })
      const presignBody: unknown = await presignResponse.json()
      if (!presignResponse.ok) {
        const safe = safeErrorDtoSchema.parse(presignBody)
        setPhase({ status: "error", message: safe.message, fieldErrors: {} })
        return
      }
      const target = presignResponseSchema.parse(presignBody)

      setPhase({ status: "uploading" })
      try {
        const putResponse = await fetch(target.url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "text/csv" },
        })
        if (!putResponse.ok) {
          setPhase({
            status: "error",
            message: `Storage rejected the upload (status ${putResponse.status}). The upload link may have expired — try again.`,
            fieldErrors: {},
          })
          return
        }
      } catch {
        // The PUT goes straight from the browser to object storage — a
        // network-level failure here (fetch throws a bare TypeError, with
        // no status to inspect) most likely means storage is not
        // configured locally, not a transient blip. Name the actual local
        // cause.
        setPhase({
          status: "error",
          message:
            "Could not reach object storage. If you're running this locally, make sure MinIO is running (docker compose up -d) and the STORAGE_* variables in .env are set — see .env.example.",
          fieldErrors: {},
        })
        return
      }

      setPhase({ status: "starting" })
      const result =
        datasetId === undefined
          ? await startImportAction({
              objectKey: target.key,
              originalFilename: file.name,
              contentType: file.type || "text/csv",
              datasetName,
            })
          : await startImportAction({
              objectKey: target.key,
              originalFilename: file.name,
              contentType: file.type || "text/csv",
              datasetId,
            })
      if (!result.ok) {
        setPhase({ status: "error", message: result.formError, fieldErrors: result.fieldErrors })
        return
      }
      router.push(`/imports/${result.data.importId}`)
    } catch {
      setPhase({
        status: "error",
        message: "The upload could not be started. Check your connection and try again.",
        fieldErrors: {},
      })
    }
  }

  const triggerLabel = datasetId === undefined ? "Import CSV" : "Add a version"
  const dialogTitle = datasetId === undefined ? "Import a CSV" : "Add a version"
  const dialogDescription =
    datasetId === undefined
      ? "Upload a CSV to create a new Dataset."
      : "Upload a CSV to add a new version to this Dataset."

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={triggerButton}>{triggerLabel}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="flex flex-col gap-space-lg"
          noValidate
        >
          <div className="flex flex-col gap-space-sm">
            <Label htmlFor="import-csv-file">CSV file</Label>
            <Input
              id="import-csv-file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              disabled={isBusy}
              onChange={handleFileChange}
            />
          </div>
          {datasetId === undefined ? (
            <div className="flex flex-col gap-space-sm">
              <Label htmlFor="import-dataset-name">Dataset name</Label>
              <Input
                id="import-dataset-name"
                name="datasetName"
                value={datasetName}
                required
                disabled={isBusy}
                aria-invalid={Boolean(fieldErrors.datasetName)}
                aria-describedby={fieldErrors.datasetName ? "import-dataset-name-error" : undefined}
                onChange={(event) => setDatasetName(event.target.value)}
              />
              <FieldError id="import-dataset-name-error" message={fieldErrors.datasetName} />
            </div>
          ) : null}
          {phase.status === "error" ? (
            <p role="alert" className="text-body-sm text-refused">
              {phase.message}
            </p>
          ) : null}
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={!canSubmit}>
              {submitLabelFor(phase.status)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
