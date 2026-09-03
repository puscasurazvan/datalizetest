// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/shared/env", () => ({
  configuredSocialProviders: () => [],
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
