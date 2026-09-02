/**
 * Public surface of src/modules/jobs. Other modules enqueue jobs through
 * `getJobDispatcher()` and register task functions through `jobRegistry`;
 * they never import `./inline-dispatcher` or `./trigger-dispatcher` directly.
 */
import { env } from "@/shared/env"

import type { JobDispatcher } from "./dispatcher"
import { InlineDispatcher } from "./inline-dispatcher"
import { JobRegistry } from "./registry"
import { TriggerDevDispatcher } from "./trigger-dispatcher"

export type { EnqueueOptions, JobDispatcher, JobPayload, JobReference, JobType } from "./dispatcher"
export { jobPayloadSchemas } from "./dispatcher"
export type { TaskFunction } from "./registry"
export { JobRegistry } from "./registry"

/**
 * The one registration point both dispatchers read from. Real task modules
 * (Slice 1) register their run function here at import time.
 */
export const jobRegistry = new JobRegistry()

/**
 * Selects the dispatcher implementation. Env-driven, not environment-driven:
 * when `TRIGGER_SECRET_KEY` is absent (CI, integration tests, local dev
 * without Trigger.dev configured) jobs run in-process instead.
 */
function selectJobDispatcher(triggerSecretKey: string | undefined): JobDispatcher {
  if (triggerSecretKey === undefined) {
    return new InlineDispatcher(jobRegistry)
  }

  return new TriggerDevDispatcher({ accessToken: triggerSecretKey })
}

let dispatcher: JobDispatcher | undefined

/**
 * Lazily selects and memoizes the dispatcher on first use, so importing this
 * module never reads `process.env` (and never throws `EnvironmentError`) by
 * itself — only calling `getJobDispatcher()` does. Always returns the
 * `JobDispatcher` interface, never a concrete implementation type — the two
 * implementations have different constructor and `enqueue` signatures, so an
 * inferred union of them would not expose one callable `enqueue`.
 */
export function getJobDispatcher(): JobDispatcher {
  dispatcher ??= selectJobDispatcher(env().TRIGGER_SECRET_KEY)
  return dispatcher
}
