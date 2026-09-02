import type { SelectHTMLAttributes } from "react"

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>

/** Plain native `<select>` — full keyboard support and screen reader behavior for free. */
export function Select({ className = "", ...props }: SelectProps) {
  return (
    <select
      className={`block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      {...props}
    />
  )
}
