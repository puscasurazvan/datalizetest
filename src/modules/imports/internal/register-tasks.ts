/**
 * Registers `IMPORT_PROFILE` and `IMPORT_LOAD` with a `JobRegistry`
 * (src/modules/jobs/registry.ts) — what makes `InlineDispatcher` able to
 * run them in tests and CI (jobs/CLAUDE.md), and what `trigger/**`'s task
 * definitions also call from their own `run` (see `../../CLAUDE.md`-style
 * doc atop `trigger/import-profile.ts` for why the same run function backs
 * both).
 *
 * `deps.createContextForImport` is the one seam production and tests
 * differ on — see `./job-context.ts`'s doc for why a `RequestContext`
 * cannot be constructed inline here.
 */
import type { JobRegistry } from "@/modules/jobs"
import type { AnalyticalStore } from "@/modules/analytical-store"
import type { StorageProvider } from "@/modules/storage"

import type { CreateContextForImport } from "./job-context"
import { loadImport } from "./load"
import { profileImport } from "./profile"

export type ImportTaskDeps = {
  readonly storage: StorageProvider
  readonly analyticalStore: AnalyticalStore
  readonly createContextForImport: CreateContextForImport
}

export function registerImportTasks(registry: JobRegistry, deps: ImportTaskDeps): void {
  registry.register("IMPORT_PROFILE", async (payload) => {
    const context = await deps.createContextForImport(payload.importId)
    await profileImport(context, payload.importId, { storage: deps.storage })
  })

  registry.register("IMPORT_LOAD", async (payload) => {
    const context = await deps.createContextForImport(payload.importId)
    await loadImport(context, payload.importId, {
      storage: deps.storage,
      analyticalStore: deps.analyticalStore,
    })
  })
}
