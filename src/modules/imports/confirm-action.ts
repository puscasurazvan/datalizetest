"use server"

/**
 * The Server Action wrapper for `./internal/confirm.ts` — see
 * `./start-action.ts`'s doc comment for why this file stays this thin.
 */
import { createRequestContext } from "@/shared/context/request-context"
import { getJobDispatcher } from "@/modules/jobs"

import { confirmImport, confirmImportInputSchema } from "./internal/confirm"
import type { ConfirmImportResult } from "./internal/confirm"
import { ensureImportTasksRegistered } from "./internal/register-production-tasks"

export async function confirmImportAction(input: unknown): Promise<ConfirmImportResult> {
  // See start-action.ts's comment on the same call — idempotent, and
  // required here too since confirmImport dispatches IMPORT_LOAD.
  ensureImportTasksRegistered()

  const context = await createRequestContext()
  const parsedInput = confirmImportInputSchema.parse(input)
  return confirmImport(context, parsedInput, { jobDispatcher: getJobDispatcher() })
}
