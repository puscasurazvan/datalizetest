// Node runtime Sentry init, loaded from src/instrumentation.ts's `register()`
// when NEXT_RUNTIME === "nodejs". See sentry.edge.config.ts for the edge twin.
import * as Sentry from "@sentry/nextjs"

import { env } from "@/shared/env"
import { scrubSentryBreadcrumb, scrubSentryEvent } from "@/shared/observability/sentry-scrub"

const dsn = env().SENTRY_DSN

// No DSN configured (e.g. local dev) — Sentry.* calls become safe no-ops
// rather than throwing, because no client was ever installed.
if (dsn !== undefined) {
  Sentry.init({
    dsn,
    environment: env().NODE_ENV,
    tracesSampleRate: 0.1,
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubSentryBreadcrumb,
  })
}
