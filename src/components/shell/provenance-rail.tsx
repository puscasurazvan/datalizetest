import { FileClock, Radio, ShieldCheck, Workflow } from "lucide-react"

import { SignOutButton } from "@/components/shell/sign-out-button"
import { NO_VALUE, PENDING_CLASS } from "@/components/ui/pending"

const GROUP_LABEL = "px-space-sm font-mono text-label-mono uppercase tracking-wider text-ink-faint"
const CARD = "rounded-xl bg-surface p-space-sm space-y-space-xs"
const ROW = "flex items-center justify-between text-label-md"

/** The rail's section nav. No route exists for any of these yet. */
const OPS_ITEMS = [
  { label: "Live Telemetry", Icon: Radio },
  { label: "Schema Defenses", Icon: ShieldCheck },
  { label: "Sync Pipelines", Icon: Workflow },
  { label: "Compliance Logs", Icon: FileClock },
] as const

export interface ProvenanceRailProps {
  workspaceName: string
  timezone: string
}

/**
 * The fixed rail from the design — lineage read at one constant left position on
 * every screen (DESIGN.md "Ruling axis"). Slots with a real fact carry it; the
 * rest hold their geometry inert rather than being cut, and never show a figure
 * the product cannot produce.
 */
export function ProvenanceRail({ workspaceName, timezone }: ProvenanceRailProps) {
  return (
    <aside className="fixed bottom-0 left-0 top-16 z-40 hidden w-64 flex-col justify-between bg-chrome/90 p-space-base shadow-[1px_0_12px_rgba(0,0,0,0.3)] backdrop-blur-xl lg:flex">
      <div className="space-y-space-lg">
        <div className="space-y-space-xs">
          <div className={GROUP_LABEL}>Workspace provenance</div>
          <div className={CARD}>
            <div className={ROW}>
              <span className="text-ink-muted">Workspace</span>
              <span className="max-w-[7.5rem] truncate text-ink">{workspaceName}</span>
            </div>
            <div className={ROW}>
              <span className="text-ink-muted">Timezone</span>
              <span className="font-mono text-label-mono text-ink">{timezone}</span>
            </div>
            <div
              aria-disabled="true"
              title="Audit integrity is not available yet"
              className={`${ROW} ${PENDING_CLASS}`}
            >
              <span>Audit integrity</span>
              <span className="font-mono text-label-mono">{NO_VALUE}</span>
            </div>
          </div>
        </div>

        <div className="space-y-space-xs">
          <div className={GROUP_LABEL}>Defense &amp; ops</div>
          <nav className="space-y-space-2xs" aria-label="Operations">
            {OPS_ITEMS.map(({ label, Icon }) => (
              <span
                key={label}
                aria-disabled="true"
                title={`${label} is not available yet`}
                className={`flex items-center justify-between rounded-lg px-space-sm py-space-xs text-body-sm ${PENDING_CLASS}`}
              >
                <span>{label}</span>
                <Icon strokeWidth={1.5} className="size-4" />
              </span>
            ))}
          </nav>
        </div>
      </div>

      <div className="space-y-space-sm">
        <div className={CARD}>
          <div
            aria-disabled="true"
            title="The data perimeter is not available yet"
            className={`${ROW} ${PENDING_CLASS}`}
          >
            <span>Data perimeter</span>
            <span className="font-mono text-label-mono">{NO_VALUE}</span>
          </div>
          {/* No real percentage exists, so the bar reads empty rather than inventing a fill. */}
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-highest">
            <div className="h-full w-0 bg-verified" />
          </div>
        </div>
        <SignOutButton />
      </div>
    </aside>
  )
}
