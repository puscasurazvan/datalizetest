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
        "block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  )
}
