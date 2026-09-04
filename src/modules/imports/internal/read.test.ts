import { describe, expect, it } from "vitest"

import { phaseForStatus } from "./read"
import type { ImportStatus } from "../repository/import-repository"

// The one place the status -> phase rule lives (read.ts's own doc):
// `start.ts` and `recordConfirmedSchema` both write QUEUED, so status
// alone can't tell "waiting to profile" from "waiting to load" — this
// covers every status the enum defines, plus both branches of the one
// status that's ambiguous on its own.
describe("phaseForStatus", () => {
  it("maps PENDING, PROFILING, and QUEUED-without-confirmedSchema to profiling", () => {
    const cases: readonly ImportStatus[] = ["PENDING", "PROFILING"]
    for (const status of cases) {
      expect(phaseForStatus(status, null)).toBe("profiling")
    }
    expect(phaseForStatus("QUEUED", null)).toBe("profiling")
  })

  it("maps QUEUED-with-confirmedSchema to loading, the same as RUNNING", () => {
    expect(phaseForStatus("QUEUED", { timezone: "UTC", columns: [] })).toBe("loading")
    expect(phaseForStatus("RUNNING", { timezone: "UTC", columns: [] })).toBe("loading")
    // confirmedSchema's actual shape is irrelevant to this rule — only
    // "is it null" — but a QUEUED row leaving AWAITING_CONFIRMATION always
    // carries one, so RUNNING is checked with a confirmedSchema present too.
    expect(phaseForStatus("RUNNING", null)).toBe("loading")
  })

  it("maps every other status one-to-one, regardless of confirmedSchema", () => {
    expect(phaseForStatus("AWAITING_CONFIRMATION", null)).toBe("awaiting_confirmation")
    expect(phaseForStatus("COMPLETED", { timezone: "UTC", columns: [] })).toBe("completed")
    expect(phaseForStatus("FAILED", null)).toBe("failed")
    expect(phaseForStatus("FAILED", { timezone: "UTC", columns: [] })).toBe("failed")
    expect(phaseForStatus("CANCELLED", null)).toBe("cancelled")
  })
})
