// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ActionResult } from "@/shared/validation/action-result"
import { MAX_UPLOAD_BYTES } from "@/modules/storage/provider"

interface FetchResult {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

const pushMock = vi.fn<(href: string) => void>()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}))

const startImportActionMock =
  vi.fn<(input: unknown) => Promise<ActionResult<{ importId: string }>>>()
vi.mock("@/modules/imports/start-action", () => ({
  startImportAction: (input: unknown) => startImportActionMock(input),
}))

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<FetchResult>>()
vi.stubGlobal("fetch", fetchMock)

import { ImportCsvButton } from "./import-csv-button"

afterEach(() => {
  cleanup()
  pushMock.mockReset()
  startImportActionMock.mockReset()
  fetchMock.mockReset()
})

const PRESIGN_TARGET = {
  key: "org/org_1/uploads/generated.csv",
  url: "http://localhost:9000/datalize-uploads/org/org_1/uploads/generated.csv",
  maxSizeBytes: MAX_UPLOAD_BYTES,
  expiresAt: "2026-01-01T00:15:00.000Z",
}

function okResponse(body: unknown): FetchResult {
  return { ok: true, status: 200, json: () => Promise.resolve(body) }
}

function makeCsvFile(name = "sales.csv"): File {
  return new File(["id,amount\n1,10\n"], name, { type: "text/csv" })
}

/** Overrides `size` without allocating a real oversized buffer. */
function withSize(file: File, sizeBytes: number): File {
  Object.defineProperty(file, "size", { value: sizeBytes })
  return file
}

/** The dropzone's `<label>` names the input, so this is the accessible query for it. */
function csvInput(): HTMLElement {
  return screen.getByLabelText(/drop a csv here/i)
}

/**
 * `user.upload` cannot drive a drop. RTL's `createEvent` copies `dataTransfer`
 * straight off the init object, which is the only way to carry files in jsdom —
 * it has no `DataTransfer` constructor.
 */
function dropFile(file: File) {
  const zone = screen.getByTestId("csv-dropzone")
  fireEvent.dragOver(zone, { dataTransfer: { files: [file], types: ["Files"] } })
  fireEvent.drop(zone, { dataTransfer: { files: [file], types: ["Files"] } })
}

async function openDialog(name: RegExp) {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name }))
  return user
}

describe("ImportCsvButton", () => {
  it("refuses an oversized file before any fetch, and never presigns for it", async () => {
    render(<ImportCsvButton />)
    const user = await openDialog(/import csv/i)

    const oversized = withSize(makeCsvFile(), MAX_UPLOAD_BYTES + 1)
    const fileInput = csvInput()
    await user.upload(fileInput, oversized)

    expect(screen.getByRole("alert")).toHaveTextContent(
      '"sales.csv" is larger than the 50 MB limit. Choose a smaller file.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(startImportActionMock).not.toHaveBeenCalled()
  })

  it("accepts a dropped CSV and names it in the zone", async () => {
    render(<ImportCsvButton />)
    await openDialog(/import csv/i)

    dropFile(makeCsvFile("dropped.csv"))

    expect(screen.getByText("dropped.csv")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("refuses a dropped non-CSV — the `accept` attribute never sees a drop", async () => {
    render(<ImportCsvButton />)
    await openDialog(/import csv/i)

    dropFile(new File(["\u0089PNG"], "chart.png", { type: "image/png" }))

    expect(screen.getByRole("alert")).toHaveTextContent(
      '"chart.png" is not a CSV. Datalize reads .csv files only.',
    )
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("recovers to an enabled Import button when the presign fetch itself rejects", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))

    render(<ImportCsvButton />)
    const user = await openDialog(/import csv/i)
    await user.upload(csvInput(), makeCsvFile())
    await user.click(screen.getByRole("button", { name: "Import" }))

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The upload could not be started. Check your connection and try again.",
      ),
    )
    // The regression this pins: without an outer catch, `phase` stays on
    // "presigning" forever and this button is stuck disabled reading
    // "Preparing upload…" with no way for the user to retry.
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled()
    expect(startImportActionMock).not.toHaveBeenCalled()
  })

  it("surfaces a 403 from the presign route without attempting the PUT", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ code: "FORBIDDEN", message: "You cannot create Datasets." }),
    })

    render(<ImportCsvButton />)
    const user = await openDialog(/import csv/i)
    await user.upload(csvInput(), makeCsvFile())
    await user.click(screen.getByRole("button", { name: "Import" }))

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("You cannot create Datasets."),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(startImportActionMock).not.toHaveBeenCalled()
  })

  it("names the likely local cause when the PUT to storage fails outright, and never calls startImportAction", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(PRESIGN_TARGET))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))

    render(<ImportCsvButton />)
    const user = await openDialog(/import csv/i)
    await user.upload(csvInput(), makeCsvFile())
    await user.click(screen.getByRole("button", { name: "Import" }))

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/could not reach object storage/i),
    )
    expect(screen.getByRole("alert")).toHaveTextContent(/minio/i)
    expect(startImportActionMock).not.toHaveBeenCalled()
  })

  it("renders the action's ok:false formError in role=alert", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(PRESIGN_TARGET))
      .mockResolvedValueOnce(okResponse({}))
    startImportActionMock.mockResolvedValue({
      ok: false,
      formError: "This import is not awaiting confirmation.",
      fieldErrors: {},
    })

    render(<ImportCsvButton />)
    const user = await openDialog(/import csv/i)
    await user.upload(csvInput(), makeCsvFile())
    await user.click(screen.getByRole("button", { name: "Import" }))

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This import is not awaiting confirmation.",
      ),
    )
    expect(pushMock).not.toHaveBeenCalled()
  })

  it("navigates to /imports/{id} on success", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(PRESIGN_TARGET))
      .mockResolvedValueOnce(okResponse({}))
    startImportActionMock.mockResolvedValue({ ok: true, data: { importId: "imp_123" } })

    render(<ImportCsvButton />)
    const user = await openDialog(/import csv/i)
    await user.upload(csvInput(), makeCsvFile())
    await user.click(screen.getByRole("button", { name: "Import" }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/imports/imp_123"))
    expect(startImportActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: PRESIGN_TARGET.key, datasetName: "sales" }),
    )
  })

  it("adds a version to the given Dataset instead of asking for a name", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(PRESIGN_TARGET))
      .mockResolvedValueOnce(okResponse({}))
    startImportActionMock.mockResolvedValue({ ok: true, data: { importId: "imp_456" } })

    render(<ImportCsvButton datasetId="dataset_1" />)
    const user = await openDialog(/add a version/i)

    expect(screen.queryByLabelText("Dataset name")).not.toBeInTheDocument()

    await user.upload(csvInput(), makeCsvFile())
    await user.click(screen.getByRole("button", { name: "Import" }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/imports/imp_456"))
    expect(startImportActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: PRESIGN_TARGET.key, datasetId: "dataset_1" }),
    )
  })
})
