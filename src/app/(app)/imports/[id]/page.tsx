import { notFound } from "next/navigation"
import type { ReactNode } from "react"

import { DATALIZE_TYPES, SAMPLE_SIZE, getImportView } from "@/modules/imports"
import type { ImportView } from "@/modules/imports"
import { listAvailableTimezones } from "@/modules/organizations"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

import { ConfirmImportForm } from "./confirm-import-form"
import { ImportOutcome } from "./import-outcome"
import { ImportProgress } from "./import-progress"
import { resolveActiveContext } from "../../active-context"

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await resolveActiveContext()
  if (context === "no-active-organization") {
    return null
  }

  const view = await loadImportView(context, id)
  if (view === "not-found") {
    notFound()
  }

  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-wrap items-baseline gap-space-sm">
        <h1 className="text-[34px] font-bold tracking-[-0.03em] text-ink">Import</h1>
        <span className="font-mono text-code-md text-ink-muted">{view.originalFilename}</span>
      </header>
      {await renderImportBody(context, view)}
    </div>
  )
}

/**
 * One branch per `ImportPhase` (imports/internal/read.ts), no `default`
 * case — that module's own doc: an `ImportPhase` added without extending
 * this fails `pnpm typecheck`, not a review. `awaiting_confirmation` is the
 * only branch that needs a second read (the timezone picker's options), so
 * it is the only one that awaits anything beyond `view` itself.
 */
async function renderImportBody(context: RequestContext, view: ImportView): Promise<ReactNode> {
  switch (view.phase) {
    case "profiling":
    case "loading":
      return <ImportProgress phase={view.phase} />
    case "awaiting_confirmation": {
      const timezones = await listAvailableTimezones()
      return (
        <ConfirmImportForm
          importId={view.importId}
          proposedSchema={view.proposedSchema}
          organizationTimezone={context.organizationTimezone}
          timezones={timezones}
          typeOptions={DATALIZE_TYPES}
          sampleSize={SAMPLE_SIZE}
        />
      )
    }
    case "completed":
    case "failed":
    case "cancelled":
      return <ImportOutcome view={view} />
  }
}

async function loadImportView(
  context: RequestContext,
  importId: string,
): Promise<ImportView | "not-found"> {
  try {
    return await getImportView(context, importId)
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") {
      return "not-found"
    }
    throw error
  }
}
