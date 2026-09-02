/**
 * TEST-ONLY factory for `RequestContext`. Production code (`src/app`,
 * `src/modules`, `src/db`) must never import this module — it builds a
 * context directly from caller-supplied fields, including `organizationId`,
 * with no session lookup and no membership check. The only production path
 * to a `RequestContext` is `createRequestContext()` in `./request-context`,
 * which takes no arguments and re-verifies membership against the database
 * before returning one.
 *
 * `RequestContext`'s brand key is a symbol private to `./request-context`,
 * so nothing outside that file — this one included — can construct a real
 * value of it structurally. This is the single exemption AGENTS.md's
 * "no casts" rule allows for a branded type's constructor, kept to this one
 * function and gated behind this test-only export path.
 *
 * Use from `*.test.ts` files that need a `RequestContext` to call a
 * repository or service function directly, without standing up a real
 * session and headers.
 */
import type { RequestContext } from "./request-context"

export interface TestRequestContextFields {
  userId: string
  organizationId: string
  role: string
  organizationTimezone: string
}

export function createTestRequestContext(fields: TestRequestContextFields): RequestContext {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- test-only branded-type constructor, the one exemption documented above and in AGENTS.md's "no casts" section.
  return fields as RequestContext
}
