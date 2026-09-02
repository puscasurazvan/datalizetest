import * as Sentry from "@sentry/nextjs"

/**
 * Next.js instrumentation hook: runs once per server instance, before any
 * request is handled. `NEXT_RUNTIME` is read directly rather than through
 * `env()` — it is a runtime marker Next.js injects to select which config to
 * load ("nodejs" | "edge"), not application configuration, and this is the
 * exact conditional-import shape Next.js's own instrumentation contract
 * requires (see node_modules/next/dist/docs/.../instrumentation.md).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config")
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config")
  }
}

// Routes server errors Next.js captures itself (Server Components, Route
// Handlers, Server Actions) into Sentry — through the same scrubbed pipeline
// `Sentry.init`'s `beforeSend` above installs, since it runs on the client
// `register()` already initialised.
export const onRequestError = Sentry.captureRequestError
