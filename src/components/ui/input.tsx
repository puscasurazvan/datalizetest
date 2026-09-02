import type { InputHTMLAttributes } from "react"

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean | undefined
}

/**
 * Plain text input. Pass `invalid` (and pair it with `aria-describedby`
 * pointing at the error message) so the border and the accessibility tree
 * agree the field failed validation.
 */
export function Input({ invalid = false, className = "", ...props }: InputProps) {
  const borderClassName = invalid ? "border-danger" : "border-border"

  return (
    <input
      aria-invalid={invalid}
      className={`block w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${borderClassName} ${className}`}
      {...props}
    />
  )
}
