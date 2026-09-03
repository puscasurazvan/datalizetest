/**
 * `import.profile` (docs/decisions/06 #1). Reads the uploaded object,
 * infers a schema, enforces the three MVP ceilings, and writes
 * `imports.proposed_schema` — creating NO physical table and loading NO
 * rows. See `../CLAUDE.md` for the two-phase split this exists for.
 *
 * Two reads of the object, not one: `readHeaderAndSample(stream, 0)`
 * (../internal/csv-stream.ts) reads only the header row — near-instant,
 * regardless of file size. `streamRows` then makes the one full pass this
 * phase needs: it buffers the first 10,000 rows for `inferColumns`
 * (docs/decisions/06 #2) while continuing to iterate the rest purely so
 * its own byte/row/column ceiling checks run over the whole file — the
 * only way to know a file exceeds 1,000,000 rows or 50 MB before
 * `import.load` ever creates a physical table for it (the "creates no
 * physical table" guarantee this phase exists to keep).
 */
import { readHeaderAndSample, streamRows } from "./csv-stream"
import { inferColumns } from "./inference"
import type { ColumnInference } from "./inference"
import { toNodeReadable } from "./storage-stream"
import type { ProposedSchema } from "./schema-types"

import { ObjectKey } from "@/modules/storage"
import type { StorageProvider } from "@/modules/storage"
import type { RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

import {
  getImportForContext,
  markImportFailed,
  markImportStatus,
  recordProposedSchema,
} from "../repository/import-repository"
import type { ImportRow } from "../repository/import-repository"

const SAMPLE_SIZE = 10_000

export type ProfileImportDeps = {
  readonly storage: StorageProvider
}

/** Statuses from which profiling may run — anything else means profiling already happened or is moot. */
const PROFILABLE_STATUSES = new Set(["PENDING", "QUEUED", "PROFILING"])

/**
 * Whether a Trigger.dev retry of this import may re-run profiling.
 *
 * `PROFILABLE_STATUSES` alone used to leave a retry-driven no-op: a
 * transient failure (e.g. a dropped S3 body) took the non-`AppError`
 * branch below, which calls `markImportFailed` (committing `status:
 * "FAILED"`) and then rethrows so Trigger.dev retries — but `"FAILED"` was
 * never in `PROFILABLE_STATUSES`, so every retry attempt returned
 * immediately, Trigger.dev reported the task as having succeeded, and the
 * import was stuck at FAILED forever for what was a transient error.
 * `loadImport` (./load.ts) already re-runs through a `FAILED` row on
 * retry — this brings profiling's retry semantics in line with load's,
 * without also letting a retry of a load-phase failure (a `FAILED` import
 * with a `confirmedSchema` already recorded and, possibly, rows already
 * COPYing) clobber that state by re-profiling: profiling only ever applies
 * before confirmation, so a `FAILED` row is only re-profilable while
 * `confirmedSchema` is still unset.
 */
function isProfilable(importRow: ImportRow): boolean {
  if (PROFILABLE_STATUSES.has(importRow.status)) return true
  return importRow.status === "FAILED" && importRow.confirmedSchema === null
}

export async function profileImport(
  context: RequestContext,
  importId: string,
  deps: ProfileImportDeps,
): Promise<void> {
  const importRow = await getImportForContext(context, importId)
  if (!isProfilable(importRow)) {
    return
  }

  await markImportStatus(context, importId, "PROFILING")

  const keyResult = ObjectKey.parse(importRow.objectKey, context.organizationId)
  if (!keyResult.ok) {
    await markImportFailed(
      context,
      importId,
      "INVALID_OBJECT_KEY",
      "The uploaded object's key is invalid.",
    )
    return
  }

  try {
    const proposedSchema = await buildProposedSchema(
      deps.storage,
      keyResult.key,
      importRow.byteSize,
    )
    await recordProposedSchema(context, importId, proposedSchema, proposedSchema.rowsRead)
  } catch (error) {
    if (error instanceof AppError) {
      await markImportFailed(context, importId, error.code, error.message)
      return
    }
    await markImportFailed(context, importId, "INTERNAL", "Profiling failed unexpectedly.")
    throw error
  }
}

async function buildProposedSchema(
  storage: StorageProvider,
  key: ObjectKey,
  byteSize: number,
): Promise<ProposedSchema> {
  const header = await readHeader(storage, key)

  // Rejected here, before the user is ever asked to confirm anything: a
  // genuinely empty (zero-byte) upload has no header row at all, so
  // `inferColumns([], [])` returns zero columns, and — left unchecked —
  // the pipeline would carry that all the way to a zero-column physical
  // table and a Dataset Version marked COMPLETED with rowCount 0,
  // columnCount 0: a "successful" import of a dataset that can never be
  // queried. (A whitespace-only or single-blank-line upload is a
  // different case — csv-stream.ts's `skip_empty_lines` skips a truly
  // blank line, but a line of only spaces parses as one header cell,
  // renamed to `column_1` by inference.ts's blank-header handling — not
  // caught by this check, since `header.length` is 1, not 0.)
  // `import.load` (./load.ts) keeps its own defensive guard for a
  // confirmed schema that somehow still has no columns, but this is the
  // one place the user actually sees the rejection.
  if (header.length === 0) {
    throw new AppError("VALIDATION", "The uploaded file has no columns to import.")
  }

  const { sampleRows, rowsRead, rowsWithBadFieldCount } = await readSampleAndEnforceCeilings(
    storage,
    key,
    byteSize,
  )

  const columns: readonly ColumnInference[] = inferColumns(header, sampleRows)

  return {
    rowsRead,
    rowsWithBadFieldCount,
    columns: columns.map(toProposedSchemaColumn),
  }
}

function toProposedSchemaColumn(column: ColumnInference): ProposedSchema["columns"][number] {
  const base = {
    position: column.position,
    name: column.name,
    originalHeader: column.originalHeader,
    headerRenamed: column.headerRenamed,
    headerIssues: [...column.headerIssues],
    type: column.type,
    nullable: column.nullable,
    unparseableCount: column.unparseableCount,
  }
  if (column.datetimeOffset === undefined) {
    return base
  }
  return { ...base, datetimeOffset: column.datetimeOffset }
}

async function readHeader(storage: StorageProvider, key: ObjectKey): Promise<readonly string[]> {
  const stream = await storage.readObject(key)
  if (stream === undefined) {
    throw new AppError("NOT_FOUND", "The uploaded file could not be found in storage.")
  }
  const { header } = await readHeaderAndSample(toNodeReadable(stream), 0)
  return header
}

async function readSampleAndEnforceCeilings(
  storage: StorageProvider,
  key: ObjectKey,
  byteSize: number,
): Promise<{
  sampleRows: readonly (readonly string[])[]
  rowsRead: number
  rowsWithBadFieldCount: number
}> {
  const stream = await storage.readObject(key)
  if (stream === undefined) {
    throw new AppError("NOT_FOUND", "The uploaded file could not be found in storage.")
  }

  const rows = streamRows(toNodeReadable(stream), { knownTotalBytes: byteSize })
  const sampleRows: (readonly string[])[] = []

  for await (const row of rows) {
    if (sampleRows.length < SAMPLE_SIZE) {
      sampleRows.push(row)
    }
  }

  return {
    sampleRows,
    rowsRead: rows.counts.rowsRead,
    rowsWithBadFieldCount: rows.counts.rowsWithBadFieldCount,
  }
}
