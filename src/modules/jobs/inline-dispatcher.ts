import { randomUUID } from "node:crypto"

import {
  jobPayloadSchemas,
  type JobDispatcher,
  type JobPayload,
  type JobReference,
  type JobType,
} from "./dispatcher"
import type { JobRegistry } from "./registry"

/**
 * Runs the registered task function in-process and awaits it. This is what
 * tests and CI use, since there is no Trigger.dev runtime there (jobs/CLAUDE.md).
 */
export class InlineDispatcher implements JobDispatcher {
  constructor(private readonly registry: JobRegistry) {}

  async enqueue<T extends JobType>(type: T, payload: JobPayload<T>): Promise<JobReference> {
    jobPayloadSchemas[type].parse(payload)

    const task = this.registry.get(type)
    if (!task) {
      throw new Error(`No task registered for job type "${type}"`)
    }

    await task(payload)

    return { runId: randomUUID() }
  }
}
