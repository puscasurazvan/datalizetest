/**
 * The confirm step (docs/decisions/06 #1, docs/decisions/04): applies the
 * user's column-type and timezone overrides to the proposed schema,
 * resolves the ONE timezone this import actually applies to naive values
 * (the organization's, or this override), writes
 * `imports.confirmed_schema`, and dispatches `import.load`.
 */
import { z } from "zod"

import { assertCan } from "@/modules/auth/policy"
import { toPolicyContext } from "@/modules/organizations"
import { CANONICAL_IANA_TIMEZONES } from "@/modules/organizations/canonical-timezones"
import type { JobDispatcher } from "@/modules/jobs"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

import { columnOverrideSchema, parseProposedSchema } from "./schema-types"
import type { ColumnOverride, ConfirmedSchema } from "./schema-types"
import {
  getImportForContext,
  recordConfirmedSchema,
  recordJobRunId,
} from "../repository/import-repository"

export const confirmImportInputSchema = z.strictObject({
  importId: z.string().min(1),
  columnOverrides: z.array(columnOverrideSchema).optional(),
  timezoneOverride: z.string().min(1).optional(),
})
export type ConfirmImportInput = z.infer<typeof confirmImportInputSchema>

export type ConfirmImportDeps = {
  readonly jobDispatcher: JobDispatcher
}

export type ConfirmImportResult = { readonly importId: string }

export async function confirmImport(
  context: RequestContext,
  input: ConfirmImportInput,
  deps: ConfirmImportDeps,
): Promise<ConfirmImportResult> {
  assertCan(toPolicyContext(context), "dataset:create")

  const importRow = await getImportForContext(context, input.importId)
  if (importRow.status !== "AWAITING_CONFIRMATION") {
    throw new AppError("VALIDATION", "This import is not awaiting confirmation.")
  }
  if (importRow.proposedSchema === null) {
    throw new AppError("VALIDATION", "This import has no proposed schema to confirm.")
  }

  const proposedSchema = parseProposedSchema(importRow.proposedSchema)
  const timezone = resolveTimezone(context, input.timezoneOverride)
  const overridesByPosition = new Map<number, ColumnOverride>(
    (input.columnOverrides ?? []).map((o) => [o.position, o] as const),
  )
  assertOverridesReferenceKnownColumns(proposedSchema.columns.length, input.columnOverrides ?? [])

  const confirmedSchema: ConfirmedSchema = {
    timezone,
    columns: proposedSchema.columns.map((column) => ({
      position: column.position,
      name: column.name,
      type: overridesByPosition.get(column.position)?.type ?? column.type,
    })),
  }

  // The pre-read check above is the fast path; this is the correctness
  // guarantee under concurrency (plan H1). A second confirm racing this one
  // can still pass the pre-read before either writes — `recordConfirmedSchema`'s
  // WHERE re-checks status at the moment of the write, so at most one of two
  // concurrent calls updates a row. The loser gets the same VALIDATION error
  // the pre-read check gives a call that arrives after the fact.
  const updatedRowCount = await recordConfirmedSchema(context, input.importId, confirmedSchema)
  if (updatedRowCount === 0) {
    throw new AppError("VALIDATION", "This import is not awaiting confirmation.")
  }

  const jobReference = await deps.jobDispatcher.enqueue(
    "IMPORT_LOAD",
    { importId: input.importId },
    { idempotencyKey: input.importId },
  )
  await recordJobRunId(context, input.importId, jobReference.runId)

  return { importId: input.importId }
}

/**
 * The organization's timezone unless the user overrode it for this import
 * (docs/adr/0004) — validated against the same curated canonical IANA
 * allowlist `src/modules/organizations` uses for the organization's own
 * timezone (docs/decisions/03), never against `pg_timezone_names` directly
 * (that view also lists fixed-offset abbreviations and legacy aliases —
 * see `CANONICAL_IANA_TIMEZONES`'s own doc comment).
 */
function resolveTimezone(context: RequestContext, override: string | undefined): string {
  if (override === undefined) {
    return context.organizationTimezone
  }
  if (!CANONICAL_IANA_TIMEZONES.has(override)) {
    throw new AppError("VALIDATION", `"${override}" is not a recognized timezone.`)
  }
  return override
}

function assertOverridesReferenceKnownColumns(
  columnCount: number,
  overrides: readonly ColumnOverride[],
): void {
  const outOfRange = overrides.find((o) => o.position < 1 || o.position > columnCount)
  if (outOfRange !== undefined) {
    throw new AppError(
      "VALIDATION",
      `Column override references unknown position ${outOfRange.position}.`,
    )
  }
}
