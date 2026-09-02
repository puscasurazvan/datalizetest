import { configure, tasks } from "@trigger.dev/sdk/v3"

import {
  jobPayloadSchemas,
  type EnqueueOptions,
  type JobDispatcher,
  type JobPayload,
  type JobReference,
  type JobType,
} from "./dispatcher"

export type TriggerDevDispatcherConfig = {
  accessToken: string
}

/**
 * The Trigger.dev implementation. Triggers by task ID string rather than by
 * importing a task's module, so this file never has to import the real task
 * definitions (written in Slice 1) into whatever bundle constructs it. The
 * `JobType` literal doubles as that task ID for now; docs/decisions/06 names
 * the real tasks `import.profile` and `import.load` (dotted, lowercase), so
 * this call is the one place to reconcile when those tasks land.
 */
export class TriggerDevDispatcher implements JobDispatcher {
  constructor(config: TriggerDevDispatcherConfig) {
    // `env.ts` is the only place `process.env` is read; the SDK's own
    // fallback to `process.env.TRIGGER_SECRET_KEY` is bypassed by always
    // configuring it explicitly here.
    configure({ accessToken: config.accessToken })
  }

  async enqueue<T extends JobType>(
    type: T,
    payload: JobPayload<T>,
    options?: EnqueueOptions,
  ): Promise<JobReference> {
    jobPayloadSchemas[type].parse(payload)

    const handle = await tasks.trigger(
      type,
      payload,
      options?.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {},
    )

    return { runId: handle.id }
  }
}
