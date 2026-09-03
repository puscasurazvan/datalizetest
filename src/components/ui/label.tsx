"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The association is the caller's to make: every call site passes `htmlFor`
 * (or wraps its control), which is the contract this primitive forwards. The
 * rule cannot see across that boundary, so it is silenced here and enforced
 * at the call sites instead — see src/components/CLAUDE.md "Every component".
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Label }
