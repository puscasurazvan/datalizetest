// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type * as Imports from "@/modules/imports"
import type { ImportView } from "@/modules/imports"
import type * as Organizations from "@/modules/organizations"
import { AppError } from "@/shared/errors"

const getImportViewMock = vi.fn<(context: unknown, importId: string) => Promise<ImportView>>()
vi.mock("@/modules/imports", async (importOriginal) => ({
  ...(await importOriginal<typeof Imports>()),
  getImportView: (context: unknown, importId: string) => getImportViewMock(context, importId),
}))

const listAvailableTimezonesMock = vi.fn<() => Promise<string[]>>()
vi.mock("@/modules/organizations", async (importOriginal) => ({
  ...(await importOriginal<typeof Organizations>()),
  listAvailableTimezones: () => listAvailableTimezonesMock(),
}))

const resolveActiveContextMock = vi.fn<() => Promise<unknown>>()
vi.mock("../../active-context", () => ({
  resolveActiveContext: () => resolveActiveContextMock(),
}))

const notFoundMock = vi.fn<() => never>(() => {
  throw new Error("NEXT_NOT_FOUND")
})
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}))

vi.mock("./import-progress", () => ({
  ImportProgress: ({ phase }: { phase: string }) => (
    <div data-testid="import-progress">{phase}</div>
  ),
}))

vi.mock("./confirm-import-form", () => ({
  ConfirmImportForm: ({
    importId,
    organizationTimezone,
    timezones,
  }: {
    importId: string
    organizationTimezone: string
    timezones: readonly string[]
  }) => (
    <div data-testid="confirm-import-form">
      {importId} · {organizationTimezone} · {timezones.join(",")}
    </div>
  ),
}))

vi.mock("./import-outcome", () => ({
  ImportOutcome: ({ view }: { view: { phase: string; errorMessage?: string | null } }) => (
    <div data-testid="import-outcome" data-phase={view.phase}>
      {view.errorMessage ?? null}
    </div>
  ),
}))

import ImportPage from "./page"

const CONTEXT = { organizationTimezone: "UTC" }
const BASE = {
  importId: "imp-1",
  datasetId: "ds-1",
  originalFilename: "transactions.csv",
  createdAt: new Date("2026-01-01T00:00:00Z"),
}

afterEach(() => {
  cleanup()
  getImportViewMock.mockReset()
  listAvailableTimezonesMock.mockReset()
  resolveActiveContextMock.mockReset()
  notFoundMock.mockClear()
})

describe("ImportPage", () => {
  it("renders nothing while no workspace is active — the layout owns that state", async () => {
    resolveActiveContextMock.mockResolvedValue("no-active-organization")

    const result = await ImportPage({ params: Promise.resolve({ id: "imp-1" }) })

    expect(result).toBeNull()
  })

  it("calls notFound() for a foreign or missing import", async () => {
    resolveActiveContextMock.mockResolvedValue(CONTEXT)
    getImportViewMock.mockRejectedValue(new AppError("NOT_FOUND", "Import not found."))

    await expect(ImportPage({ params: Promise.resolve({ id: "imp-1" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )
  })

  it.each(["profiling", "loading"] as const)(
    "mounts ImportProgress for the %s phase",
    async (phase) => {
      resolveActiveContextMock.mockResolvedValue(CONTEXT)
      getImportViewMock.mockResolvedValue({ ...BASE, phase })

      render(await ImportPage({ params: Promise.resolve({ id: "imp-1" }) }))

      expect(screen.getByTestId("import-progress")).toHaveTextContent(phase)
    },
  )

  it("renders the confirm form with the workspace timezone list for awaiting_confirmation", async () => {
    resolveActiveContextMock.mockResolvedValue(CONTEXT)
    getImportViewMock.mockResolvedValue({
      ...BASE,
      phase: "awaiting_confirmation",
      proposedSchema: { rowsRead: 10, rowsWithBadFieldCount: 0, columns: [] },
    })
    listAvailableTimezonesMock.mockResolvedValue(["UTC", "Europe/Paris"])

    render(await ImportPage({ params: Promise.resolve({ id: "imp-1" }) }))

    expect(screen.getByTestId("confirm-import-form")).toHaveTextContent(
      "imp-1 · UTC · UTC,Europe/Paris",
    )
  })

  it("does not fetch timezones for a phase that has no form to put them in", async () => {
    resolveActiveContextMock.mockResolvedValue(CONTEXT)
    getImportViewMock.mockResolvedValue({ ...BASE, phase: "profiling" })

    render(await ImportPage({ params: Promise.resolve({ id: "imp-1" }) }))

    expect(listAvailableTimezonesMock).not.toHaveBeenCalled()
  })

  it("shows COMPLETED with its issue counts through ImportOutcome", async () => {
    resolveActiveContextMock.mockResolvedValue(CONTEXT)
    getImportViewMock.mockResolvedValue({
      ...BASE,
      phase: "completed",
      rowsLoaded: 1_000,
      rowsWithRecordedIssue: 12,
      issueCountsByCode: { UNPARSEABLE_VALUE: 12 },
    })

    render(await ImportPage({ params: Promise.resolve({ id: "imp-1" }) }))

    expect(screen.getByTestId("import-outcome")).toHaveAttribute("data-phase", "completed")
    // The poller only ever promises "still going" (H7) — it has no business
    // mounting once the pipeline has actually stopped.
    expect(screen.queryByTestId("import-progress")).not.toBeInTheDocument()
  })

  it("shows the FAILED phase's recorded message through ImportOutcome", async () => {
    resolveActiveContextMock.mockResolvedValue(CONTEXT)
    getImportViewMock.mockResolvedValue({
      ...BASE,
      phase: "failed",
      errorCode: "VALIDATION",
      errorMessage: "The file exceeded the row ceiling.",
    })

    render(await ImportPage({ params: Promise.resolve({ id: "imp-1" }) }))

    expect(screen.getByTestId("import-outcome")).toHaveTextContent(
      "The file exceeded the row ceiling.",
    )
    expect(screen.queryByTestId("import-progress")).not.toBeInTheDocument()
  })

  it("shows CANCELLED through ImportOutcome too", async () => {
    resolveActiveContextMock.mockResolvedValue(CONTEXT)
    getImportViewMock.mockResolvedValue({ ...BASE, phase: "cancelled" })

    render(await ImportPage({ params: Promise.resolve({ id: "imp-1" }) }))

    expect(screen.getByTestId("import-outcome")).toHaveAttribute("data-phase", "cancelled")
    expect(screen.queryByTestId("import-progress")).not.toBeInTheDocument()
  })
})
