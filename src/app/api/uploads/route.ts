/**
 * Presign route handler (docs/decisions/06 #7-8): mints a server-generated
 * `ObjectKey` and a short-lived presigned PUT target for the client to
 * upload a CSV directly to object storage. Never accepts a client-supplied
 * key (src/modules/storage/object-key.ts — a client-suppliable key is
 * exactly what that module exists to make impossible), and never itself
 * touches the file's bytes — the browser PUTs directly to `url`.
 *
 * This route only mints the target. Creating the `imports` row and
 * dispatching `import.profile` happens once the client's PUT to `url`
 * completes, via `startImportAction` (src/modules/imports/start-action.ts)
 * — see that file for why the two are split.
 */
import { NextResponse } from "next/server"

import { assertCan } from "@/modules/auth/policy"
import { toPolicyContext } from "@/modules/organizations"
import { getStorageProvider } from "@/modules/storage"
import { createRequestContext } from "@/shared/context/request-context"
import { AppError, statusForErrorCode, toSafeDto } from "@/shared/errors"

export async function POST(): Promise<NextResponse> {
  try {
    const context = await createRequestContext()
    // Authorize before minting a target (src/app/CLAUDE.md's chain): the
    // same permission `startImport` requires to create a new Dataset — a
    // viewer should not be able to fill storage with objects it can never
    // turn into an import.
    assertCan(toPolicyContext(context), "dataset:create")
    const target = await getStorageProvider().createUploadTarget(context.organizationId)

    // getStorageProvider() (src/modules/storage/index.ts) silently falls
    // back to InMemoryStorageProvider when no STORAGE_* variable is set —
    // a fresh clone or CI, deliberately, so `pnpm test` needs no S3. Its
    // upload URL is `memory://<key>`, which no browser can PUT to. Refusing
    // it here turns a bare fetch TypeError in the upload dialog into a
    // legible error naming the actual cause.
    const url = target.url.reveal()
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new AppError(
        "VALIDATION",
        "File uploads are not configured for this environment. Set the STORAGE_* " +
          "environment variables (see .env.example) and restart the server.",
      )
    }

    return NextResponse.json({
      key: target.key.value,
      url: target.url.reveal(),
      maxSizeBytes: target.maxSizeBytes,
      expiresAt: target.expiresAt.toISOString(),
    })
  } catch (error) {
    const safe = toSafeDto(error)
    const status = statusForErrorCode(safe.code)
    return NextResponse.json(safe, { status })
  }
}
