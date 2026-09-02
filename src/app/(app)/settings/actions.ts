"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { assertCan } from "@/modules/auth/policy"
import { toPolicyContext, updateOrganizationTimezone } from "@/modules/organizations"
import { createRequestContext } from "@/shared/context/request-context"
import { toSafeDto } from "@/shared/errors"
import type { ActionResult } from "@/shared/validation/action-result"
import { formErrorsFromZod } from "@/shared/validation/zod-form"

const updateTimezoneSchema = z.object({
  // Real validation is `assertKnownTimezone` in the organizations service,
  // against the curated canonical-IANA-zone allowlist in
  // `canonical-timezones.ts` (docs/decisions/03/04) — this only rejects an
  // empty submission before that round trip.
  timezone: z.string().min(1, "Choose a timezone"),
})

/**
 * Updates the active workspace's timezone. The organization to update is
 * `createRequestContext().organizationId` — re-verified server-side
 * membership, never a value read off the submitted form — so a client can
 * never point this action at a workspace the caller doesn't belong to.
 */
export async function updateTimezoneAction(
  _prevState: ActionResult<{ timezone: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ timezone: string }>> {
  try {
    const context = await createRequestContext()

    const parsed = updateTimezoneSchema.safeParse({ timezone: formData.get("timezone") })
    if (!parsed.success) {
      const { formError, fieldErrors } = formErrorsFromZod(parsed.error)
      return { ok: false, formError: formError ?? "Check the form and try again.", fieldErrors }
    }

    assertCan(toPolicyContext(context), "organization:update")

    await updateOrganizationTimezone(context.organizationId, parsed.data.timezone)

    revalidatePath("/settings")

    return { ok: true, data: { timezone: parsed.data.timezone } }
  } catch (error) {
    const safe = toSafeDto(error)
    return { ok: false, formError: safe.message, fieldErrors: {} }
  }
}
