import { FieldError } from "@/components/ui/field-error"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { SpecimenSection } from "./specimen-section"

/**
 * "Focus" mirrors the primitive's own `focus-visible` ring by class rather
 * than by real focus — this is a static reference page, so the state has to
 * be shown, not triggered.
 */
const FOCUS_RING = "border-cyan shadow-[0_0_0_3px_rgba(6,182,212,0.15)]"

export function InputSection() {
  return (
    <SpecimenSection title="Inputs" description="Default, focus, and error.">
      <div className="grid max-w-md gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="specimen-input-default">Default</Label>
          <Input id="specimen-input-default" placeholder="Workspace name" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="specimen-input-focus">Focus</Label>
          <Input id="specimen-input-focus" placeholder="Workspace name" className={FOCUS_RING} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="specimen-input-error">Error</Label>
          <Input id="specimen-input-error" placeholder="Workspace name" aria-invalid />
          <FieldError id="specimen-input-error-message" message="Workspace name is required" />
        </div>
      </div>
    </SpecimenSection>
  )
}
