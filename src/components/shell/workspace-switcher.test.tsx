// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

interface SetActiveResult {
  data: unknown
  error: { message?: string; code?: string; status?: number } | null
}

const refreshMock = vi.fn<() => void>()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn<(href: string) => void>() }),
}))

const setActiveMock = vi.fn<(args: { organizationId: string }) => Promise<SetActiveResult>>()
vi.mock("@/modules/auth/client", () => ({
  authClient: {
    organization: {
      setActive: (args: { organizationId: string }) => setActiveMock(args),
    },
  },
}))

import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher"

const ORGANIZATIONS = [
  { id: "org-1", name: "Alpha", slug: "alpha" },
  { id: "org-2", name: "Beta", slug: "beta" },
]

afterEach(() => {
  cleanup()
  refreshMock.mockReset()
  setActiveMock.mockReset()
})

describe("WorkspaceSwitcher", () => {
  it("refreshes after a successful switch", async () => {
    setActiveMock.mockResolvedValue({ data: { organizationId: "org-2" }, error: null })

    render(<WorkspaceSwitcher organizations={ORGANIZATIONS} activeOrganizationId="org-1" />)
    fireEvent.change(screen.getByLabelText("Switch workspace"), { target: { value: "org-2" } })

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1))
  })

  it("shows an error instead of silently snapping back when the switch fails", async () => {
    setActiveMock.mockResolvedValue({
      data: null,
      error: {
        message: "You are no longer a member of that workspace.",
        code: "FORBIDDEN",
        status: 403,
      },
    })

    render(<WorkspaceSwitcher organizations={ORGANIZATIONS} activeOrganizationId="org-1" />)
    fireEvent.change(screen.getByLabelText("Switch workspace"), { target: { value: "org-2" } })

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "You are no longer a member of that workspace.",
      ),
    )
    expect(refreshMock).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Switch workspace")).not.toBeDisabled()
  })
})
