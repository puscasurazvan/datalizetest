/**
 * Wires the pure `scrub()` function into Sentry's event/breadcrumb shapes.
 * Shared by sentry.server.config.ts and sentry.edge.config.ts so the two
 * runtimes can't drift on what gets redacted.
 *
 * Scope: this scrubs the fields most likely to carry customer data or
 * credentials — message text, exception messages, breadcrumb data, `extra`,
 * and request body/headers/cookies. It deliberately leaves `contexts` (SDK-
 * populated runtime/OS/device info) and `tags` (short labels this app sets
 * itself) untouched — see scrub.ts's header for the "JSON-shaped payload"
 * scoping this relies on.
 */
import type { Breadcrumb, ErrorEvent, Exception, RequestEventData } from "@sentry/nextjs"

import { scrub } from "./scrub"

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
])

function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}

  for (const key of Object.keys(headers)) {
    const value = headers[key]
    if (value === undefined) continue
    result[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase())
      ? "[REDACTED:credential]"
      : scrub(value)
  }

  return result
}

function scrubExceptionValue(value: Exception): Exception {
  const message = value.value
  if (message === undefined) return value
  return { ...value, value: scrub(message) }
}

function scrubException(exception: { values?: Exception[] }): { values?: Exception[] } {
  const values = exception.values
  if (values === undefined) return exception
  return { ...exception, values: values.map(scrubExceptionValue) }
}

function scrubRequest(request: RequestEventData): RequestEventData {
  const data = request.data
  const headers = request.headers
  const cookies = request.cookies

  return {
    ...request,
    ...(data !== undefined ? { data: scrub(data) } : {}),
    ...(headers !== undefined ? { headers: scrubHeaders(headers) } : {}),
    ...(cookies !== undefined ? { cookies: {} } : {}),
  }
}

/** `beforeBreadcrumb` for Sentry.init: scrubs a breadcrumb's message and data. */
export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const message = breadcrumb.message
  const data = breadcrumb.data

  return {
    ...breadcrumb,
    ...(message !== undefined ? { message: scrub(message) } : {}),
    ...(data !== undefined ? { data: scrub(data) } : {}),
  }
}

/** `beforeSend` for Sentry.init: scrubs an event's message, exception, breadcrumbs, extra, and request. */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  const message = event.message
  const exception = event.exception
  const breadcrumbs = event.breadcrumbs
  const extra = event.extra
  const request = event.request

  return {
    ...event,
    ...(message !== undefined ? { message: scrub(message) } : {}),
    ...(exception !== undefined ? { exception: scrubException(exception) } : {}),
    ...(breadcrumbs !== undefined ? { breadcrumbs: breadcrumbs.map(scrubSentryBreadcrumb) } : {}),
    ...(extra !== undefined ? { extra: scrub(extra) } : {}),
    ...(request !== undefined ? { request: scrubRequest(request) } : {}),
  }
}
