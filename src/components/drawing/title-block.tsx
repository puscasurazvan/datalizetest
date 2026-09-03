import { cn } from "@/lib/utils"

/**
 * One field of a title block. `tone` is the material state, not decoration:
 * `caution` marks an interpretation the reader must accept or override
 * (the timezone a naive timestamp was read in), `checked` marks a count the
 * import verified, `redline` marks something that failed.
 */
export interface TitleBlockField {
  readonly label: string
  readonly value: string
  readonly tone?: "caution" | "checked" | "redline"
}

const TONE_CLASS = {
  caution: "text-caution",
  checked: "text-checked",
  redline: "text-redline",
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
          <dt className="mb-0.5 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground">
            {field.label}
          </dt>
          <dd className={cn("font-medium text-foreground", field.tone && TONE_CLASS[field.tone])}>
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
