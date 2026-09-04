"use server"

/**
 * The Server Action wrapper for `./internal/start.ts`. Deliberately thin —
 * a "use server" file's exports must all be async functions, and
 * `createRequestContext()` reads `headers()`, so it cannot run outside a
 * real request. `./internal/start.ts`'s `startImport` takes the context
 * as a parameter instead, which is what makes it directly unit/integration
 * testable without a request at all.
 *
 * Returns `ActionResult<T>` (plan decision 4) rather than throwing: the
 * client calls this directly from a `useState` union
 * (`import-sample-buttons.tsx`'s shape), never `useActionState` +
 * `FormData` — both `startImport`/`confirmImport` already take a
 * structured object, and `columnOverrides` has no good FormData shape to
 * serialize into. The schema parse runs INSIDE the `try` below — outside
 * it, a malformed `input` throws a raw `ZodError` straight past this
 * wrapper instead of becoming a field error the caller can render.
 */
import { ZodError } from "zod"

import { createRequestContext } from "@/shared/context/request-context"
import { getStorageProvider } from "@/modules/storage"
import { getJobDispatcher } from "@/modules/jobs"
import { toSafeDto } from "@/shared/errors"
import type { ActionResult } from "@/shared/validation/action-result"
import { formErrorsFromZod } from "@/shared/validation/zod-form"

import { ensureImportTasksRegistered } from "./internal/register-production-tasks"
import { startImport, startImportInputSchema } from "./internal/start"
import type { StartImportResult } from "./internal/start"

export async function startImportAction(input: unknown): Promise<ActionResult<StartImportResult>> {
  // Idempotent — see register-production-tasks.ts's doc for why this is
  // called here rather than from src/instrumentation.ts. Without it,
  // `getJobDispatcher()`'s InlineDispatcher (the only dispatcher whenever
  // TRIGGER_SECRET_KEY is unset) has no task registered for "IMPORT_PROFILE"
  // and this action's own `enqueue` call below throws.
  ensureImportTasksRegistered()

  try {
    const context = await createRequestContext()
    const parsedInput = startImportInputSchema.parse(input)
    const data = await startImport(context, parsedInput, {
      storage: getStorageProvider(),
      jobDispatcher: getJobDispatcher(),
    })
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
