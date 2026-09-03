import { notFound } from "next/navigation"

import { env } from "@/shared/env"

import { AlertSection } from "./alert-section"
import { BadgeSection } from "./badge-section"
import { ButtonSection } from "./button-section"
import { InputSection } from "./input-section"
import { MetricTileSection } from "./metric-tile-section"
import { OverlaySection } from "./overlay-section"
import { PaletteSection } from "./palette-section"
import { PendingSection } from "./pending-section"
import { RefusalSection } from "./refusal-section"
import { SpacingSection } from "./spacing-section"
import { TableSection } from "./table-section"
import { TypeScaleSection } from "./type-scale-section"
import { TypeSection } from "./type-section"

/**
 * The design reference: every token and primitive of Obsidian Kinetic in
 * one place, so a change to the system can be seen rather than imagined.
 *
 * Development only. It ships no real data and sits outside the `(app)`
 * route group's auth, so it must not exist in production — `notFound()`
 * removes it rather than redirecting, which would advertise that the route
 * is there.
 */
export default function DesignPage() {
  if (env().NODE_ENV === "production") {
    notFound()
  }

  return (
    <main className="mx-auto max-w-[1120px] px-5 pb-24">
      <header className="border-b border-hairline py-14">
        <p className="mb-2 font-mono text-[11px] font-semibold tracking-[0.16em] text-ink-faint uppercase">
          Obsidian Kinetic
        </p>
        <h1 className="max-w-[24ch] text-[clamp(30px,5vw,44px)] leading-[1.05] tracking-[-0.02em] font-semibold text-ink">
          The Instrument
        </h1>
        <p className="mt-4 max-w-[62ch] text-[15px] text-ink-muted">
          One dark instrument surface, read at a desk at month-end. Every token and primitive below
          is what the rest of the app is built from — see DESIGN.md for the rationale.
        </p>
      </header>

      <div className="flex flex-col gap-10 pt-4">
        <PaletteSection />
        <SpacingSection />
        <TypeSection />
        <TypeScaleSection />
        <ButtonSection />
        <InputSection />
        <BadgeSection />
        <TableSection />
        <AlertSection />
        <OverlaySection />
        <MetricTileSection />
        <RefusalSection />
        <PendingSection />
      </div>
    </main>
  )
}
