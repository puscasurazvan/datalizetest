import type { ButtonHTMLAttributes } from "react"

const VARIANT_CLASSES = {
  primary: "bg-accent text-accent-foreground hover:opacity-90",
  secondary: "border border-border bg-transparent text-foreground hover:bg-muted",
  danger: "bg-danger text-danger-foreground hover:opacity-90",
} as const

export type ButtonVariant = keyof typeof VARIANT_CLASSES

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | undefined
}

/**
 * Plain button primitive. `type="button"` by default — a form's submit
 * button must opt back in explicitly, which keeps a stray button inside a
 * form from submitting it by accident.
 */
export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  const variantClassName = VARIANT_CLASSES[variant]

  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${variantClassName} ${className}`}
      {...props}
    />
  )
}
