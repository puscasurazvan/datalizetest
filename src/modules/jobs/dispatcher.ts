import { z } from "zod"

/**
 * The `JobDispatcher` seam (adr/0001, docs/decisions/06 "Import pipeline").
 *
 * Trigger.dev is the job runtime, but it has no runtime in CI or integration
 * tests, so every job must also be runnable in-process. `JobDispatcher` is
 * the interface both `TriggerDevDispatcher` and `InlineDispatcher` implement;
 * callers depend on this file, never on either implementation directly.
 *
 * Payload schemas are declared here, narrowly, and are the only source of
 * truth for what a job payload may contain: an internal ID, never a URL, a
 * file, or a credential (jobs/CLAUDE.md). Every job re-checks organization
 * ownership and state at execution time — the payload is not a trusted
 * snapshot of either.
 */

const importJobPayload = z.strictObject({
  importId: z.string(),
})

export const jobPayloadSchemas = {
  IMPORT_PROFILE: importJobPayload,
  IMPORT_LOAD: importJobPayload,
} as const

export type JobType = keyof typeof jobPayloadSchemas

export type JobPayload<T extends JobType> = z.infer<(typeof jobPayloadSchemas)[T]>

/**
 * What enqueueing returns. `runId` identifies the run with whichever backend
 * actually dispatched it (a Trigger.dev run ID, or a locally generated ID for
 * the inline dispatcher) — it is not the durable job record's ID, which lives
 * in PostgreSQL and is written before dispatch (jobs/CLAUDE.md "Ordering").
 */
export type JobReference = {
  runId: string
}

export type EnqueueOptions = {
  /**
   * Forwarded to the underlying backend so a retried caller (a double-submit,
   * a retried Server Action) cannot enqueue the same work twice. Callers
   * derive this themselves — see docs/decisions/06 #7 for the import case.
   */
  idempotencyKey?: string
}

export interface JobDispatcher {
  enqueue<T extends JobType>(
    type: T,
    payload: JobPayload<T>,
    options?: EnqueueOptions,
  ): Promise<JobReference>
}
