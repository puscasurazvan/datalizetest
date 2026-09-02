// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

interface SignOutResult {
  data: unknown
  error: { message?: string; code?: string; status?: number } | null
}

const pushMock = vi.fn<(href: string) => void>()
const refreshMock = vi.fn<() => void>()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}))

const signOutMock = vi.fn<() => Promise<SignOutResult>>()
vi.mock("@/modules/auth/client", () => ({
  authClient: {
    signOut: () => signOutMock(),
  },
}))

import { SignOutButton } from "@/components/shell/sign-out-button"

afterEach(() => {
  cleanup()
  pushMock.mockReset()
  refreshMock.mockReset()
  signOutMock.mockReset()
})

describe("SignOutButton", () => {
  it("navigates to /sign-in after a successful sign-out", async () => {
    signOutMock.mockResolvedValue({ data: {}, error: null })

    render(<SignOutButton />)
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sign-in"))
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it("does not navigate to /sign-in and shows an error when sign-out fails, so a live session is never shown as signed out", async () => {
    signOutMock.mockResolvedValue({
      data: null,
      error: { message: "Could not reach the server.", code: "INTERNAL_SERVER_ERROR", status: 500 },
    })

    render(<SignOutButton />)
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server."),
    )
    expect(pushMock).not.toHaveBeenCalled()
    expect(refreshMock).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Sign out" })).not.toBeDisabled()
  })
})
