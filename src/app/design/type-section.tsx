import { SpecimenSection } from "./specimen-section"

const FIGURES = [
  { label: "2025-01", value: 39889.53 },
  { label: "2025-02", value: 25792.32 },
  { label: "2025-11", value: 128450.0 },
]

export function TypeSection() {
  return (
    <SpecimenSection
      title="Type"
      description="Geist for everything the reader reads; JetBrains Mono for everything the reader checks. Both are tabular by default — running prose opts out."
    >
      <div className="flex flex-col gap-3">
        <h3 className="text-[32px] leading-[1.05] font-semibold tracking-[-0.02em] text-ink">
          Geist heading
        </h3>
        <p className="max-w-[60ch] text-sm text-ink-muted">
          Geist body text at 400 weight, the face for everything the reader reads — section
          descriptions, form labels, table copy. No serif and no display face: this surface has no
          editorial voice.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] tracking-[0.1em] text-ink-faint uppercase">
          JetBrains Mono — column ID, checksum, figure
        </p>
        <p className="font-mono text-sm text-ink">col_4f9a2c · SCHEMA_INCOMPATIBLE · 2026-09-03</p>
      </div>

      <div>
        <p className="mb-2 font-mono text-[11px] tracking-[0.1em] text-ink-faint uppercase">
          Tabular figures — column alignment
        </p>
        <dl className="w-fit divide-y divide-hairline rounded-lg border border-hairline">
          {FIGURES.map((figure) => (
            <div key={figure.label} className="flex justify-between gap-8 px-3 py-1.5">
              <dt className="font-mono text-sm text-ink-muted">{figure.label}</dt>
              <dd className="tabular font-mono text-sm text-ink">
                {figure.value.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </SpecimenSection>
  )
}
