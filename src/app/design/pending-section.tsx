import { NO_VALUE, Pending } from "@/components/ui/pending"

import { SpecimenSection } from "./specimen-section"

const NAV_PILL = "rounded-full px-space-md py-space-2xs text-body-sm whitespace-nowrap"

export function PendingSection() {
  return (
    <SpecimenSection
      title="Not built yet"
      description="An affordance with no feature behind it ships inert at full geometry rather than being cut — PENDING_CLASS, aria-disabled, a title saying why, never a dead link. A readout with no real value shows an em dash, never an invented figure."
    >
      <div className="flex flex-wrap items-center gap-space-lg">
        <div className="flex items-center gap-space-xs rounded-full bg-surface p-space-2xs">
          <Pending reason="Dashboard is not available yet" className={NAV_PILL}>
            Dashboard
          </Pending>
        </div>

        <div className="flex flex-col gap-space-2xs">
          <span className="font-mono text-code-sm tracking-[0.08em] text-ink-faint uppercase">
            Audit integrity
          </span>
          <span className="font-mono text-headline-sm text-ink-faint">{NO_VALUE}</span>
        </div>
      </div>
    </SpecimenSection>
  )
}
