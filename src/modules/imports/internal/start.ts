/**
 * Starts an import: validates the uploaded object, creates (or reuses) a
 * Dataset, persists the `imports` row, and dispatches `import.profile`
 * (docs/decisions/02(a): every upload is a new Dataset by default; an
 * explicit `datasetId` is the "add new version" action). The row is
 * persisted and committed BEFORE `enqueue` is ever called (jobs/CLAUDE.md
 * "Ordering").
 *
 * Idempotency (docs/decisions/06 #7): the key is derived from the
 * server-minted object key plus the target dataset (`datasetId`, or the
 * literal `"new"` when creating one) — never from anything the client
 * supplies. A fresh dataset has no id yet when this key is derived, so the
 * dataset row and the import row are created in ONE transaction: if a
 * concurrent duplicate call already won the idempotency key, this
 * transaction's unique-violation rolls back its own dataset insert too,
 * rather than leaving an orphaned dataset with no import pointing at it.
 */
import { randomUUID } from "node:crypto"

import { z } from "zod"

import { db } from "@/db/client"
import { datasets, imports } from "@/db/schema"
import { assertCan } from "@/modules/auth/policy"
import { toPolicyContext } from "@/modules/organizations"
import { MAX_UPLOAD_BYTES, ObjectKey } from "@/modules/storage"
import type { StorageProvider } from "@/modules/storage"
import type { JobDispatcher } from "@/modules/jobs"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"
import { withOrganizationId } from "@/shared/repository"

import { deriveImportIdempotencyKey } from "./idempotency"
import { findDatasetForContext } from "../repository/dataset-version-repository"
import {
  findImportByIdempotencyKey,
  markImportStatus,
  recordJobRunId,
} from "../repository/import-repository"

export const startImportInputSchema = z.strictObject({
  objectKey: z.string().min(1),
  originalFilename: z.string().min(1),
  contentType: z.string().min(1),
  /** Omit to create a new Dataset (docs/decisions/02(a)'s default); set to add a version to an existing one. */
  datasetId: z.string().min(1).optional(),
  /** Required when `datasetId` is omitted — the name of the Dataset being created. */
  datasetName: z.string().min(1).optional(),
})
export type StartImportInput = z.infer<typeof startImportInputSchema>

export type StartImportDeps = {
  readonly storage: StorageProvider
  readonly jobDispatcher: JobDispatcher
}

export type StartImportResult = { readonly importId: string }

const IDEMPOTENCY_CONSTRAINT = "imports_organization_idempotency_key_idx"

export async function startImport(
  context: RequestContext,
  input: StartImportInput,
  deps: StartImportDeps,
): Promise<StartImportResult> {
  const keyResult = ObjectKey.parse(input.objectKey, context.organizationId)
  if (!keyResult.ok) {
    throw new AppError("VALIDATION", `Invalid object key: ${keyResult.reason}`)
  }

  await assertDatasetPermission(context, input.datasetId)

  const idempotencyKey = deriveImportIdempotencyKey(keyResult.key.value, input.datasetId ?? "new")
  const existing = await findImportByIdempotencyKey(context, idempotencyKey)
  if (existing) {
    return { importId: existing.id }
  }

  // The authoritative size check (src/modules/storage/s3.ts: "the
  // authoritative check happens after the upload completes, via
  // statObject"), and confirms the object actually exists before an import
  // row is ever created for it.
  const stat = await deps.storage.statObject(keyResult.key)
  if (stat === undefined) {
    throw new AppError("NOT_FOUND", "The uploaded file was not found in storage.")
  }

  // The check s3.ts's comment above promises actually happens here — a
  // presigned PUT cannot bound the upload's size itself (s3.ts's own doc),
  // so this is the first point in the pipeline able to enforce the 50 MB
  // ceiling at all, and the cheapest: one HEAD request already made,
  // versus `import.profile` discovering the same rejection only after
  // streaming the whole oversized object out of storage. Naming the bound
  // and the measured size here, before any row is written, is exactly
  // docs/decisions/01's "Ceiling Conflict — Resolved" requirement.
  //
  // The oversized object itself is NOT deleted from storage on this
  // rejection — it is left for a retention sweep / bucket lifecycle rule
  // (the same mechanism `docs/decisions/06 #16`'s reconciler doc already
  // assumes exists), not deleted inline here. No `imports` row ever
  // points at it, so nothing downstream can act on it either way.
  if (stat.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new AppError(
      "IMPORT_LIMIT_EXCEEDED",
      `File exceeds the ${MAX_UPLOAD_BYTES}-byte limit (measured ${stat.sizeBytes} bytes).`,
    )
  }

  const datasetId = input.datasetId ?? randomUUID()
  const importId = randomUUID()

  try {
    await db.transaction(async (tx) => {
      if (input.datasetId === undefined) {
        if (input.datasetName === undefined || input.datasetName.trim() === "") {
          throw new AppError("VALIDATION", "datasetName is required when creating a new dataset.")
        }
        await tx.insert(datasets).values(
          withOrganizationId(context, {
            id: datasetId,
            name: input.datasetName,
            createdByUserId: context.userId,
          }),
        )
      }

      await tx.insert(imports).values(
        withOrganizationId(context, {
          id: importId,
          datasetId,
          idempotencyKey,
          objectKey: keyResult.key.value,
          originalFilename: input.originalFilename,
          contentType: input.contentType,
          byteSize: stat.sizeBytes,
          createdByUserId: context.userId,
          status: "PENDING",
        }),
      )
    })
  } catch (error) {
    if (isUniqueViolationOn(error, IDEMPOTENCY_CONSTRAINT)) {
      const raceWinner = await findImportByIdempotencyKey(context, idempotencyKey)
      if (raceWinner !== undefined) {
        return { importId: raceWinner.id }
      }
    }
    throw error
  }

  await markImportStatus(context, importId, "QUEUED")
  const jobReference = await deps.jobDispatcher.enqueue(
    "IMPORT_PROFILE",
    { importId },
    { idempotencyKey: importId },
  )
  await recordJobRunId(context, importId, jobReference.runId)

  return { importId }
}

async function assertDatasetPermission(
  context: RequestContext,
  datasetId: string | undefined,
): Promise<void> {
  const policyContext = toPolicyContext(context)

  if (datasetId === undefined) {
    assertCan(policyContext, "dataset:create")
    return
  }

  const dataset = await findDatasetForContext(context, datasetId)
  if (dataset === undefined) {
    throw new AppError("NOT_FOUND", "Dataset not found.")
  }
  assertCan(policyContext, "dataset:manage")
}

function isUniqueViolationOn(error: unknown, constraintName: string): boolean {
  if (!(error instanceof Error) || error.cause === undefined || error.cause === null) {
    return false
  }
  const cause = error.cause
  if (typeof cause !== "object") {
    return false
  }
  return "constraint" in cause && cause.constraint === constraintName
}
