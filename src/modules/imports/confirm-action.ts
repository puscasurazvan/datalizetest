"use server"

/**
 * The Server Action wrapper for `./internal/confirm.ts` — see
 * `./start-action.ts`'s doc comment for why this file stays this thin and
 * returns `ActionResult<T>` instead of throwing.
 */
import { ZodError } from "zod"

import { createRequestContext } from "@/shared/context/request-context"
import { getJobDispatcher } from "@/modules/jobs"
import { toSafeDto } from "@/shared/errors"
import type { ActionResult } from "@/shared/validation/action-result"
import { formErrorsFromZod } from "@/shared/validation/zod-form"

import { confirmImport, confirmImportInputSchema } from "./internal/confirm"
import type { ConfirmImportResult } from "./internal/confirm"
import { ensureImportTasksRegistered } from "./internal/register-production-tasks"

export async function confirmImportAction(
  input: unknown,
): Promise<ActionResult<ConfirmImportResult>> {
  // See start-action.ts's comment on the same call — idempotent, and
  // required here too since confirmImport dispatches IMPORT_LOAD.
  ensureImportTasksRegistered()

  try {
    const context = await createRequestContext()
    const parsedInput = confirmImportInputSchema.parse(input)
    const data = await confirmImport(context, parsedInput, { jobDispatcher: getJobDispatcher() })
    return { ok: true, data }
  } catch (error) {
    if (error instanceof ZodError) {
      const { formError, fieldErrors } = formErrorsFromZod(error)
      return { ok: false, formError: formError ?? "Check the form and try again.", fieldErrors }
    }
    const safe = toSafeDto(error)
    return { ok: false, formError: safe.message, fieldErrors: {} }
  }
}
