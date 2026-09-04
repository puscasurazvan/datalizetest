// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { ImportView } from "@/modules/imports"

import { OpenImportBanner } from "./open-import-banner"

afterEach(cleanup)

const BASE = {
  importId: "imp-1",
  datasetId: "ds-1",
  originalFilename: "transactions.csv",
  createdAt: new Date("2026-01-01T00:00:00Z"),
}

describe("OpenImportBanner", () => {
  it("links to the stuck import for a profiling phase (H7 — no reconciler exists)", () => {
    const view: ImportView = { ...BASE, phase: "profiling" }
    render(<OpenImportBanner view={view} />)

    const link = screen.getByRole("link", { name: /Still reading this file/ })
    expect(link).toHaveAttribute("href", "/imports/imp-1")
  })

  it("surfaces a FAILED profile that never reached its own page (H5)", () => {
    const view: ImportView = {
      ...BASE,
      phase: "failed",
      errorCode: "VALIDATION",
      errorMessage: "The file exceeded the row ceiling.",
    }
    render(<OpenImportBanner view={view} />)

    expect(screen.getByText("The file exceeded the row ceiling.")).toBeInTheDocument()
  })

  it("renders nothing for a phase findOpenImportForDataset never actually returns", () => {
    const view: ImportView = {
      ...BASE,
      phase: "completed",
      rowsLoaded: 10,
      rowsWithRecordedIssue: 0,
      issueCountsByCode: {},
    }
    const { container } = render(<OpenImportBanner view={view} />)

    expect(container).toBeEmptyDOMElement()
  })
})
