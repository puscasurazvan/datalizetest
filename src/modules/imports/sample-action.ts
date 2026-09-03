"use server"

/**
 * Imports one of the three committed sample CSVs, so a fresh workspace can
 * reach real data without the user having a file to hand.
 *
 * This is not a fixture loader or a seed: it runs the actual two-phase
 * pipeline — upload to storage, `import.profile`, confirm, `import.load` —
 * with no overrides, so what lands is a genuine Dataset Version produced
 * the same way a user's own upload produces one. If the pipeline is
 * broken, this is broken, which is the point.
 *
 * Profile and confirm run in the same request here rather than waiting on
 * a user's confirmation screen. That is honest for a *sample*, whose
 * schema the product already knows, and it is what makes this one click.
 * A real upload must not do this: decision 04 requires the user to see the
 * inferred types and the timezone before anything commits.
 *
 * The samples are ~1,000 rows each (tests/fixtures/README.md), which the
 * benchmark's measured throughput puts far inside a request's budget. The
 * 50 MB variants are generated, never committed, and are not reachable
 * from here.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"

import { revalidatePath } from "next/cache"

import { getJobDispatcher } from "@/modules/jobs"
import { getStorageProvider, InMemoryStorageProvider } from "@/modules/storage"
import type { UploadTarget } from "@/modules/storage"
import { createRequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

import { confirmImport } from "./internal/confirm"
import { ensureImportTasksRegistered } from "./internal/register-production-tasks"
import { startImport } from "./internal/start"

/** The three canonical fixtures, by the name the UI offers them under. */
const SAMPLES = {
  transactions_stripe: {
    filename: "transactions_stripe.csv",
    datasetName: "Stripe transactions (sample)",
  },
  customers_saaS: {
    filename: "customers_saaS.csv",
    datasetName: "Customers (sample)",
  },
  events_product: {
    filename: "events_product.csv",
    datasetName: "Product events (sample)",
  },
} as const

export type SampleId = keyof typeof SAMPLES

function isSampleId(value: string): value is SampleId {
  return Object.hasOwn(SAMPLES, value)
}

export async function importSampleAction(sampleId: string): Promise<{ datasetId: string }> {
  if (!isSampleId(sampleId)) {
    throw new AppError("VALIDATION", "Unknown sample.")
  }
  const sample = SAMPLES[sampleId]

  ensureImportTasksRegistered()
  const context = await createRequestContext()

  const storage = getStorageProvider()
  const target = await storage.createUploadTarget(context.organizationId)
  const bytes = await readFile(path.join(process.cwd(), "tests", "fixtures", sample.filename))
  await putBytes(storage, target, bytes)

  // Profile: streams, infers, and stops at AWAITING_CONFIRMATION.
  const started = await startImport(
    context,
    {
      objectKey: target.key.value,
      originalFilename: sample.filename,
      contentType: "text/csv",
      datasetName: `${sample.datasetName} ${new Date().toISOString().slice(0, 19)}`,
    },
    { storage, jobDispatcher: getJobDispatcher() },
  )

  // Confirm with no overrides — accept exactly what inference proposed.
  await confirmImport(
    context,
    { importId: started.importId },
    { jobDispatcher: getJobDispatcher() },
  )

  const datasetId = await findDatasetIdForImport(context, started.importId)
  revalidatePath("/datasets")
  return { datasetId }
}

/**
 * Stands in for the browser's PUT to the presigned URL. The in-memory
 * provider has a direct helper; a real bucket takes an actual PUT, so this
 * works against S3 too rather than only in the no-configuration path.
 */
async function putBytes(
  storage: ReturnType<typeof getStorageProvider>,
  target: UploadTarget,
  bytes: Uint8Array,
): Promise<void> {
  if (storage instanceof InMemoryStorageProvider) {
    await storage.receiveUpload(target, bytes)
    return
  }

  const response = await fetch(target.url.reveal(), {
    method: "PUT",
    // `Uint8Array.from` rather than passing `bytes` straight through: a
    // Buffer is `Uint8Array<ArrayBufferLike>`, and `BlobPart` wants
    // `ArrayBuffer` specifically. This copies rather than asserting.
    body: new Blob([Uint8Array.from(bytes)]),
    headers: { "content-type": "text/csv" },
  })
  if (!response.ok) {
    throw new Error("Could not upload the sample file to storage.")
  }
}

async function findDatasetIdForImport(
  context: Awaited<ReturnType<typeof createRequestContext>>,
  importId: string,
): Promise<string> {
  const { getImportForContext } = await import("./repository/import-repository")
  const row = await getImportForContext(context, importId)
  if (row.datasetId === null) {
    throw new Error("The sample import produced no dataset.")
  }
  return row.datasetId
}
