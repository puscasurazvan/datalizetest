import { describe, expect, it } from "vitest"

import { resolveColumnIds } from "./column-continuity"

describe("resolveColumnIds", () => {
  it("mints a fresh id for every column when there is no previous version", () => {
    const resolved = resolveColumnIds([], [{ position: 1, name: "amount", type: "decimal" }])
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.columnId).toBeTruthy()
  })

  it("carries the same column id forward when name and type are both unchanged", () => {
    const resolved = resolveColumnIds(
      [{ columnId: "col_amount", name: "amount", type: "decimal" }],
      [{ position: 1, name: "amount", type: "decimal" }],
    )
    expect(resolved[0]?.columnId).toBe("col_amount")
  })

  it("mints a new id when the name changes, even if the type does not", () => {
    const resolved = resolveColumnIds(
      [{ columnId: "col_plan", name: "plan", type: "string" }],
      [{ position: 1, name: "plan_name", type: "string" }],
    )
    expect(resolved[0]?.columnId).not.toBe("col_plan")
  })

  it("mints a new id when the type changes, even if the name does not", () => {
    const resolved = resolveColumnIds(
      [{ columnId: "col_amount", name: "amount", type: "string" }],
      [{ position: 1, name: "amount", type: "decimal" }],
    )
    expect(resolved[0]?.columnId).not.toBe("col_amount")
  })
})
