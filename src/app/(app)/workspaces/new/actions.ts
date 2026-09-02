"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { z } from "zod"

import { auth } from "@/modules/auth"
import { createOrganizationForUser, type OrganizationSummary } from "@/modules/organizations"
import { AppError, toSafeDto } from "@/shared/errors"
import type { ActionResult } from "@/shared/validation/action-result"
import { formErrorsFromZod } from "@/shared/validation/zod-form"

const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workspace name is required")
    .max(100, "Keep it under 100 characters"),
})

/**
 * Creates a workspace ("Organization" in code — CONTEXT.md) for the
 * signed-in user. There is no existing organization to scope an
 * `assertCan` check against: the whole point of this action is that the
 * caller doesn't have one yet. Authorization here is Better Auth's own
 * `allowUserToCreateOrganization`, left at its default ("any authenticated
 * user may create an organization") in src/modules/auth/auth.ts — the
 * Datalize role/permission matrix (docs/decisions/06 #13) only governs what
 * a member may do *inside* an organization they already belong to.
 */
export async function createWorkspaceAction(
  _prevState: ActionResult<OrganizationSummary> | null,
  formData: FormData,
): Promise<ActionResult<OrganizationSummary>> {
  try {
    const requestHeaders = await headers()
    const session = await auth.api.getSession({ headers: requestHeaders })
    if (!session) {
      throw new AppError("UNAUTHENTICATED", "You must be signed in.")
    }

    const parsed = createWorkspaceSchema.safeParse({ name: formData.get("name") })
    if (!parsed.success) {
      const { formError, fieldErrors } = formErrorsFromZod(parsed.error)
      return { ok: false, formError: formError ?? "Check the form and try again.", fieldErrors }
    }

    const organization = await createOrganizationForUser(parsed.data.name, requestHeaders)

    // The new organization changes what every route under the (app) layout
    // renders (onboarding -> shell, and the workspace switcher's list) —
    // revalidate from the layout down rather than one page.
    revalidatePath("/", "layout")

    return { ok: true, data: organization }
  } catch (error) {
    const safe = toSafeDto(error)
    return { ok: false, formError: safe.message, fieldErrors: {} }
  }
}
