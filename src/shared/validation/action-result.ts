/**
 * The shape every Server Action in `src/app` returns to a form driven by
 * `useActionState`: either the safe data the caller asked for, or a form
 * error plus per-field errors to render. Never a raw thrown value — a
 * `catch` block must render it through `toSafeDto` first
 * (src/shared/errors/index.ts).
 */
export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false
      readonly formError: string
      readonly fieldErrors: Record<string, string>
    }
