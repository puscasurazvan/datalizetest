import { randomUUID } from "node:crypto"

import { scrub } from "./scrub"

export type LogLevel = "debug" | "info" | "warn" | "error"
export type LogFields = Record<string, unknown>

export interface Logger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
}

interface LogLine {
  level: LogLevel
  time: string
  requestId: string
  message: string
  fields: Record<string, unknown>
}

function emit(line: LogLine): void {
  // This is the single place in src/ permitted to write to stdout: every log
  // line is JSON, and every payload above has already passed through scrub().
  // Everything else must log through createLogger(), not console.*.
  // oxlint-disable-next-line no-console
  console.log(JSON.stringify(line))
}

function write(requestId: string, level: LogLevel, message: string, fields?: LogFields): void {
  emit({
    level,
    time: new Date().toISOString(),
    requestId,
    message: scrub(message),
    fields: scrub(fields ?? {}),
  })
}

/**
 * A structured (JSON-lines) logger. Every payload runs through `scrub()` before
 * it is written, and every line carries the request id it was created with —
 * pass the id from the request context; omit it for a background/job context
 * and one is generated.
 */
export function createLogger(requestId: string = randomUUID()): Logger {
  return {
    debug: (message, fields) => write(requestId, "debug", message, fields),
    info: (message, fields) => write(requestId, "info", message, fields),
    warn: (message, fields) => write(requestId, "warn", message, fields),
    error: (message, fields) => write(requestId, "error", message, fields),
  }
}
