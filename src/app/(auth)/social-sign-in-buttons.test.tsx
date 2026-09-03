// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

interface SocialSignInResult {
  data: unknown
  error: { message?: string; code?: string; status?: number } | null
}

const signInSocialMock =
  vi.fn<
    (options: {
      provider: string
      callbackURL: string
      errorCallbackURL: string
    }) => Promise<SocialSignInResult>
  >()

vi.mock("@/modules/auth/client", () => ({
  authClient: {
    signIn: {
      social: (options: { provider: string; callbackURL: string; errorCallbackURL: string }) =>
        signInSocialMock(options),
    },
  },
}))

import { SocialSignInButtons } from "./social-sign-in-buttons"

// Stable references, not recreated per render: each names a fixed scenario
// ("no provider configured", "both configured", ...) that several tests
// share, rather than a fresh array literal at every call site.
const NO_PROVIDERS: readonly ("google" | "github")[] = []
const GOOGLE_ONLY: readonly ("google" | "github")[] = ["google"]
const BOTH_PROVIDERS: readonly ("google" | "github")[] = ["google", "github"]

// Default no-op resolver for the pending-state test's promise below — hoisted
// out so the arrow function isn't recreated on every `it` invocation.
function noopResolve() {}

afterEach(() => {
  cleanup()
  signInSocialMock.mockReset()
})

describe("SocialSignInButtons", () => {
  it("renders nothing when no provider is configured", () => {
    const { container } = render(<SocialSignInButtons providers={NO_PROVIDERS} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows a text button per configured provider, never a bare icon", () => {
    render(<SocialSignInButtons providers={BOTH_PROVIDERS} />)

    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument()
  })

  it("does not render a button for a provider that isn't configured", () => {
    render(<SocialSignInButtons providers={GOOGLE_ONLY} />)

    expect(screen.queryByRole("button", { name: /GitHub/ })).not.toBeInTheDocument()
  })

  it("starts Google sign-in with the datasets and sign-in-error callback URLs", async () => {
    signInSocialMock.mockResolvedValue({ data: {}, error: null })

    render(<SocialSignInButtons providers={GOOGLE_ONLY} />)
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }))

    await waitFor(() =>
      expect(signInSocialMock).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "/datasets",
        errorCallbackURL: "/sign-in?provider=google",
      }),
    )
  })

  it("relabels the clicked provider's button and disables every button while connecting", async () => {
    let resolveSignIn: (result: SocialSignInResult) => void = noopResolve
    signInSocialMock.mockImplementation(
      () =>
        new Promise<SocialSignInResult>((resolve) => {
          resolveSignIn = resolve
        }),
    )

    render(<SocialSignInButtons providers={BOTH_PROVIDERS} />)
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }))

    expect(await screen.findByRole("button", { name: "Connecting to Google…" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeDisabled()

    resolveSignIn({ data: {}, error: null })
  })

  it("shows an error and re-enables the buttons when starting the redirect fails", async () => {
    signInSocialMock.mockResolvedValue({
      data: null,
      error: { message: "Could not reach the server.", code: "INTERNAL_SERVER_ERROR", status: 500 },
    })

    render(<SocialSignInButtons providers={GOOGLE_ONLY} />)
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }))

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server."),
    )
    expect(screen.getByRole("button", { name: "Continue with Google" })).not.toBeDisabled()
  })
})
