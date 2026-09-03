// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ActionResult } from "@/shared/validation/action-result"

import { updateTimezoneAction } from "./actions"
import { TimezoneForm } from "./timezone-form"

type TimezoneResult = ActionResult<{ timezone: string }>

vi.mock("./actions", () => ({
  updateTimezoneAction:
    vi.fn<(prevState: TimezoneResult | null, formData: FormData) => Promise<TimezoneResult>>(),
}))

const mockedAction = vi.mocked(updateTimezoneAction)

const availableTimezones = ["UTC", "America/New_York"]

// Default no-op resolver for the pending-state test's promise below — hoisted
// out so the arrow function isn't recreated on every `it` invocation.
function noopResolve() {}

afterEach(() => {
  cleanup()
  mockedAction.mockReset()
})

describe("TimezoneForm", () => {
  it("read-only: hides the submit button and shows the permission notice when the caller cannot edit", () => {
    render(
      <TimezoneForm
        currentTimezone="UTC"
        availableTimezones={availableTimezones}
        canEdit={false}
      />,
    )

    expect(screen.queryByRole("button", { name: "Save timezone" })).not.toBeInTheDocument()
    expect(
      screen.getByText("Only an owner or admin can change the workspace timezone."),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Timezone")).toBeDisabled()
  })

  it("pending: disables the submit button and relabels it while the action is in flight", async () => {
    let resolveAction: (result: TimezoneResult) => void = noopResolve
    mockedAction.mockImplementation(
      () =>
        new Promise<TimezoneResult>((resolve) => {
          resolveAction = resolve
        }),
    )

    render(
      <TimezoneForm currentTimezone="UTC" availableTimezones={availableTimezones} canEdit={true} />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Save timezone" }))

    const pendingButton = await screen.findByRole("button", { name: "Saving…" })
    expect(pendingButton).toBeDisabled()

    resolveAction({ ok: true, data: { timezone: "UTC" } })
    await waitFor(() => expect(mockedAction).toHaveBeenCalledTimes(1))
  })

  it("field error: renders the field message and adds it to the select's aria-describedby", async () => {
    mockedAction.mockResolvedValue({
      ok: false,
      formError: "Check the form and try again.",
      fieldErrors: { timezone: "Choose a timezone" },
    })

    render(
      <TimezoneForm currentTimezone="UTC" availableTimezones={availableTimezones} canEdit={true} />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Save timezone" }))

    const fieldError = await screen.findByText("Choose a timezone")
    expect(fieldError).toHaveAttribute("id", "timezone-error")

    const select = screen.getByLabelText("Timezone")
    expect(select.getAttribute("aria-describedby")).toBe("timezone-warning timezone-error")
  })

  it("form error: renders the top-level alert when the action fails without a field error", async () => {
    mockedAction.mockResolvedValue({
      ok: false,
      formError: "Something went wrong. Try again.",
      fieldErrors: {},
    })

    render(
      <TimezoneForm currentTimezone="UTC" availableTimezones={availableTimezones} canEdit={true} />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Save timezone" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Something went wrong. Try again.")

    const select = screen.getByLabelText("Timezone")
    expect(select.getAttribute("aria-describedby")).toBe("timezone-warning")
  })

  it("success: renders the confirmation message with the saved timezone", async () => {
    mockedAction.mockResolvedValue({ ok: true, data: { timezone: "America/New_York" } })

    render(
      <TimezoneForm currentTimezone="UTC" availableTimezones={availableTimezones} canEdit={true} />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Save timezone" }))

    expect(await screen.findByText("Timezone updated to America/New_York.")).toBeInTheDocument()
  })
})

describe("a stored timezone the allowlist does not contain", () => {
  // A native select whose value matches no option selects index 0, so an
  // unrecognised stored value would be silently rewritten to the first entry
  // on a save the user did not intend to make.
  it("renders the stored value as an option instead of dropping it", () => {
    render(
      <TimezoneForm
        currentTimezone="Asia/Calcutta"
        // Test fixture, rendered once per test; there is no re-render loop for a fresh array
        // reference to defeat, and inlining it here (rather than a shared constant) keeps the
        // scenario each test names legible at the call site.
        // oxlint-disable-next-line react-perf/jsx-no-new-array-as-prop
        availableTimezones={["Africa/Abidjan", "UTC"]}
        canEdit
      />,
    )

    const select = screen.getByLabelText(/timezone/i)
    expect(select).toHaveValue("Asia/Calcutta")
    expect(screen.getByRole("option", { name: /Asia\/Calcutta — not recognised/ })).toBeTruthy()
  })

  it("does not add that option when the stored value is recognised", () => {
    render(
      // Test fixture, rendered once per test; there is no re-render loop for a fresh array
      // reference to defeat, and inlining it here (rather than a shared constant) keeps the
      // scenario each test names legible at the call site.
      // oxlint-disable-next-line react-perf/jsx-no-new-array-as-prop
      <TimezoneForm currentTimezone="UTC" availableTimezones={["Africa/Abidjan", "UTC"]} canEdit />,
    )

    expect(screen.getByLabelText(/timezone/i)).toHaveValue("UTC")
    expect(screen.queryByText(/not recognised/)).toBeNull()
  })
})
