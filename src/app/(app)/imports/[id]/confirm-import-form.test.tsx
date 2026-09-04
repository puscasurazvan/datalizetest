// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DATALIZE_TYPES, SAMPLE_SIZE, type ConfirmImportResult } from "@/modules/imports"
import type { ActionResult } from "@/shared/validation/action-result"

const refreshMock = vi.fn<() => void>()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

// The component imports this file directly, not the `@/modules/imports`
// barrel (confirm-import-form.tsx's own doc comment says why) — so this is
// the module to mock.
const confirmImportActionMock =
  vi.fn<(input: unknown) => Promise<ActionResult<ConfirmImportResult>>>()
vi.mock("@/modules/imports/confirm-action", () => ({
  confirmImportAction: (input: unknown) => confirmImportActionMock(input),
}))

import { ConfirmImportForm } from "./confirm-import-form"

const PROPOSED_SCHEMA = {
  rowsRead: 100,
  rowsWithBadFieldCount: 0,
  columns: [
    {
      position: 1,
      name: "amount",
      originalHeader: "amount",
      headerRenamed: false,
      headerIssues: [],
      type: "string" as const,
      nullable: false,
      unparseableCount: 0,
    },
  ],
}

afterEach(() => {
  cleanup()
  refreshMock.mockReset()
  confirmImportActionMock.mockReset()
})

describe("ConfirmImportForm", () => {
  it("submits the chosen override and timezone", async () => {
    confirmImportActionMock.mockResolvedValue({ ok: true, data: { importId: "imp-1" } })
    const user = userEvent.setup()
    render(
      <ConfirmImportForm
        importId="imp-1"
        proposedSchema={PROPOSED_SCHEMA}
        organizationTimezone="UTC"
        timezones={["UTC", "America/New_York"]}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    await user.selectOptions(screen.getByLabelText("Type override for amount"), "decimal")
    await user.selectOptions(screen.getByLabelText("Timezone for naive timestamps"), [
      "America/New_York",
    ])
    await user.click(screen.getByRole("button", { name: "Confirm and load" }))

    await waitFor(() =>
      expect(confirmImportActionMock).toHaveBeenCalledWith({
        importId: "imp-1",
        columnOverrides: [{ position: 1, type: "decimal" }],
        timezoneOverride: "America/New_York",
      }),
    )
    expect(refreshMock).toHaveBeenCalled()
  })

  it("omits timezoneOverride when the workspace default is kept", async () => {
    confirmImportActionMock.mockResolvedValue({ ok: true, data: { importId: "imp-1" } })
    const user = userEvent.setup()
    render(
      <ConfirmImportForm
        importId="imp-1"
        proposedSchema={PROPOSED_SCHEMA}
        organizationTimezone="UTC"
        timezones={["UTC"]}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Confirm and load" }))

    await waitFor(() =>
      expect(confirmImportActionMock).toHaveBeenCalledWith({
        importId: "imp-1",
        columnOverrides: [],
        timezoneOverride: undefined,
      }),
    )
  })

  it("renders a server VALIDATION failure as an alert and refreshes anyway (H1)", async () => {
    confirmImportActionMock.mockResolvedValue({
      ok: false,
      formError: "This import is not awaiting confirmation.",
      fieldErrors: {},
    })
    const user = userEvent.setup()
    render(
      <ConfirmImportForm
        importId="imp-1"
        proposedSchema={PROPOSED_SCHEMA}
        organizationTimezone="UTC"
        timezones={["UTC"]}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Confirm and load" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This import is not awaiting confirmation.",
    )
    expect(refreshMock).toHaveBeenCalled()
  })

  it("disables the submit button while the request is pending", async () => {
    const pending = Promise.withResolvers<ActionResult<ConfirmImportResult>>()
    confirmImportActionMock.mockReturnValue(pending.promise)
    const user = userEvent.setup()
    render(
      <ConfirmImportForm
        importId="imp-1"
        proposedSchema={PROPOSED_SCHEMA}
        organizationTimezone="UTC"
        timezones={["UTC"]}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Confirm and load" }))

    expect(screen.getByRole("button", { name: "Committing…" })).toBeDisabled()
    pending.resolve({ ok: true, data: { importId: "imp-1" } })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirm and load" })).not.toBeDisabled(),
    )
  })

  it("ships Refuse / Abandon as a real, disabled button, never a working one", () => {
    render(
      <ConfirmImportForm
        importId="imp-1"
        proposedSchema={PROPOSED_SCHEMA}
        organizationTimezone="UTC"
        timezones={["UTC"]}
        typeOptions={DATALIZE_TYPES}
        sampleSize={SAMPLE_SIZE}
      />,
    )

    const button = screen.getByRole("button", { name: "Refuse / Abandon" })
    expect(button.tagName).toBe("BUTTON")
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("title")
  })
})
