// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import type { QueryResult } from "@/modules/queries"

import { QueryResultView } from "./query-result-view"

afterEach(cleanup)

// Recharts' ResponsiveContainer needs a ResizeObserver, which jsdom does not
// implement — same stub bar-chart.test.tsx uses, reporting a fixed size so
// the chart actually renders instead of staying at 0x0.
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

// A result names its dimension by Column ID; the view resolves it to the
// column's human name. "value"/"rows" are measure aliases, not Column IDs,
// and are deliberately absent so the fallback path is exercised too.
const COLUMN_NAMES: Readonly<Record<string, string>> = { col_month: "created_at" }

function chartShapedResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: [
      { name: "col_month", type: "date" },
      { name: "value", type: "decimal" },
      { name: "rows", type: "integer" },
    ],
    rows: [
      { col_month: "2026-01-01", value: "100.00", rows: "4" },
      { col_month: "2026-02-01", value: "200.00", rows: "9" },
    ],
    rowCount: 2,
    truncated: false,
    hasMore: false,
    durationMs: 12,
    queryId: "qe_1",
    executedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("QueryResultView — empty state", () => {
  it("renders a no-rows message instead of a table", () => {
    render(
      <QueryResultView
        result={chartShapedResult({ rowCount: 0, rows: [] })}
        organizationTimezone="UTC"
        granularity="month"
        measureLabel="Sum of amount"
        columnNames={COLUMN_NAMES}
      />,
    )

    expect(screen.getByText("This query matched no rows.")).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })
})

describe("QueryResultView — table caption", () => {
  it("shows the true row count when the result is not truncated", () => {
    render(
      <QueryResultView
        result={chartShapedResult()}
        organizationTimezone="UTC"
        granularity={null}
        measureLabel="Sum of amount"
        columnNames={COLUMN_NAMES}
      />,
    )

    expect(screen.getByText("Showing 2 of 2 rows")).toBeInTheDocument()
  })

  it("shows '10,000+' rather than a fabricated number when truncated", () => {
    render(
      <QueryResultView
        result={chartShapedResult({ truncated: true, rowCount: 10_000 })}
        organizationTimezone="UTC"
        granularity={null}
        measureLabel="Sum of amount"
        columnNames={COLUMN_NAMES}
      />,
    )

    expect(screen.getByText("Showing 2 of 10,000+ rows")).toBeInTheDocument()
  })
})

describe("QueryResultView — column headings", () => {
  it("heads the dimension column with its name, never the raw Column ID", () => {
    render(
      <QueryResultView
        result={chartShapedResult()}
        organizationTimezone="UTC"
        granularity="month"
        measureLabel="Sum of amount"
        columnNames={COLUMN_NAMES}
      />,
    )

    expect(screen.getByRole("columnheader", { name: "created_at" })).toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "col_month" })).not.toBeInTheDocument()
  })

  it("falls back to the raw name for a measure alias, which is not a Column ID", () => {
    render(
      <QueryResultView
        result={chartShapedResult()}
        organizationTimezone="UTC"
        granularity="month"
        measureLabel="Sum of amount"
        columnNames={COLUMN_NAMES}
      />,
    )

    expect(screen.getByRole("columnheader", { name: "value" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "rows" })).toBeInTheDocument()
  })
})

describe("QueryResultView — bar chart eligibility", () => {
  it("renders the bar chart for a 1-dimension, 1-charted-measure, granularity-grouped result", () => {
    const { container } = render(
      <QueryResultView
        result={chartShapedResult()}
        organizationTimezone="Europe/Paris"
        granularity="month"
        measureLabel="Sum of amount"
        columnNames={COLUMN_NAMES}
      />,
    )

    expect(container.querySelector(".recharts-bar-rectangle")).not.toBeNull()
    expect(screen.getByText("Grouped by month (Europe/Paris)")).toBeInTheDocument()
  })

  it("renders table-only for a dimension with no granularity — no footer text to give the chart", () => {
    const { container } = render(
      <QueryResultView
        result={chartShapedResult()}
        organizationTimezone="UTC"
        granularity={null}
        measureLabel="Sum of amount"
        columnNames={COLUMN_NAMES}
      />,
    )

    expect(container.querySelector(".recharts-bar-rectangle")).toBeNull()
    expect(screen.getByRole("table")).toBeInTheDocument()
  })

  it("renders table-only when the result is not the value/rows two-measure shape", () => {
    const tableOnlyResult: QueryResult = {
      ...chartShapedResult(),
      columns: [
        { name: "col_month", type: "date" },
        { name: "value", type: "decimal" },
      ],
      rows: [{ col_month: "2026-01-01", value: "100.00" }],
      rowCount: 1,
    }

    const { container } = render(
      <QueryResultView
        result={tableOnlyResult}
        organizationTimezone="UTC"
        granularity="month"
        measureLabel="Sum of amount"
        columnNames={COLUMN_NAMES}
      />,
    )

    expect(container.querySelector(".recharts-bar-rectangle")).toBeNull()
  })
})
