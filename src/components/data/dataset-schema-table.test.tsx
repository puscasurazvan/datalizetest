// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { DatasetSchemaTable } from "./dataset-schema-table"

afterEach(() => {
  cleanup()
})

const columns = [
  { columnId: "col-a", name: "id", type: "string", nullable: false, position: 1 },
  { columnId: "col-b", name: "amount", type: "decimal", nullable: true, position: 2 },
] as const

describe("DatasetSchemaTable", () => {
  it("numbers columns from the stored 1-based position, not position + 1", () => {
    render(<DatasetSchemaTable columns={columns} />)

    const idRow = screen.getByRole("row", { name: /\bid\b/ })
    expect(idRow).toHaveTextContent(/^1/)
    // The regression this pins: the first column once rendered as "2".
    expect(idRow).not.toHaveTextContent(/^2/)
  })

  it("shows the type, nullability and Column ID of each column", () => {
    render(<DatasetSchemaTable columns={columns} />)

    const amountRow = screen.getByRole("row", { name: /amount/ })
    expect(amountRow).toHaveTextContent("decimal")
    expect(amountRow).toHaveTextContent("yes")
    expect(amountRow).toHaveTextContent("col-b")
  })

  it("says so when a version has no columns", () => {
    render(<DatasetSchemaTable columns={[]} />)

    expect(screen.getByText("This version has no columns.")).toBeInTheDocument()
  })
})
