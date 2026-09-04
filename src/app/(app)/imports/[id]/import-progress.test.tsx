// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refreshMock = vi.fn<() => void>()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

import { ImportProgress } from "./import-progress"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  refreshMock.mockReset()
})

describe("ImportProgress", () => {
  it("refreshes on every tick while mounted, for the profiling phase", () => {
    render(<ImportProgress phase="profiling" />)

    expect(refreshMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2_000)
    expect(refreshMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2_000)
    expect(refreshMock).toHaveBeenCalledTimes(2)
  })

  it("refreshes on every tick while mounted, for the loading phase", () => {
    render(<ImportProgress phase="loading" />)

    vi.advanceTimersByTime(2_000)
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it("clears the interval on unmount — no refresh fires after", () => {
    const { unmount } = render(<ImportProgress phase="profiling" />)
    unmount()

    vi.advanceTimersByTime(10_000)
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it("promises no completion — no progress bar, only a status message", () => {
    const { container } = render(<ImportProgress phase="loading" />)

    expect(container.querySelector("progress")).not.toBeInTheDocument()
    expect(container.querySelector('[role="progressbar"]')).not.toBeInTheDocument()
  })
})
