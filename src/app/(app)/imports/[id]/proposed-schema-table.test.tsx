// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DATALIZE_TYPES,
  SAMPLE_SIZE,
  type DatalizeType,
  type ProposedSchemaColumn,
} from "@/modules/imports"

import { ProposedSchemaTable } from "./proposed-schema-table"

function column(
  overrides: Partial<ProposedSchemaColumn> & { position: number },
): ProposedSchemaColumn {
  return {
    name: `col_${overrides.position}`,
    originalHeader: `col_${overrides.position}`,
    headerRenamed: false,
    headerIssues: [],
    type: "string",
    nullable: false,
    unparseableCount: 0,
    ...overrides,
  }
}

afterEach(cleanup)

describe("ProposedSchemaTable", () => {
  it("offers exactly the six DATALIZE_TYPES as override options, string never text", () => {
    render(
      <ProposedSchemaTable
        columns={[column({ position: 1 })]}
        overrides={new Map()}
        onOverrideChange={vi.fn<(position: number, type: DatalizeType) => void>()}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    const select = screen.getByLabelText("Type override for col_1")
    const optionValues = Array.from(select.querySelectorAll("option")).map((o) => o.textContent)
    expect(optionValues).toEqual([...DATALIZE_TYPES])
    expect(optionValues).toContain("string")
    expect(optionValues).not.toContain("text")
  })

  it("labels the unparseable count from the sampleSize prop, never a typed-in literal", () => {
    render(
      <ProposedSchemaTable
        columns={[column({ position: 1, unparseableCount: 12 })]}
        overrides={new Map()}
        onOverrideChange={vi.fn<(position: number, type: DatalizeType) => void>()}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    expect(
      screen.getByText(`in the first ${SAMPLE_SIZE.toLocaleString()} sampled rows`),
    ).toBeInTheDocument()
  })

  it("reports exactly one override when one select is changed", async () => {
    const onOverrideChange = vi.fn<(position: number, type: DatalizeType) => void>()
    const user = userEvent.setup()
    render(
      <ProposedSchemaTable
        columns={[column({ position: 1, type: "string" })]}
        overrides={new Map()}
        onOverrideChange={onOverrideChange}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    await user.selectOptions(screen.getByLabelText("Type override for col_1"), "integer")

    expect(onOverrideChange).toHaveBeenCalledTimes(1)
    expect(onOverrideChange).toHaveBeenCalledWith(1, "integer")
  })

  it("shows the NULL/immutable consequence on a narrowing override", () => {
    render(
      <ProposedSchemaTable
        columns={[column({ position: 1, type: "string" })]}
        overrides={new Map<number, DatalizeType>([[1, "integer"]])}
        onOverrideChange={vi.fn<(position: number, type: DatalizeType) => void>()}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    expect(screen.getByText(/load as/)).toHaveTextContent(
      "Values that don't parse as integer load as NULL and are recorded as issues. The Dataset Version is immutable once committed.",
    )
  })

  it("shows no consequence line for an override to string", () => {
    render(
      <ProposedSchemaTable
        columns={[column({ position: 1, type: "integer" })]}
        overrides={new Map<number, DatalizeType>([[1, "string"]])}
        onOverrideChange={vi.fn<(position: number, type: DatalizeType) => void>()}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    expect(screen.queryByText(/load as NULL/)).not.toBeInTheDocument()
  })

  it("shows no consequence line when there is no override at all", () => {
    render(
      <ProposedSchemaTable
        columns={[column({ position: 1, type: "integer" })]}
        overrides={new Map()}
        onOverrideChange={vi.fn<(position: number, type: DatalizeType) => void>()}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    expect(screen.queryByText(/load as NULL/)).not.toBeInTheDocument()
  })

  it("renders a badge for a renamed header and for each header issue, icon and text — never colour alone", () => {
    render(
      <ProposedSchemaTable
        columns={[
          column({
            position: 1,
            headerRenamed: true,
            originalHeader: "Customer ID",
            headerIssues: ["bom_stripped", "duplicate_header"],
          }),
        ]}
        overrides={new Map()}
        onOverrideChange={vi.fn<(position: number, type: DatalizeType) => void>()}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    expect(screen.getByText(/Renamed from/)).toBeInTheDocument()
    expect(screen.getByText("BOM stripped")).toBeInTheDocument()
    expect(screen.getByText("Duplicate name")).toBeInTheDocument()
  })

  it("renders the datetimeOffset badge only when the column has one", () => {
    render(
      <ProposedSchemaTable
        columns={[
          column({ position: 1, type: "timestamptz", datetimeOffset: "naive" }),
          column({ position: 2, type: "string" }),
        ]}
        overrides={new Map()}
        onOverrideChange={vi.fn<(position: number, type: DatalizeType) => void>()}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    expect(screen.getByText("Naive local time")).toBeInTheDocument()
  })
})
