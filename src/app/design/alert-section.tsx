import { TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { SpecimenSection } from "./specimen-section"

export function AlertSection() {
  return (
    <SpecimenSection title="Alerts" description="Default and destructive.">
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Alert>
          <AlertTitle>Version superseded</AlertTitle>
          <AlertDescription>Dataset Version Δ02 replaced Δ01 on 2026-08-04.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Refused</AlertTitle>
          <AlertDescription>
            Mixed currencies in one aggregate — filter by currency before summing.
          </AlertDescription>
        </Alert>
      </div>
    </SpecimenSection>
  )
}
