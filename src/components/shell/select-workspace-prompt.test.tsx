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

import { SelectWorkspacePrompt } from "@/components/shell/select-workspace-prompt"

const ORGANIZATIONS = [
  { id: "org-1", name: "Alpha", slug: "alpha" },
  { id: "org-2", name: "Beta", slug: "beta" },
]

afterEach(() => {
  cleanup()
  refreshMock.mockReset()
  setActiveMock.mockReset()
})

describe("SelectWorkspacePrompt", () => {
  it("refreshes after a successful switch", async () => {
    setActiveMock.mockResolvedValue({ data: { organizationId: "org-1" }, error: null })

    render(<SelectWorkspacePrompt organizations={ORGANIZATIONS} />)
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }))

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1))
  })

  it("recovers the buttons and shows an error when the switch fails, instead of stranding the user", async () => {
    setActiveMock.mockResolvedValue({
      data: null,
      error: {
        message: "You are no longer a member of that workspace.",
        code: "FORBIDDEN",
        status: 403,
      },
    })

    render(<SelectWorkspacePrompt organizations={ORGANIZATIONS} />)
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }))

    // Error surfaces and every button becomes clickable again — nothing is
    // permanently stuck on "Opening…".
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "You are no longer a member of that workspace.",
      ),
    )
    expect(screen.getByRole("button", { name: "Alpha" })).not.toBeDisabled()
    expect(screen.getByRole("button", { name: "Beta" })).not.toBeDisabled()
    expect(refreshMock).not.toHaveBeenCalled()
  })
})
