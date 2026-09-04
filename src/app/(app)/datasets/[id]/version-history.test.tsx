// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { DatasetVersionSummary } from "@/modules/datasets"

import { VersionHistory } from "./version-history"

function version(
  overrides: Partial<DatasetVersionSummary> & { id: string },
): DatasetVersionSummary {
  return {
    versionNumber: 1,
    status: "COMPLETED",
    rowCount: 1_000,
    columnCount: 8,
    timezoneUsedForNaiveTimestamps: "UTC",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  }
}

const V2 = version({ id: "v2", versionNumber: 2, rowCount: 2_500 })
const V1 = version({ id: "v1", versionNumber: 1, rowCount: 1_000 })

// This project does not run vitest with `globals: true`, so React Testing
// Library never registers its own auto-cleanup — without this, each render
// stacks on the previous test's DOM.
afterEach(cleanup)

describe("VersionHistory", () => {
  it("keeps a superseded version on the page rather than dropping it", () => {
    render(<VersionHistory versions={[V2, V1]} activeVersionId="v2" />)

    expect(screen.getByText("v2")).toBeInTheDocument()
    expect(screen.getByText("v1")).toBeInTheDocument()
  })

  it("marks only the current version active, with a badge and not colour alone", () => {
    render(<VersionHistory versions={[V2, V1]} activeVersionId="v2" />)

    // One badge, on the active entry — the non-colour carrier of the state.
    expect(screen.getAllByText(/Active · COMPLETED/)).toHaveLength(1)
  })

  it("strikes through every superseded version and only those", () => {
    const { container } = render(<VersionHistory versions={[V2, V1]} activeVersionId="v2" />)

    const struck = container.querySelectorAll(".line-through")
    expect(struck).toHaveLength(1)
    expect(struck[0]).toHaveTextContent("v1")
  })

  it("marks nothing active when the Dataset has no current version", () => {
    const { container } = render(<VersionHistory versions={[V2, V1]} activeVersionId={null} />)

    expect(screen.queryByText(/Active ·/)).not.toBeInTheDocument()
    expect(container.querySelectorAll(".line-through")).toHaveLength(2)
  })

  it("never strikes through a non-active RUNNING or FAILED version — neither ever succeeded", () => {
    const running = version({ id: "v3", versionNumber: 3, status: "RUNNING", rowCount: null })
    const failed = version({ id: "v4", versionNumber: 4, status: "FAILED", rowCount: null })
    const { container } = render(
      <VersionHistory versions={[running, failed, V1]} activeVersionId={null} />,
    )

    // Only v1 (COMPLETED, non-active) was actually superseded.
    const struck = container.querySelectorAll(".line-through")
    expect(struck).toHaveLength(1)
    expect(struck[0]).toHaveTextContent("v1")
  })

  it("badges a non-active RUNNING or FAILED version with its own status, not an Active label", () => {
    const running = version({ id: "v3", versionNumber: 3, status: "RUNNING", rowCount: null })
    const failed = version({ id: "v4", versionNumber: 4, status: "FAILED", rowCount: null })
    render(<VersionHistory versions={[running, failed]} activeVersionId={null} />)

    expect(screen.getByText("RUNNING")).toBeInTheDocument()
    expect(screen.getByText("FAILED")).toBeInTheDocument()
    expect(screen.queryByText(/Active ·/)).not.toBeInTheDocument()
  })
})
