import { describe, expect, it } from "vitest"

import { AppError } from "@/shared/errors"

import { toErrorOutcome } from "./service"

// The one pure function in this module (everything else needs the database
// or `executeSavedQuery`, and is covered by service.integration.test.ts) —
// see dashboards/CLAUDE.md "Every widget fails independently".
describe("toErrorOutcome", () => {
  it("passes an AppError's code and message through unchanged", () => {
    const error = new AppError("SCHEMA_INCOMPATIBLE", 'Column "col_removed" no longer exists.')

    expect(toErrorOutcome(error)).toEqual({
      kind: "error",
      code: "SCHEMA_INCOMPATIBLE",
      message: 'Column "col_removed" no longer exists.',
    })
  })

  it("masks a non-AppError behind the generic INTERNAL message, never leaking its own text", () => {
    const error = new Error('relation "analytical.dv_abc123" does not exist')

    expect(toErrorOutcome(error)).toEqual({
      kind: "error",
      code: "INTERNAL",
      message: "An unexpected error occurred.",
    })
  })
})
