import type { LabelHTMLAttributes } from "react"

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>

/**
 * A real `<label>`. Every caller must pass `htmlFor` matching the
 * control's `id` — the linter can't see that through a generic primitive's
 * spread props, so it's enforced by convention here and reviewed at each
 * call site instead.
 */
export function Label({ className = "", ...props }: LabelProps) {
  return (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- htmlFor is required by every call site; the rule can't see it through spread props on a generic primitive.
    <label className={`mb-1.5 block text-sm font-medium text-foreground ${className}`} {...props} />
  )
}
