# src/modules/storage

## Interface (docs/reference/Datalize.md §22)

- `StorageProvider` interface (`upload`, `download`, `delete`,
  `createSignedUrl`) with an S3-compatible implementation and an in-memory
  implementation for tests.

## Object keys (docs/reference/Datalize-architecture-review.md)

- Object keys are server-generated. A client-supplied key is rejected —
  never trust a key the browser sends.

## Uploads (docs/decisions/01)

- Uploads are presigned so large files bypass the application server, with
  a size limit matching the 50 MB ceiling.
- Signed URLs expire.

## Credential hygiene (docs/reference/Datalize-architecture-review.md)

- A presigned URL is a credential. Never put one in a job payload or a
  log — job payloads carry internal IDs only.

## Retention (docs/decisions/06 #8)

- The raw uploaded file is retained until its dataset version is deleted,
  then deleted with it. Re-running a failed load requires the original
  object, so deleting on import success alone is not enough.
