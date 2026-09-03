import { cn } from "@/lib/utils"

/**
 * One field of a title block. `tone` is the material state, not decoration:
 * `caution` marks an interpretation the reader must accept or override
 * (the timezone a naive timestamp was read in), `verified` marks a count the
 * import confirmed, `refused` marks something that failed.
 *
 * `checked` and `redline` are the Drawing Sheet-era names for `verified` and
 * `refused`. They stay accepted here, mapped to the same classes, so call
 * sites outside this restyle keep compiling — use the new names in new code.
 */
export interface TitleBlockField {
  readonly label: string
  readonly value: string
  readonly tone?: "caution" | "verified" | "refused" | "checked" | "redline" | undefined
}

const TONE_CLASS = {
  caution: "text-caution",
  verified: "text-verified",
  refused: "text-refused",
  checked: "text-verified",
  redline: "text-refused",
} as const

/**
 * The title block of a drawing: who made this, from what, and under which
 * interpretation. It is the drafting convention that carries Datalize's
 * central promise — a figure on screen can be traced back — so it is fixed
 * to the foot of every sheet rather than hidden behind a details panel.
 *
 * ADR 0004 requires the timezone applied to naive timestamps to be stated
 * where it binds; docs/adr/0002 requires provenance to name a Dataset
 * Version. Both are fields here.
 */
export function TitleBlock({ fields }: { fields: readonly TitleBlockField[] }) {
  return (
    <dl className="grid grid-cols-2 border-t border-hairline md:grid-cols-4">
      {fields.map((field) => (
        <div
          key={field.label}
          className="border-hairline px-3.5 py-2 font-mono text-[11.5px] not-last:border-r"
        >
          <dt className="mb-0.5 text-[9px] font-semibold tracking-[0.12em] text-ink-faint">
            {field.label}
          </dt>
          <dd className={cn("font-medium text-ink", field.tone && TONE_CLASS[field.tone])}>
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
