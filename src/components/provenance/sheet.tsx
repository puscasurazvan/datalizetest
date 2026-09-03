import type { ReactNode } from "react"

import { ProvenanceAxis, type LineageStep } from "./provenance-axis"
import { TitleBlock, type TitleBlockField } from "./title-block"

/**
 * A sheet: the unit this interface is composed from, after a drawing plate.
 *
 * Every sheet carries the same three fixed parts — a heading that names what
 * is being drawn, the provenance axis down the left at a constant position,
 * and the title block across the foot. The body is whatever the sheet is
 * for. Composed rather than configured: a sheet without provenance is not a
 * variant of this, it is a different thing, so there is no `showAxis` prop.
 */
export function Sheet({
  title,
  note,
  lineageHeading,
  lineage,
  titleBlock,
  children,
}: {
  title: string
  note?: string
  lineageHeading: string
  lineage: readonly LineageStep[]
  titleBlock: readonly TitleBlockField[]
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-hairline bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-hairline px-4 py-3.5">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {note ? (
          <p className="max-w-[52ch] font-mono text-[11px] text-ink-muted md:text-right">{note}</p>
        ) : null}
      </header>

      <div className="grid md:grid-cols-[132px_1fr]">
        <ProvenanceAxis heading={lineageHeading} steps={lineage} />
        <div className="min-w-0 p-4">{children}</div>
      </div>

      <TitleBlock fields={titleBlock} />
    </section>
  )
}
