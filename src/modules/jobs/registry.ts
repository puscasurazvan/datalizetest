import { jobPayloadSchemas, type JobPayload, type JobType } from "./dispatcher"

/**
 * A task function: the code a job type actually runs. Both dispatchers read
 * from a `JobRegistry` — `InlineDispatcher` calls the function directly;
 * a Trigger.dev task definition (written when the real import tasks land in
 * Slice 1) calls the same function from its `run` body, so in-process tests
 * and the real runtime execute identical business logic.
 */
export type TaskFunction<T extends JobType> = (payload: JobPayload<T>) => Promise<void>

export class JobRegistry {
  /**
   * Stored type-erased to `unknown`, since a single `Map` cannot correlate a
   * generic key's type parameter to a per-key value type without a type
   * assertion. `register` re-narrows `unknown` back to `JobPayload<T>` the
   * only sound way possible: by actually validating it against that job
   * type's schema.
   */
  private readonly tasks = new Map<JobType, (payload: unknown) => Promise<void>>()

  register<T extends JobType>(type: T, task: TaskFunction<T>): void {
    this.tasks.set(type, async (payload) => {
      const parsed = jobPayloadSchemas[type].parse(payload)
      await task(parsed)
    })
  }

  get<T extends JobType>(type: T): TaskFunction<T> | undefined {
    return this.tasks.get(type)
  }
}
