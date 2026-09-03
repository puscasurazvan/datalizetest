/**
 * One step of the lineage, outermost first: workspace, dataset, version,
 * then whatever the sheet is about. `superseded` keeps a replaced version
 * visible and struck through rather than removing it — a Dataset Version is
 * immutable, so the history is part of the record (CONTEXT.md).
 */
export interface LineageStep {
  readonly label: string
  readonly superseded?: boolean
}

const ROOT_CLASS = "font-medium whitespace-nowrap text-foreground"
const TIER_CLASS =
  "whitespace-nowrap text-muted-foreground md:ml-0.5 md:border-l md:border-hairline md:pl-2.5"
const SUPERSEDED_CLASS = "whitespace-nowrap text-muted-foreground line-through"

function stepClass(step: LineageStep, index: number): string {
  if (step.superseded) return SUPERSEDED_CLASS
  if (index === 0) return ROOT_CLASS
  return TIER_CLASS
}

/**
 * The ruling axis: lineage at one fixed x-position on every sheet, so a
 * reader always looks in the same place to answer "what am I looking at,
 * and which version produced it".
 *
 * On a narrow screen the column becomes a wrapping strip above the body —
 * a fixed position stops meaning anything when there is no second column to
 * hold it steady, and a 132px rail would eat a third of the width.
 */
export function ProvenanceAxis({
  heading,
  steps,
}: {
  heading: string
  steps: readonly LineageStep[]
}) {
  return (
    <nav
      aria-label={heading}
      className="border-b border-hairline p-3 md:border-r md:border-b-0 md:p-4"
    >
      <h2 className="mb-2.5 font-mono text-[9px] font-semibold tracking-[0.14em] text-muted-foreground">
        {heading}
      </h2>
      <ol className="flex flex-wrap gap-x-3.5 font-mono text-[10.5px] leading-6 md:block">
        {steps.map((step, index) => (
          <li key={step.label} className={stepClass(step, index)}>
            {step.label}
          </li>
        ))}
      </ol>
    </nav>
  )
}
