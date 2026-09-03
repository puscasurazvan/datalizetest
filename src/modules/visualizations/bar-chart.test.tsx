// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { render } from "@testing-library/react"
import { beforeAll, describe, expect, it } from "vitest"

import type { BarDatum } from "@/modules/visualizations/bar-chart"
import { BarVisualization } from "@/modules/visualizations/bar-chart"

const GROUPS: readonly BarDatum[] = [
  { label: "a", value: 1, rowCount: 10 },
  { label: "b", value: 5, rowCount: 20 },
  { label: "c", value: 3, rowCount: 12 },
]

class StubResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element): void {
    const size: ResizeObserverSize = { inlineSize: 600, blockSize: 240 }
    const rect: DOMRectReadOnly = {
      x: 0,
      y: 0,
      width: 600,
      height: 240,
      top: 0,
      left: 0,
      right: 600,
      bottom: 240,
      toJSON: () => ({}),
    }
    const entry: ResizeObserverEntry = {
      target,
      contentRect: rect,
      borderBoxSize: [size],
      contentBoxSize: [size],
      devicePixelContentBoxSize: [size],
    }
    this.callback([entry], this)
  }

  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  globalThis.ResizeObserver = StubResizeObserver
})

describe("BarVisualization", () => {
  it("keeps the peak bar on chart-1 and never on chart-5", () => {
    const { container } = render(
      <BarVisualization
        data={GROUPS}
        measureLabel="revenue"
        granularityNote="Grouped by month (UTC)"
        groupCount={3}
      />,
    )

    const fills = [...container.querySelectorAll(".recharts-bar-rectangle path")].map((el) =>
      el.getAttribute("fill"),
    )

    expect(fills).toContain("var(--color-chart-1)")
    expect(fills.filter((fill) => fill === "var(--color-chart-1)")).toHaveLength(1)
    expect(fills).not.toContain("var(--color-chart-5)")
  })
})
