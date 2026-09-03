import type { CSSProperties } from "react"

import { SpecimenSection } from "./specimen-section"

interface Swatch {
  readonly token: string
  readonly note: string
  /** Computed once per token at module scope, not per render. */
  readonly style: CSSProperties
}

function swatch(token: string, note: string): Swatch {
  return { token, note, style: { background: `var(${token})` } }
}

const GROUNDS: readonly Swatch[] = [
  swatch("--chrome", "header, rail"),
  swatch("--canvas", "page ground"),
  swatch("--surface", "card"),
  swatch("--surface-raised", "popover, nested panel"),
  swatch("--surface-high", "hover, active nav, input"),
  swatch("--surface-highest", "icon chip, active pill, inset key"),
  swatch("--surface-bright", "brightest ground — use sparingly"),
]

const RULES: readonly Swatch[] = [
  swatch("--hairline", "drawn rules"),
  swatch("--hairline-strong", "emphasised rule, input border"),
]

const INK: readonly Swatch[] = [
  swatch("--ink", "body"),
  swatch("--ink-muted", "annotation, secondary"),
  swatch("--ink-faint", "mono labels only"),
]

const ACCENTS: readonly Swatch[] = [
  swatch("--cyan", "accent text, focus ring"),
  swatch("--cyan-solid", "primary fill"),
  swatch("--verified", "confirmed, passed, valid"),
  swatch("--verified-solid", "verified solid fill"),
  swatch("--on-verified", "text on --verified-solid"),
  swatch("--refused", "refusal, breakage, destructive"),
  swatch("--refused-bright", "refusal text on a dark wash"),
  swatch("--on-refused", "text on --refused-bright"),
  swatch("--error", "error text"),
  swatch("--error-solid", "error solid fill"),
  swatch("--caution", "warnings that are not refusals"),
]

const GROUPS = [
  { heading: "Grounds", swatches: GROUNDS },
  { heading: "Rules", swatches: RULES },
  { heading: "Ink", swatches: INK },
  { heading: "Accents", swatches: ACCENTS },
]

export function PaletteSection() {
  return (
    <SpecimenSection
      title="Palette"
      description="Neutral near-black grounds so figures are the only luminous thing on the page. Cyan is spent on the action the analyst is about to take; the other three accents are states the product already names."
    >
      <div className="flex flex-col gap-6">
        {GROUPS.map((group) => (
          <div key={group.heading}>
            <p className="mb-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-ink-faint uppercase">
              {group.heading}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {group.swatches.map((entry) => (
                <div key={entry.token} className="flex flex-col gap-1.5">
                  <div className="h-16 rounded-lg border border-hairline" style={entry.style} />
                  <span className="font-mono text-[11px] text-ink">{entry.token}</span>
                  <span className="text-xs text-ink-muted">{entry.note}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SpecimenSection>
  )
}
