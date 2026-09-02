import type { ZodError } from "zod"

/**
 * Turns a failed Zod parse into the two shapes a form needs to show a
 * visible error state: one message per invalid field (`fieldErrors`,
 * keyed by field name, first message wins) and a fallback message for an
 * issue with no field path to attach to (`formError`). Reads `.issues`
 * directly rather than `.flatten()` — `ZodError`'s default type parameter
 * makes `.flatten().fieldErrors` key type too loose to index safely here,
 * where the caller's schema shape isn't known.
 */
export function formErrorsFromZod(error: ZodError): {
  formError: string | undefined
  fieldErrors: Record<string, string>
} {
  const fieldErrors: Record<string, string> = {}
  let formError: string | undefined

  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field === "string") {
      fieldErrors[field] ??= issue.message
    } else if (formError === undefined) {
      formError = issue.message
    }
  }

  return { formError, fieldErrors }
}
