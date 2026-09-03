import { describe, expect, it } from "vitest"

import type { SafeErrorCode } from "./index"
import { AppError, statusForErrorCode, toSafeDto } from "./index"

describe("toSafeDto", () => {
  it("never leaks a physical table name, raw row data, or a stack trace", () => {
    // Realistic shape of the leak this guards against: a low-level pg error
    // whose *message* names the physical table, chained as `cause`, plus a
    // raw CSV row an import handler attached for its own server-side logging.
    const causeError = new Error('relation "analytical.dv_abc123" does not exist')
    const error = new AppError("NOT_FOUND", "Dataset version not found.", {
      cause: causeError,
      internal: {
        physicalTable: "analytical.dv_abc123",
        row: { amount: "$1,234.56", email: "customer@example.com" },
      },
    })

    const dto = toSafeDto(error)
    const serialized = JSON.stringify(dto)

    expect(dto).toEqual({ code: "NOT_FOUND", message: "Dataset version not found." })
    expect(serialized).not.toContain("analytical.dv_abc123")
    expect(serialized).not.toContain("1,234.56")
    expect(serialized).not.toContain("customer@example.com")
    expect(dto).not.toHaveProperty("stack")
    expect(dto).not.toHaveProperty("cause")
    expect(dto).not.toHaveProperty("internal")
  })

  it("masks an error that is not an AppError as a generic internal error", () => {
    // A raw error escaping a repository/store call — its own .message is not
    // trusted either, since it can just as easily name a physical table.
    const raw = new Error('relation "analytical.dv_xyz789" does not exist')
    raw.stack = 'Error: relation "analytical.dv_xyz789" does not exist\n    at Object.<anonymous>'

    const dto = toSafeDto(raw)

    expect(dto.code).toBe("INTERNAL")
    expect(dto.message).not.toContain("analytical.dv_xyz789")
    const serialized = JSON.stringify(dto)
    expect(serialized).not.toContain("analytical.dv_xyz789")
    expect(dto).not.toHaveProperty("stack")
  })

  it("carries every declared AppError code through unchanged", () => {
    const codes = [
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NOT_FOUND",
      "SCHEMA_INCOMPATIBLE",
      "QUERY_TIMEOUT",
      "CONCURRENCY_LIMIT",
      "IMPORT_LIMIT_EXCEEDED",
      "VALIDATION",
    ] as const

    for (const code of codes) {
      expect(toSafeDto(new AppError(code, "a safe, user-facing message"))).toEqual({
        code,
        message: "a safe, user-facing message",
      })
    }
  })

  it("chains the cause without exposing it through the DTO", () => {
    const cause = new Error("connection reset")
    const error = new AppError("QUERY_TIMEOUT", "The query took too long to run.", { cause })

    expect(error.cause).toBe(cause)
    expect(toSafeDto(error)).toEqual({
      code: "QUERY_TIMEOUT",
      message: "The query took too long to run.",
    })
  })
})

describe("statusForErrorCode", () => {
  it("maps every declared SafeErrorCode to its HTTP status", () => {
    // The switch has no `default`, so a future SafeErrorCode fails
    // `pnpm typecheck` before it can fail this list.
    const cases: ReadonlyArray<[SafeErrorCode, number]> = [
      ["UNAUTHENTICATED", 401],
      ["FORBIDDEN", 403],
      ["NOT_FOUND", 404],
      ["VALIDATION", 400],
      ["SCHEMA_INCOMPATIBLE", 422],
      ["QUERY_TIMEOUT", 422],
      ["CONCURRENCY_LIMIT", 422],
      ["IMPORT_LIMIT_EXCEEDED", 422],
      ["INTERNAL", 500],
    ]

    for (const [code, status] of cases) {
      expect(statusForErrorCode(code)).toBe(status)
    }
  })
})
