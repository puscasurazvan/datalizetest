import { afterEach, describe, expect, it, vi } from "vitest"

// node-postgres's Pool is an EventEmitter, and pg-pool emits `'error'` on the
// pool itself when an *idle* pooled client fails (a Postgres restart,
// `pg_terminate_backend`, a proxy dropping an idle connection —
// node_modules/pg-pool/index.js `makeIdleListener`). An EventEmitter with no
// `'error'` listener throws synchronously out of `emit()` for that event, so
// this reproduces "unhandled 'error' event -> uncaught exception" without
// needing a real database: no listener means `emit` throws; the fix's
// listener means it does not.
function stubDatabaseEnv(): void {
  vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db")
  vi.stubEnv("ANALYTICAL_DATABASE_URL", "postgresql://user:pass@localhost:5432/db")
  vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(32))
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("applicationPool", () => {
  it("has an 'error' listener so an idle pooled client failing does not crash the process", async () => {
    stubDatabaseEnv()
    const { applicationPool } = await import("./client")

    expect(() => applicationPool.emit("error", new Error("connection terminated"))).not.toThrow()
  })
})
