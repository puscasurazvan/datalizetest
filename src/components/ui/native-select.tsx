import type { SelectHTMLAttributes } from "react"

import { cn } from "@/lib/utils"

export type NativeSelectProps = SelectHTMLAttributes<HTMLSelectElement>

/**
 * A plain native `<select>`, kept alongside shadcn's composed `Select`.
 *
 * Use this one when the list is long or the control must submit itself:
 * a native select gives OS-level type-ahead over hundreds of options, the
 * platform picker on mobile, and a real form value under a Server Action —
 * none of which a listbox built from divs provides. The timezone field
 * (313 canonical IANA zones) is the case this exists for.
 *
 * Use `Select` from ./select for short, app-shaped choices where the
 * styled trigger and popup are worth having.
 */
export function NativeSelect({ className, ...props }: NativeSelectProps) {
  return (
    <select
      className={cn(
        "block h-8 w-full rounded-lg border border-hairline-strong bg-surface-raised px-2.5 py-1 text-base text-ink transition-colors md:text-sm",
        "focus-visible:outline-none focus-visible:border-cyan focus-visible:ring-3 focus-visible:ring-cyan-solid/15",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-refused",
        className,
      )}
      {...props}
    />
  )
}
