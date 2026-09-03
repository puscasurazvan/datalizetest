// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { DatasetColumnSummary } from "@/modules/datasets"

import { QueryPanel } from "./query-panel"

const COLUMNS: readonly DatasetColumnSummary[] = [
  { columnId: "col_amount", name: "Amount", type: "decimal", nullable: false, position: 1 },
  { columnId: "col_date", name: "Date", type: "timestamptz", nullable: false, position: 2 },
  { columnId: "col_currency", name: "Currency", type: "string", nullable: false, position: 3 },
]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPanel() {
  render(<QueryPanel datasetId="ds_1" columns={COLUMNS} organizationTimezone="Europe/Paris" />)
}

describe("QueryPanel — measure aggregation options", () => {
  it("offers no 'Sum' once the measure targets a string column", () => {
    renderPanel()

    fireEvent.change(screen.getByLabelText("Measure"), { target: { value: "col_currency" } })

    const aggregationSelect = screen.getByLabelText("Aggregation")
    const optionLabels = within(aggregationSelect)
      .getAllByRole("option")
      .map((option) => option.textContent)
    expect(optionLabels).not.toContain("Sum")
  })

  it("offers 'Sum' once the measure targets a decimal column", () => {
    renderPanel()

    fireEvent.change(screen.getByLabelText("Measure"), { target: { value: "col_amount" } })

    const aggregationSelect = screen.getByLabelText("Aggregation")
    const optionLabels = within(aggregationSelect)
      .getAllByRole("option")
      .map((option) => option.textContent)
    expect(optionLabels).toContain("Sum")
  })
})

describe("QueryPanel — dimension granularity", () => {
  it("shows the granularity select once the dimension is a timestamptz column", () => {
    renderPanel()

    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "col_date" } })

    expect(screen.getByLabelText("Granularity")).toBeInTheDocument()
  })

  it("hides the granularity select for a non-timestamptz dimension", () => {
    renderPanel()

    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "col_currency" } })

    expect(screen.queryByLabelText("Granularity")).not.toBeInTheDocument()
  })
})

describe("QueryPanel — filter operator/value reset on column change", () => {
  it("resets the operator to one the new column's type actually offers", () => {
    renderPanel()

    // "gt" is valid on the integer column ("Amount") but not on the string
    // column ("Currency") switched to next — a stale "gt" would make a
    // native <select> silently render its first option while state still
    // held the invalid one (the exact trap timezone-form.tsx's own comment
    // names).
    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "col_amount" } })
    fireEvent.change(screen.getByLabelText("Filter operator"), { target: { value: "gt" } })

    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "col_currency" } })

    expect(screen.getByLabelText("Filter operator")).toHaveValue("eq")
  })

  it("clears a typed value that no longer matches the new column's type", () => {
    renderPanel()

    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "col_currency" } })
    fireEvent.change(screen.getByLabelText("Filter value"), { target: { value: "USD" } })

    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "col_amount" } })

    expect(screen.getByLabelText("Filter value")).toHaveValue(null)
  })
})

describe("QueryPanel — currency refusal", () => {
  it("renders the server's VALIDATION message as a builder-level alert, never a blank chart", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          code: "VALIDATION",
          message: 'This query aggregates an amount without pinning "Currency" to one value.',
        }),
      }),
    )

    renderPanel()

    fireEvent.change(screen.getByLabelText("Measure"), { target: { value: "col_amount" } })
    fireEvent.click(screen.getByRole("button", { name: "Run query" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(
      'This query aggregates an amount without pinning "Currency" to one value.',
    )
    expect(screen.queryByRole("table")).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole("button", { name: "Run query" })).toBeEnabled())
  })
})
