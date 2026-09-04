// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { DatasetDetail } from "@/modules/datasets"
import type * as Datasets from "@/modules/datasets"
import type { ImportView } from "@/modules/imports"
import type * as Imports from "@/modules/imports"
import { AppError } from "@/shared/errors"

const getDatasetDetailMock = vi.fn<(context: unknown, id: string) => Promise<DatasetDetail>>()
vi.mock("@/modules/datasets", async (importOriginal) => ({
  ...(await importOriginal<typeof Datasets>()),
  getDatasetDetail: (context: unknown, id: string) => getDatasetDetailMock(context, id),
}))

const findOpenImportForDatasetMock =
  vi.fn<(context: unknown, datasetId: string) => Promise<ImportView | undefined>>()
vi.mock("@/modules/imports", async (importOriginal) => ({
  ...(await importOriginal<typeof Imports>()),
  findOpenImportForDataset: (context: unknown, datasetId: string) =>
    findOpenImportForDatasetMock(context, datasetId),
}))

const resolveActiveContextMock = vi.fn<() => Promise<unknown>>()
vi.mock("../../active-context", () => ({
  resolveActiveContext: () => resolveActiveContextMock(),
}))

const notFoundMock = vi.fn<() => never>(() => {
  throw new Error("NEXT_NOT_FOUND")
})
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}))

vi.mock("./dataset-header", () => ({
  DatasetHeader: ({ canAddVersion }: { canAddVersion: boolean }) => (
    <div data-testid="dataset-header" data-can-add-version={canAddVersion} />
  ),
}))

vi.mock("./open-import-banner", () => ({
  OpenImportBanner: ({ view }: { view: ImportView }) => (
    <div data-testid="open-import-banner">{view.phase}</div>
  ),
}))

vi.mock("./version-history", () => ({
  VersionHistory: () => <div data-testid="version-history" />,
}))

vi.mock("@/components/data/dataset-schema-table", () => ({
  DatasetSchemaTable: () => <div data-testid="schema-table" />,
}))

vi.mock("@/components/data/dataset-preview-table", () => ({
  DatasetPreviewTable: () => <div data-testid="preview-table" />,
}))

vi.mock("./query-panel", () => ({
  QueryPanel: () => <div data-testid="query-panel" />,
}))

import DatasetDetailPage from "./page"

const CONTEXT = { organizationId: "org-1", organizationTimezone: "UTC", role: "editor" }

const VERSION = {
  id: "v1",
  versionNumber: 1,
  status: "COMPLETED",
  rowCount: 1_000,
  columnCount: 3,
  timezoneUsedForNaiveTimestamps: "UTC",
  createdAt: new Date("2026-01-01T00:00:00Z"),
}

function detail(overrides: Partial<DatasetDetail> = {}): DatasetDetail {
  return {
    dataset: {
      id: "ds-1",
      name: "Transactions",
      description: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      currentVersion: VERSION,
    },
    versions: [VERSION],
    columns: [],
    previewRows: [],
    previewUnavailable: null,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  getDatasetDetailMock.mockReset()
  findOpenImportForDatasetMock.mockReset()
  resolveActiveContextMock.mockReset()
  notFoundMock.mockClear()
})

describe("DatasetDetailPage", () => {
  it("renders nothing while no workspace is active", async () => {
    resolveActiveContextMock.mockResolvedValue("no-active-organization")

    const result = await DatasetDetailPage({ params: Promise.resolve({ id: "ds-1" }) })

    expect(result).toBeNull()
  })

  it("calls notFound() for a foreign or missing Dataset", async () => {
    resolveActiveContextMock.mockResolvedValue(CONTEXT)
    getDatasetDetailMock.mockRejectedValue(new AppError("NOT_FOUND", "Dataset not found."))

    await expect(DatasetDetailPage({ params: Promise.resolve({ id: "ds-1" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )
  })

  it("shows the open-import banner when the Dataset has an open import", async () => {
    resolveActiveContextMock.mockResolvedValue(CONTEXT)
    getDatasetDetailMock.mockResolvedValue(detail())
    findOpenImportForDatasetMock.mockResolvedValue({
      importId: "imp-1",
      datasetId: "ds-1",
      originalFilename: "transactions.csv",
      createdAt: new Date("2026-01-02T00:00:00Z"),
      phase: "profiling",
    })

    render(await DatasetDetailPage({ params: Promise.resolve({ id: "ds-1" }) }))

    expect(screen.getByTestId("open-import-banner")).toHaveTextContent("profiling")
  })

  it("shows no banner when the Dataset has no open import", async () => {
    resolveActiveContextMock.mockResolvedValue(CONTEXT)
    getDatasetDetailMock.mockResolvedValue(detail())
    findOpenImportForDatasetMock.mockResolvedValue(undefined)

    render(await DatasetDetailPage({ params: Promise.resolve({ id: "ds-1" }) }))

    expect(screen.queryByTestId("open-import-banner")).not.toBeInTheDocument()
  })

  it("gates Add-a-version on dataset:manage, which a viewer does not hold", async () => {
    resolveActiveContextMock.mockResolvedValue({ ...CONTEXT, role: "viewer" })
    getDatasetDetailMock.mockResolvedValue(detail())
    findOpenImportForDatasetMock.mockResolvedValue(undefined)

    render(await DatasetDetailPage({ params: Promise.resolve({ id: "ds-1" }) }))

    expect(screen.getByTestId("dataset-header")).toHaveAttribute("data-can-add-version", "false")
  })

  it("grants Add-a-version to an editor, who holds dataset:manage", async () => {
    resolveActiveContextMock.mockResolvedValue(CONTEXT)
    getDatasetDetailMock.mockResolvedValue(detail())
    findOpenImportForDatasetMock.mockResolvedValue(undefined)

    render(await DatasetDetailPage({ params: Promise.resolve({ id: "ds-1" }) }))

    expect(screen.getByTestId("dataset-header")).toHaveAttribute("data-can-add-version", "true")
  })

  it("shows the open-import banner even with no current version yet (H4)", async () => {
    resolveActiveContextMock.mockResolvedValue(CONTEXT)
    getDatasetDetailMock.mockResolvedValue(
      detail({ dataset: { ...detail().dataset, currentVersion: null } }),
    )
    findOpenImportForDatasetMock.mockResolvedValue({
      importId: "imp-1",
      datasetId: "ds-1",
      originalFilename: "transactions.csv",
      createdAt: new Date("2026-01-02T00:00:00Z"),
      phase: "failed",
      errorCode: "VALIDATION",
      errorMessage: "The file exceeded the row ceiling.",
    })

    render(await DatasetDetailPage({ params: Promise.resolve({ id: "ds-1" }) }))

    expect(screen.getByTestId("open-import-banner")).toHaveTextContent("failed")
    expect(
      screen.queryByText(
        "This Dataset has no current version. An import that never completed leaves it here.",
      ),
    ).not.toBeInTheDocument()
  })
})
