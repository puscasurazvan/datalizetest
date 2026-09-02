/**
 * Object keys for uploaded CSVs (src/modules/storage/CLAUDE.md, docs/decisions/06 #8).
 *
 * Keys are SERVER-GENERATED, shaped `org/{organizationId}/uploads/{uuid}.csv`.
 * `ObjectKey` has a private constructor, so the only way to obtain one is
 * `ObjectKey.forOrganization` (mints a fresh key) or `ObjectKey.parse`
 * (validates a raw string against a specific `organizationId` before
 * constructing). Both are `static`, which is what earns them access to the
 * private constructor — there is no other exported path to an `ObjectKey`,
 * so a client-supplied string cannot become one without first surviving
 * `ObjectKey.parse`.
 *
 * `value` is backed by an ES private `#value` field (not just a `private
 * constructor` parameter property) so the class is nominally typed: a
 * `private constructor` only restricts `new ObjectKey(...)` and assignment
 * of the *class*, not the *instance* type, so without the private field a
 * plain `{ value: "..." }` object literal would still structurally match
 * `{ readonly value: string }` and be assignable to `ObjectKey` with no
 * cast — bypassing `ObjectKey.parse` entirely. Mirrors `PresignedUploadUrl`
 * (./provider.ts), the sibling branded type in this module.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// `[^/]+` for the organization segment can never itself contain a `/`, so a
// path-traversal attempt like `org/../uploads/x.csv` is only ever compared
// as the literal organization id `..` against the caller's real one — it
// cannot smuggle in extra path segments.
const OBJECT_KEY_PATTERN = /^org\/([^/]+)\/uploads\/([^/]+)\.csv$/

export type ObjectKeyParseResult =
  | { readonly ok: true; readonly key: ObjectKey }
  | { readonly ok: false; readonly reason: string }

export class ObjectKey {
  #value: string

  private constructor(value: string) {
    this.#value = value
  }

  get value(): string {
    return this.#value
  }

  /** Mints a fresh, server-generated key for a new upload. */
  static forOrganization(organizationId: string): ObjectKey {
    assertValidOrganizationId(organizationId)
    return new ObjectKey(`org/${organizationId}/uploads/${crypto.randomUUID()}.csv`)
  }

  /**
   * Validates a raw string against the shape SERVER-GENERATED keys have,
   * and against the specific `organizationId` the caller expects to own
   * it. This is the only way to turn a `string` into an `ObjectKey` — call
   * it on every key that arrives from outside the server (a request body,
   * a job payload, a stored record read back).
   */
  static parse(raw: string, organizationId: string): ObjectKeyParseResult {
    const match = OBJECT_KEY_PATTERN.exec(raw)
    if (match === null) {
      return { ok: false, reason: "key does not match org/{organizationId}/uploads/{uuid}.csv" }
    }

    const keyOrganizationId = match[1]
    const uuid = match[2]
    if (keyOrganizationId === undefined || uuid === undefined) {
      return { ok: false, reason: "key does not match org/{organizationId}/uploads/{uuid}.csv" }
    }

    if (!UUID_PATTERN.test(uuid)) {
      return { ok: false, reason: "upload segment is not a lowercase UUID" }
    }

    if (keyOrganizationId !== organizationId) {
      return { ok: false, reason: "key belongs to a different organization" }
    }

    return { ok: true, key: new ObjectKey(raw) }
  }
}

function assertValidOrganizationId(organizationId: string): void {
  if (organizationId.length === 0 || organizationId.includes("/")) {
    throw new Error("organizationId must be non-empty and must not contain '/'")
  }
}
