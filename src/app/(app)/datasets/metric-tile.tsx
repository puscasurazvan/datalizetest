import type { LucideIcon } from "lucide-react"

import { NO_VALUE, PENDING_CLASS } from "@/components/ui/pending"
import { cn } from "@/lib/utils"

type Accent = "cyan" | "verified"

const BLOB: Record<Accent, string> = {
  cyan: "bg-cyan/10 group-hover:bg-cyan/20",
  verified: "bg-verified/10 group-hover:bg-verified/20",
}

const CHIP: Record<Accent, string> = {
  cyan: "text-cyan",
  verified: "text-verified",
}

export interface MetricTileProps {
  label: string
  /** The figure. `null` means the product cannot produce it yet. */
  value: string | null
  /** The corroborating second reading — what this figure came from. */
  source: string
  Icon: LucideIcon
  accent?: Accent | undefined
  /** Why the figure is unavailable. Required when `value` is null. */
  pendingReason?: string | undefined
}

/**
 * The design's metric tile: glass card, a blurred accent disc bleeding out of the
 * top-right corner, the figure at 40px tabular, and a footer row naming what
 * produced it. Every tile is tethered to its source — a figure with nothing
 * behind it shows an em dash rather than a number (DESIGN.md "Not built yet").
 */
export function MetricTile({
  label,
  value,
  source,
  Icon,
  accent = "cyan",
  pendingReason,
}: MetricTileProps) {
  const unavailable = value === null

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-hairline bg-surface/90 p-space-lg backdrop-blur-xl transition-colors",
        unavailable ? "" : "hover:border-cyan/40",
      )}
      {...(unavailable ? { "aria-disabled": true, title: pendingReason } : {})}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-8 -top-8 size-28 rounded-full blur-2xl transition-all",
          unavailable ? "bg-surface-high/40" : BLOB[accent],
        )}
      />
      <div className="mb-space-xs flex items-center justify-between text-label-md text-ink-muted">
        <span className="tracking-wide">{label}</span>
        <span className="rounded-lg bg-surface-highest p-space-2xs">
          <Icon
            strokeWidth={1.5}
            className={cn("size-4", unavailable ? "text-ink-faint" : CHIP[accent])}
          />
        </span>
      </div>
      <div className="flex items-baseline gap-space-sm">
        <span
          className={cn(
            "text-[40px] font-bold leading-none tracking-tight tabular-nums",
            unavailable ? PENDING_CLASS : "text-ink",
          )}
        >
          {value ?? NO_VALUE}
        </span>
      </div>
      <div className="mt-space-sm flex items-center justify-between border-t border-hairline-strong/20 pt-space-xs font-mono text-code-sm text-ink-muted">
        <span>{source}</span>
      </div>
    </div>
  )
}
