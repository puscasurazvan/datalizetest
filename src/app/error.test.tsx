// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import ErrorPage from "./error"

afterEach(() => {
  cleanup()
})

describe("ErrorPage", () => {
  it("never renders error.message — it can carry server internals", () => {
    const error = Object.assign(new Error("leaked db connection string: postgres://…"), {
      digest: "abc123",
    })

    render(<ErrorPage error={error} reset={vi.fn<() => void>()} />)

    expect(screen.queryByText(/leaked db connection string/)).not.toBeInTheDocument()
  })

  it("shows the digest when Next.js set one", () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" })

    render(<ErrorPage error={error} reset={vi.fn<() => void>()} />)

    expect(screen.getByText(/abc123/)).toBeInTheDocument()
  })

  it("renders no digest reference at all when Next.js set none", () => {
    const error = new Error("boom")

    render(<ErrorPage error={error} reset={vi.fn<() => void>()} />)

    expect(screen.queryByText(/Reference for support/)).not.toBeInTheDocument()
  })
})
