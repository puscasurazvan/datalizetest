/**
 * The read path for the import screen and the Dataset detail banner
 * (docs/decisions/06 #1; CONTEXT.md "Import"). `imports.status` alone
 * cannot tell "waiting to profile" from "waiting to load": both
 * `start.ts` and `recordConfirmedSchema` write `QUEUED`. `getImportView`
 * resolves that ambiguity once, on `confirmedSchema !== null`, into a
 * phase-discriminated `ImportView` — every consumer reads a phase, never
 * re-derives one from status plus a flag.
 */
import { assertCan } from "@/modules/auth/policy"
import { toPolicyContext } from "@/modules/organizations"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

import { parseProposedSchema } from "./schema-types"
import type { ProposedSchema } from "./schema-types"
import { countImportErrorsByCode } from "../repository/import-error-repository"
import { findOpenImportByDatasetId, getImportForContext } from "../repository/import-repository"
import type { ImportRow, ImportStatus } from "../repository/import-repository"

/**
 * `PENDING`/`PROFILING`, and `QUEUED` before confirmation, all collapse
 * into `"profiling"` (H7): none of the three can promise a completion
 * time, so the screen shows one "still reading this file" state rather
 * than a progress bar it cannot back up. `QUEUED` after confirmation
 * collapses into `"loading"` with `RUNNING` the same way.
 */
export type ImportPhase =
  | "profiling"
  | "awaiting_confirmation"
  | "loading"
  | "completed"
  | "failed"
  | "cancelled"

interface ImportViewBase {
  readonly importId: string
  readonly datasetId: string
  readonly originalFilename: string
  readonly createdAt: Date
}

export type ImportView =
  | (ImportViewBase & { readonly phase: "profiling" })
  | (ImportViewBase & {
      readonly phase: "awaiting_confirmation"
      readonly proposedSchema: ProposedSchema
    })
  | (ImportViewBase & { readonly phase: "loading" })
  | (ImportViewBase & {
      readonly phase: "completed"
      /** Every row the file produced, unconditionally (H0) — this is NOT `rowsWithRecordedIssue`'s complement; a row can be in both counts. */
      readonly rowsLoaded: number
      /** A SUBSET of `rowsLoaded` (H0): rows with at least one recorded issue, which still loaded — never call this "rejected". */
      readonly rowsWithRecordedIssue: number
      readonly issueCountsByCode: Record<string, number>
    })
  | (ImportViewBase & {
      readonly phase: "failed"
      readonly errorCode: string | null
      readonly errorMessage: string | null
    })
  | (ImportViewBase & { readonly phase: "cancelled" })

/**
 * Exported for direct unit coverage (read.test.ts) of every
 * status/confirmedSchema combination with no database — the one place
 * this module's phase rule lives, per the module doc above. No `default`
 * case: an `ImportStatus` added to the enum without extending this switch
 * fails `pnpm typecheck`, the same guarantee `statusForErrorCode` uses.
 */
export function phaseForStatus(status: ImportStatus, confirmedSchema: unknown): ImportPhase {
  switch (status) {
    case "PENDING":
    case "PROFILING":
      return "profiling"
    case "QUEUED":
      return confirmedSchema === null ? "profiling" : "loading"
    case "AWAITING_CONFIRMATION":
      return "awaiting_confirmation"
    case "RUNNING":
      return "loading"
    case "COMPLETED":
      return "completed"
    case "FAILED":
      return "failed"
    case "CANCELLED":
      return "cancelled"
  }
}

async function toImportView(context: RequestContext, row: ImportRow): Promise<ImportView> {
  const phase = phaseForStatus(row.status, row.confirmedSchema)
  const base: ImportViewBase = {
    importId: row.id,
    datasetId: row.datasetId,
    originalFilename: row.originalFilename,
    createdAt: row.createdAt,
  }

  switch (phase) {
    case "profiling":
      return { ...base, phase }
    case "loading":
      return { ...base, phase }
    case "cancelled":
      return { ...base, phase }
    case "awaiting_confirmation":
      return { ...base, phase, proposedSchema: parseProposedSchema(row.proposedSchema) }
    case "failed":
      return { ...base, phase, errorCode: row.errorCode, errorMessage: row.errorMessage }
    case "completed": {
      // `markImportCompleted` (the only writer of `status: "COMPLETED"`)
      // always sets both counts together — a COMPLETED row with either
      // still null is a row this module doesn't know how to render
      // honestly, so this throws rather than silently reporting 0 rows
      // loaded (the honesty rule: never render a number the product can't
      // defend, and "0" is itself a defended number here, not a blank).
      if (row.rowsImported === null || row.rowsRejected === null) {
        throw new AppError("VALIDATION", "This completed import has no row counts recorded.", {
          internal: { importId: row.id },
        })
      }
      const issueCountsByCode = await countImportErrorsByCode(context, row.id)
      return {
        ...base,
        phase,
        rowsLoaded: row.rowsImported,
        rowsWithRecordedIssue: row.rowsRejected,
        issueCountsByCode,
      }
    }
  }
}

/**
 * The import screen's one read. `getImportForContext` throws `NOT_FOUND`
 * for a foreign organization's import id (its own `scopedWhere`) before
 * `assertCan` is even relevant to the result — a cross-tenant request
 * never learns whether the resource exists (src/shared/CLAUDE.md).
 * `dataset:read` (plan decision 2, over an earlier draft's
 * `dataset:create`): a viewer must be able to watch an import they
 * cannot start.
 */
export async function getImportView(
  context: RequestContext,
  importId: string,
): Promise<ImportView> {
  assertCan(toPolicyContext(context), "dataset:read")
  const row = await getImportForContext(context, importId)
  return toImportView(context, row)
}

/**
 * The Dataset detail page's open-import banner (H4, H5, H7): the one thing
 * that makes an import stuck mid-pipeline, or a FAILED profile that never
 * got a confirm screen, reachable again. `undefined` only when the
 * dataset's latest import is COMPLETED or CANCELLED (nothing to surface) —
 * FAILED counts as "open" here, deliberately: H5's whole point is that a
 * profile crash under `InlineDispatcher` never navigates the user to
 * `/imports/[id]` at all, so this banner is the only path back to it.
 */
export async function findOpenImportForDataset(
  context: RequestContext,
  datasetId: string,
): Promise<ImportView | undefined> {
  assertCan(toPolicyContext(context), "dataset:read")
  const row = await findOpenImportByDatasetId(context, datasetId)
  if (row === undefined) return undefined
  if (row.status === "COMPLETED" || row.status === "CANCELLED") return undefined
  return toImportView(context, row)
}
