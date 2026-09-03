import { DatabaseError } from "pg"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { AppError } from "@/shared/errors"

// Type-only — erased at build time, so this does not execute `./execute-query`
// (and so `@/db/analytical`) the way the `await import(...)` below does.
import type { toExecutionError as ToExecutionError } from "./execute-query"

// `./execute-query` statically imports `@/db/analytical`, which constructs
// `analyticalPool` at module load — `env()` at module scope — so loading it
// at all needs a valid-shaped environment, even though `toExecutionError`
// itself touches no pool. Same fix as `src/db/analytical.test.ts`: stub the
// env, then import dynamically so the stub is in place before the module
// (and its `@/db/analytical` dependency) ever evaluates. Imported once, in
// `beforeAll`, and never via `vi.resetModules()` between tests: resetting
// the module registry mid-file would reload `@/shared/errors` a second
// time, minting a second, distinct `AppError` class that this file's own
// top-level import — bound to the first instance — would then fail
// `instanceof` against.
function stubDatabaseEnv(): void {
  vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db")
  vi.stubEnv("ANALYTICAL_DATABASE_URL", "postgresql://user:pass@localhost:5432/db")
  vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(32))
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000")
}

let toExecutionError: typeof ToExecutionError

beforeAll(async () => {
  stubDatabaseEnv()
  ;({ toExecutionError } = await import("./execute-query"))
})

/**
 * `DatabaseError`'s constructor doesn't take a SQLSTATE — the driver sets
 * `.code` after parsing the server's ErrorResponse — so tests do the same:
 * construct, then assign. `code` is a plain mutable field, no cast needed.
 */
function fakeDatabaseError(code: string, message = "simulated failure"): DatabaseError {
  const error = new DatabaseError(message, 0, "error")
  error.code = code
  return error
}

/** Narrows via `instanceof`, never a cast, so the test can read `.code`. */
function expectAppError(error: Error): AppError {
  if (!(error instanceof AppError)) {
    throw new Error(`expected an AppError, got: ${error.constructor.name}: ${error.message}`)
  }
  return error
}

describe("toExecutionError", () => {
  it("maps 57014 (query_canceled) to QUERY_TIMEOUT", () => {
    const cause = fakeDatabaseError("57014")
    const mapped = expectAppError(toExecutionError(cause))
    expect(mapped.code).toBe("QUERY_TIMEOUT")
    expect(mapped.cause).toBe(cause)
  })

  it("maps the 22* class (e.g. 22007, invalid_datetime_format) to VALIDATION (G4)", () => {
    const cause = fakeDatabaseError("22007")
    const mapped = expectAppError(toExecutionError(cause))
    expect(mapped.code).toBe("VALIDATION")
    expect(mapped.cause).toBe(cause)
  })

  it("maps every code in the 22* class, not just 22007", () => {
    for (const code of ["22001", "22003", "22P02"]) {
      expect(expectAppError(toExecutionError(fakeDatabaseError(code))).code).toBe("VALIDATION")
    }
  })

  it("rethrows an unrecognized SQLSTATE as a plain, masked Error — never an AppError", () => {
    // The message is deliberately shaped like a real pg error naming a
    // physical table, to prove it never survives into the thrown error.
    const cause = fakeDatabaseError("42P01", 'relation "analytical.dv_deadbeef" does not exist')
    const mapped = toExecutionError(cause)

    expect(mapped).not.toBeInstanceOf(AppError)
    expect(mapped.cause).toBe(cause)
    expect(mapped.message).not.toContain("dv_deadbeef")
    expect(mapped.message).not.toContain("analytical")
  })

  it("masks a non-DatabaseError failure the same way, rather than trusting its .message", () => {
    const cause = new Error('relation "analytical.dv_deadbeef" does not exist')
    const mapped = toExecutionError(cause)

    expect(mapped).not.toBeInstanceOf(AppError)
    expect(mapped.cause).toBe(cause)
    expect(mapped.message).not.toContain("dv_deadbeef")
  })
})
