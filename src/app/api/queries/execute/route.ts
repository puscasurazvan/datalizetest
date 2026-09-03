/**
 * The one place interactive query execution runs (src/app/CLAUDE.md) — a
 * Route Handler, not a Server Action, because Server Actions dispatched
 * from the client are serialised per client, which would also make
 * `execute-query.ts`'s five-slot advisory lock pointless (decisions/05).
 *
 * `assertCan("query:execute")` happens inside `executeQuery` itself
 * (datasets/service.ts precedent) — this handler only shapes the chain
 * around it: context, parse, call, safe DTO.
 */
import { NextResponse } from "next/server"

import { executeQuery, queryAstSchema } from "@/modules/queries"
import { createRequestContext } from "@/shared/context/request-context"
import { AppError, statusForErrorCode, toSafeDto } from "@/shared/errors"

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const context = await createRequestContext()

    // A bare `.parse` would let a malformed body's ZodError escape as a
    // plain Error — toSafeDto masks that as INTERNAL/500 for what is
    // actually the client's mistake. safeParse keeps it a VALIDATION/400.
    const parsed = queryAstSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw new AppError("VALIDATION", "This query is not well-formed.", {
        internal: { issues: parsed.error.issues },
      })
    }

    const result = await executeQuery(context, parsed.data)
    return NextResponse.json(result)
  } catch (error) {
    const safe = toSafeDto(error)
    const status = statusForErrorCode(safe.code)
    return NextResponse.json(safe, { status })
  }
}
