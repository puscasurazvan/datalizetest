"use server"

/**
 * The Server Action wrapper for `./internal/start.ts`. Deliberately thin —
 * a "use server" file's exports must all be async functions, and
 * `createRequestContext()` reads `headers()`, so it cannot run outside a
 * real request. `./internal/start.ts`'s `startImport` takes the context
 * as a parameter instead, which is what makes it directly unit/integration
 * testable without a request at all.
 */
import { createRequestContext } from "@/shared/context/request-context"
import { getStorageProvider } from "@/modules/storage"
import { getJobDispatcher } from "@/modules/jobs"

import { ensureImportTasksRegistered } from "./internal/register-production-tasks"
import { startImport, startImportInputSchema } from "./internal/start"
import type { StartImportResult } from "./internal/start"

export async function startImportAction(input: unknown): Promise<StartImportResult> {
  // Idempotent — see register-production-tasks.ts's doc for why this is
  // called here rather than from src/instrumentation.ts. Without it,
  // `getJobDispatcher()`'s InlineDispatcher (the only dispatcher whenever
  // TRIGGER_SECRET_KEY is unset) has no task registered for "IMPORT_PROFILE"
  // and this action's own `enqueue` call below throws.
  ensureImportTasksRegistered()

  const context = await createRequestContext()
  const parsedInput = startImportInputSchema.parse(input)
  return startImport(context, parsedInput, {
    storage: getStorageProvider(),
    jobDispatcher: getJobDispatcher(),
  })
}
