import { SpecimenSection } from "./specimen-section"

interface SpacingStep {
  readonly token: string
  readonly rem: string
  /** Literal so Tailwind's text scan can find it — see palette-section.tsx. */
  readonly widthClassName: string
}

const SCALE: readonly SpacingStep[] = [
  { token: "space-2xs", rem: "0.125rem", widthClassName: "w-space-2xs" },
  { token: "space-xs", rem: "0.25rem", widthClassName: "w-space-xs" },
  { token: "space-sm", rem: "0.5rem", widthClassName: "w-space-sm" },
  { token: "space-md", rem: "0.75rem", widthClassName: "w-space-md" },
  { token: "space-base", rem: "1rem", widthClassName: "w-space-base" },
  { token: "space-lg", rem: "1.5rem", widthClassName: "w-space-lg" },
  { token: "space-xl", rem: "2rem", widthClassName: "w-space-xl" },
  { token: "space-2xl", rem: "3rem", widthClassName: "w-space-2xl" },
  { token: "space-3xl", rem: "4rem", widthClassName: "w-space-3xl" },
]

const LAYOUT_CONSTANTS = [
  { token: "gutter-mobile", rem: "1rem", note: "page gutter, mobile" },
  { token: "gutter-desktop", rem: "1.5rem", note: "page gutter, desktop" },
  { token: "page-max-width", rem: "80rem", note: "main column ceiling — too wide to bar here" },
] as const

export function SpacingSection() {
  return (
    <SpecimenSection
      title="Spacing"
      description="One scale, reached for by name — p-space-lg, gap-space-md — never an ad-hoc number. Each bar's width IS the token, not an illustration of it."
    >
      <div className="flex flex-col gap-space-xs">
        {SCALE.map((step) => (
          <div key={step.token} className="flex items-center gap-space-md">
            <span className="w-28 shrink-0 font-mono text-code-sm text-ink">{step.token}</span>
            <span className="w-16 shrink-0 font-mono text-code-sm text-ink-faint">{step.rem}</span>
            <span className={`h-space-sm shrink-0 rounded-sm bg-cyan/60 ${step.widthClassName}`} />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-space-2xs border-t border-hairline pt-space-md">
        <p className="font-mono text-code-sm tracking-[0.08em] text-ink-faint uppercase">
          Layout constants
        </p>
        {LAYOUT_CONSTANTS.map((constant) => (
          <div key={constant.token} className="flex items-baseline gap-space-md">
            <span className="w-28 shrink-0 font-mono text-code-sm text-ink">{constant.token}</span>
            <span className="w-16 shrink-0 font-mono text-code-sm text-ink-faint">
              {constant.rem}
            </span>
            <span className="text-body-sm text-ink-muted">{constant.note}</span>
          </div>
        ))}
      </div>
    </SpecimenSection>
  )
}
