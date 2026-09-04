/**
 * The one error type Datalize services throw. Every code path that a client
 * (browser, AI tool caller) can observe funnels through `AppError` and is
 * rendered to a `SafeErrorDto` via `toSafeDto` before it leaves the server —
 * src/shared/CLAUDE.md: "Error DTOs returned to the client must never
 * carry: a physical table name, a raw dataset/row value, a credential, or a
 * stack trace."
 */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SCHEMA_INCOMPATIBLE"
  | "QUERY_TIMEOUT"
  | "CONCURRENCY_LIMIT"
  | "IMPORT_LIMIT_EXCEEDED"
  | "VALIDATION"
  | "CONFLICT"

export interface AppErrorInit {
  /** The underlying error, if any. Chained via the standard `Error.cause` —
   * never read by `toSafeDto`, so it is safe to pass a raw driver/library
   * error here (e.g. a pg error whose message names a physical table). */
  cause?: unknown
  /**
   * Server-only debugging context: physical table names, raw dataset/row
   * values, anything unsafe to return to a client. Available to logging and
   * Sentry breadcrumbs written from the `catch` block, but `toSafeDto` never
   * reads it. Never put unsafe data in `message` instead — `message` is the
   * safe, user-facing string and is the only thing `toSafeDto` copies out.
   */
  internal?: Record<string, unknown>
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly internal: Record<string, unknown> | undefined

  constructor(code: AppErrorCode, message: string, init: AppErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = "AppError"
    this.code = code
    this.internal = init.internal
  }
}

/** `toSafeDto` falls back to this code for anything that is not an `AppError` —
 * an unclassified failure a client can't act on, only observe as generic. */
export type SafeErrorCode = AppErrorCode | "INTERNAL"

export interface SafeErrorDto {
  code: SafeErrorCode
  message: string
}

/**
 * Render any thrown value into the DTO shape that is safe to send to a
 * client. Reads exactly `error.code` and `error.message` off an `AppError`
 * — never `.cause`, `.internal`, or `.stack` — so a physical table name or
 * raw row value attached to either of the first two, or a stack trace on
 * any Error, can never reach the wire. Anything that is not an `AppError`
 * (an unexpected driver/library throw) is masked entirely behind a generic
 * `INTERNAL` message: its own `.message` is not trusted either, since it
 * can just as easily be a raw pg error naming a physical table.
 */
export function toSafeDto(error: unknown): SafeErrorDto {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message }
  }
  return { code: "INTERNAL", message: "An unexpected error occurred." }
}

/**
 * The one HTTP-status mapping for a `SafeErrorDto` code, shared by every
 * Route Handler's `catch` block. No `default` case: adding an `AppErrorCode`
 * without extending this switch fails `pnpm typecheck`, not a review.
 */
export function statusForErrorCode(code: SafeErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401
    case "FORBIDDEN":
      return 403
    case "NOT_FOUND":
      return 404
    case "VALIDATION":
      return 400
    case "CONFLICT":
      return 409
    case "SCHEMA_INCOMPATIBLE":
    case "QUERY_TIMEOUT":
    case "CONCURRENCY_LIMIT":
    case "IMPORT_LIMIT_EXCEEDED":
      return 422
    case "INTERNAL":
      return 500
  }
}
