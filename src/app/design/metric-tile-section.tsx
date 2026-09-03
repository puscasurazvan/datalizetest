import { DatabaseIcon } from "lucide-react"

import { MetricTile } from "@/app/(app)/datasets/metric-tile"

import { SpecimenSection } from "./specimen-section"

export function MetricTileSection() {
  return (
    <SpecimenSection
      title="Metric tile"
      description="Glass card, a blurred accent disc bleeding from the corner, the figure at 40px tabular, and a footer naming what produced it. Every tile is tethered to a query — a hero number with nothing behind it is not a design decision."
    >
      <div className="grid max-w-3xl grid-cols-1 gap-space-md sm:grid-cols-2">
        <MetricTile
          label="Total revenue"
          value="$482,190.00"
          source="sum(amount) · 12,406 rows"
          Icon={DatabaseIcon}
          accent="cyan"
        />
        <MetricTile
          label="Rows verified"
          value="12,406"
          source="Dataset Version Δ03"
          Icon={DatabaseIcon}
          accent="verified"
        />
      </div>
    </SpecimenSection>
  )
}
