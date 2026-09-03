import { OctagonXIcon } from "lucide-react"

import { SpecimenSection } from "./specimen-section"

export function RefusalSection() {
  return (
    <SpecimenSection
      title="Refusal surface"
      description="A refusal is stated in full, never a blank pane (decisions/05). Border, wash and copy all say refused — colour alone never carries the state."
    >
      <div className="relative max-w-xl overflow-hidden rounded-2xl border border-refused/40 bg-surface/90 p-space-lg shadow-[0_4px_32px_rgba(105,0,5,0.35)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-refused/10 blur-3xl" />
        <div className="mb-space-md flex items-center gap-space-sm text-headline-sm text-refused">
          <OctagonXIcon strokeWidth={1.5} className="size-5" />
          Query refused
        </div>
        <p className="text-body-md text-ink-muted">
          Mixed currencies in one aggregate — filter by currency before summing.
        </p>
        <div className="mt-space-md rounded-xl border border-hairline bg-chrome/80 p-space-md shadow-inner">
          <p className="font-mono text-code-sm text-ink-faint">REFUSAL_CODE</p>
          <p className="font-mono text-code-md text-refused-bright">MIXED_CURRENCY_AGGREGATE</p>
        </div>
      </div>
    </SpecimenSection>
  )
}
