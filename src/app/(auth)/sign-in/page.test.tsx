// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const devSignInEnabled = vi.fn<() => boolean>(() => false)

vi.mock("@/shared/env", () => ({
  configuredSocialProviders: () => [],
  devSignInEnabled: () => devSignInEnabled(),
}))

vi.mock("./sign-in-form", () => ({
  SignInForm: () => <div data-testid="sign-in-form" />,
}))

vi.mock("../social-sign-in-buttons", () => ({
  SocialSignInButtons: () => null,
}))

import SignInPage from "./page"

afterEach(() => {
  cleanup()
})

describe("SignInPage OAuth callback error", () => {
  it("shows no error banner when the callback added no error", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("names the provider and says what to do, never the raw error code", async () => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({ provider: "google", error: "unable_to_link_account" }),
      }),
    )

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Continue with Google didn't complete.")
    expect(alert).toHaveTextContent(/try again/i)
    expect(alert).not.toHaveTextContent("unable_to_link_account")
  })

  it("names GitHub when that provider's callback failed", async () => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({ provider: "github", error: "invalid_code" }),
      }),
    )

    expect(screen.getByRole("alert")).toHaveTextContent("Continue with GitHub didn't complete.")
  })

  it("falls back to a generic message when the error arrived with no recognised provider", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({ error: "state_not_found" }) }))

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Something went wrong signing you in.")
    expect(alert).not.toHaveTextContent("state_not_found")
  })
})

describe("SignInPage development sign-in", () => {
  const linkName = /sign in as the demo user/i

  it("offers no development sign-in by default", async () => {
    devSignInEnabled.mockReturnValue(false)
    render(await SignInPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole("link", { name: linkName })).not.toBeInTheDocument()
  })

  it("offers it when the environment enables it, as a real document navigation", async () => {
    devSignInEnabled.mockReturnValue(true)
    render(await SignInPage({ searchParams: Promise.resolve({}) }))

    const link = screen.getByRole("link", { name: linkName })
    expect(link).toHaveAttribute("href", "/api/dev/sign-in")
  })
})
