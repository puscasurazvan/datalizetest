import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * The design carries affordances the product has not built yet. They ship at full
 * geometry in this treatment rather than being cut, so the layout is the designed
 * layout — but they are inert, unfocusable, and never claim a value.
 *
 * Two rules go with it (DESIGN.md):
 *   - Never an `<a href>` to a route that does not exist. A dead link is worse than a
 *     disabled control, so use `<Pending>` or a real `<button disabled>`.
 *   - A readout with nothing behind it shows `NO_VALUE`, never an invented figure.
 */
export const PENDING_CLASS = "text-ink-faint opacity-50 cursor-not-allowed select-none"

/** For a readout whose value does not exist yet. */
export const NO_VALUE = "—"

export function Pending({
  children,
  reason,
  className,
}: {
  children: ReactNode
  reason: string
  className?: string | undefined
}) {
  return (
    <span aria-disabled="true" title={reason} className={cn(PENDING_CLASS, className)}>
      {children}
    </span>
  )
}
