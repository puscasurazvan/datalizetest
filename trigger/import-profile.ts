/**
 * The `import.profile` Trigger.dev task (docs/decisions/06 #1, adr/0001).
 * `runProfile` is registered with `jobRegistry` (what `InlineDispatcher`
 * runs in tests/CI, jobs/CLAUDE.md) AND passed as this task's own `run` —
 * one function backs both runtimes, so they execute identical business
 * logic (src/modules/jobs/registry.ts's `TaskFunction` doc).
 *
 * The task id is the literal string `"IMPORT_PROFILE"` — `TriggerDevDispatcher`
 * (src/modules/jobs/trigger-dispatcher.ts) calls `tasks.trigger(type, ...)`
 * with `type` being the `JobType` literal, which only reaches this task if
 * the two ids match exactly (that file's own doc comment names this as
 * "the one place to reconcile when those tasks land").
 *
 * Dependencies come from `productionImportTaskDeps()`
 * (src/modules/imports/internal/register-production-tasks.ts) — the same
 * function the Next.js server process's Server Actions call before
 * dispatching, so the in-process (`InlineDispatcher`) and deployed
 * (Trigger.dev) runtimes can never wire up different storage, analytical
 * store, or `RequestContext` construction.
 */
import { task } from "@trigger.dev/sdk/v3"

import { profileImport, productionImportTaskDeps } from "@/modules/imports"
import { jobRegistry } from "@/modules/jobs"
import type { JobPayload } from "@/modules/jobs"

async function runProfile(payload: JobPayload<"IMPORT_PROFILE">): Promise<void> {
  const deps = productionImportTaskDeps()
  const context = await deps.createContextForImport(payload.importId)
  await profileImport(context, payload.importId, { storage: deps.storage })
}

jobRegistry.register("IMPORT_PROFILE", runProfile)

export const importProfileTask = task({
  id: "IMPORT_PROFILE",
  // Well above decisions/06 #15's <=90s pass bar for a 50 MB / 1M row
  // profile pass — headroom, not a target (mirrors #16's reasoning for
  // import.load's own maxDuration).
  maxDuration: 300,
  machine: { preset: "small-1x" },
  run: runProfile,
})
