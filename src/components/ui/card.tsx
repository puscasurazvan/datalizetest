import type { HTMLAttributes } from "react"

export type CardProps = HTMLAttributes<HTMLDivElement>

/** A bordered surface for grouping a form or a settings section. */
export function Card({ className = "", ...props }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-border bg-card p-6 shadow-sm ${className}`}
      {...props}
    />
  )
}
