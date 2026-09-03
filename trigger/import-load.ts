/**
 * The `import.load` Trigger.dev task (docs/decisions/06 #1, #16). See
 * `./import-profile.ts`'s doc comment for why `runLoad` backs both the
 * `jobRegistry` registration and this task's own `run`, and for why
 * dependencies come from `productionImportTaskDeps()`.
 *
 * `maxDuration: 900` (15 min) is deliberately double the import pool's own
 * 10-minute `IMPORT_STATEMENT_TIMEOUT_MS` (docs/decisions/06 #16): headroom
 * for Postgres to enforce its own cutoff and for this task to catch that
 * error and record the failure, rather than Trigger.dev killing the task
 * mid-cleanup.
 */
import { task } from "@trigger.dev/sdk/v3"

import { loadImport, productionImportTaskDeps } from "@/modules/imports"
import { jobRegistry } from "@/modules/jobs"
import type { JobPayload } from "@/modules/jobs"

async function runLoad(payload: JobPayload<"IMPORT_LOAD">): Promise<void> {
  const deps = productionImportTaskDeps()
  const context = await deps.createContextForImport(payload.importId)
  await loadImport(context, payload.importId, {
    storage: deps.storage,
    analyticalStore: deps.analyticalStore,
  })
}

jobRegistry.register("IMPORT_LOAD", runLoad)

export const importLoadTask = task({
  id: "IMPORT_LOAD",
  maxDuration: 900,
  machine: { preset: "small-1x" },
  run: runLoad,
})
