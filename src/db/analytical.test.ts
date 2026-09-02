import { afterEach, describe, expect, it, vi } from "vitest"

// See src/db/client.test.ts for why emitting a synthetic 'error' event is a
// faithful, DB-free reproduction of pg-pool's idle-client failure mode.
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

describe("analyticalPool", () => {
  it("has an 'error' listener so an idle pooled client failing does not crash the process", async () => {
    stubDatabaseEnv()
    const { analyticalPool } = await import("./analytical")

    expect(() => analyticalPool.emit("error", new Error("connection terminated"))).not.toThrow()
  })
})
