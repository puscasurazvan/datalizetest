import { cn } from "@/lib/utils"

import { SpecimenSection } from "./specimen-section"

interface TypeStep {
  readonly token: string
  readonly className: string
  readonly meta: string
  readonly mono?: true
  readonly sample: string
}

const STEPS: readonly TypeStep[] = [
  {
    token: "headline-2xl",
    className: "text-headline-2xl",
    meta: "48px / 56 / -0.03em / 600",
    sample: "The instrument reads true",
  },
  {
    token: "headline-xl",
    className: "text-headline-xl",
    meta: "36px / 44 / -0.025em / 600",
    sample: "The instrument reads true",
  },
  {
    token: "headline-lg",
    className: "text-headline-lg",
    meta: "24px / 32 / -0.02em / 600",
    sample: "Dataset Version Δ03",
  },
  {
    token: "headline-md",
    className: "text-headline-md",
    meta: "20px / 28 / -0.015em / 500",
    sample: "Monthly revenue by plan",
  },
  {
    token: "headline-sm",
    className: "text-headline-sm",
    meta: "16px / 24 / -0.01em / 500",
    sample: "Column delta matrix",
  },
  {
    token: "body-lg",
    className: "text-body-lg",
    meta: "16px / 24 / -0.005em / 400",
    sample: "Every figure shows a corroborating second reading.",
  },
  {
    token: "body-md",
    className: "text-body-md",
    meta: "14px / 20 / 0em / 400",
    sample: "Grouped by month (Europe/Paris).",
  },
  {
    token: "body-sm",
    className: "text-body-sm",
    meta: "13px / 18 / 0em / 400",
    sample: "157 rows refused — mixed currencies.",
  },
  {
    token: "label-md",
    className: "text-label-md",
    meta: "12px / 16 / 0.01em / 500",
    sample: "WORKSPACE",
  },
  {
    token: "label-mono",
    className: "text-label-mono",
    meta: "11px / 14 / 0.04em / 500",
    mono: true,
    sample: "COLUMN ID",
  },
  {
    token: "code-md",
    className: "text-code-md",
    meta: "13px / 18 / -0.01em / 400",
    mono: true,
    sample: "col_4f9a2c",
  },
  {
    token: "code-sm",
    className: "text-code-sm",
    meta: "11px / 16 / 0.02em / 500",
    mono: true,
    sample: "SCHEMA_INCOMPATIBLE",
  },
]

export function TypeScaleSection() {
  return (
    <SpecimenSection
      title="Type scale"
      description="Every step carries its own size, line-height, tracking and weight — the step name is the whole typographic decision. Mono steps add font-mono; the rest are Geist."
    >
      <div className="flex flex-col">
        {STEPS.map((step) => (
          <div
            key={step.token}
            className="flex flex-col gap-space-2xs border-b border-hairline py-space-sm last:border-b-0"
          >
            <span className="font-mono text-code-sm text-ink-faint">
              text-{step.token} · {step.meta}
            </span>
            <span className={cn(step.className, step.mono && "font-mono", "text-ink")}>
              {step.sample}
            </span>
          </div>
        ))}
      </div>
    </SpecimenSection>
  )
}
