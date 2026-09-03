/**
 * Wires `IMPORT_PROFILE`/`IMPORT_LOAD` to real production dependencies and
 * registers them with the shared `jobRegistry` (src/modules/jobs/index.ts) —
 * what makes `InlineDispatcher` able to run them at all.
 *
 * Confirmed defect this fixes: nothing under `src/` ever called
 * `registerImportTasks` outside a test. `getJobDispatcher()` returns
 * `InlineDispatcher(jobRegistry)` whenever `TRIGGER_SECRET_KEY` is unset
 * (true for `.env.local`'s blank value, true for CI) — src/modules/jobs/index.ts's
 * own doc — and an empty registry means `enqueue("IMPORT_PROFILE", ...)`
 * throws `No task registered for job type "IMPORT_PROFILE"` the moment a
 * real upload calls `startImportAction`. The import pipeline could not run
 * in any environment that falls back to the inline dispatcher — which,
 * until Trigger.dev is actually configured in production, is every one.
 *
 * `ensureImportTasksRegistered` is called from both Server Actions in this
 * module (`../start-action.ts`, `../confirm-action.ts`) rather than from
 * `src/instrumentation.ts`: instrumentation's `register()` runs in a
 * separate bundle Next.js constructs for the instrumentation hook, and
 * nothing here can verify from outside a running Next.js process whether a
 * module-level singleton set there is actually the same `jobRegistry`
 * instance a Server Action's module graph sees — so this calls it from
 * exactly the modules that also call `getJobDispatcher()`, guaranteeing
 * they share an import graph. It is idempotent and cheap to call on every
 * action invocation.
 *
 * `trigger/import-profile.ts` and `trigger/import-load.ts` build their own
 * `run` from `productionImportTaskDeps()` below too, so the in-process and
 * Trigger.dev-deployed paths can never wire up different dependencies.
 */
import { PostgresAnalyticalStore } from "@/modules/analytical-store"
import { jobRegistry } from "@/modules/jobs"
import { getStorageProvider } from "@/modules/storage"

import { createContextForImportJob } from "./job-context"
import { registerImportTasks } from "./register-tasks"
import type { ImportTaskDeps } from "./register-tasks"

// One store per process, not one per call: `PostgresAnalyticalStore` holds
// no connection itself (it borrows `importPool`/`db` per call), so reusing
// the instance is purely to avoid a pointless allocation on every action
// invocation and every task run.
let analyticalStore: PostgresAnalyticalStore | undefined

export function productionImportTaskDeps(): ImportTaskDeps {
  analyticalStore ??= new PostgresAnalyticalStore()
  return {
    storage: getStorageProvider(),
    analyticalStore,
    createContextForImport: createContextForImportJob,
  }
}

/**
 * Registers the real task functions with `jobRegistry` exactly once per
 * process. Checked against the registry itself, not a module-level
 * boolean: a boolean can silently reset across a dev-server hot reload in
 * a way the registry's own contents cannot, and re-registering is itself
 * harmless (`JobRegistry.register` just overwrites the same key) — this
 * guard exists only to skip the redundant work, not for correctness.
 */
export function ensureImportTasksRegistered(): void {
  if (jobRegistry.get("IMPORT_PROFILE") !== undefined) return
  registerImportTasks(jobRegistry, productionImportTaskDeps())
}
