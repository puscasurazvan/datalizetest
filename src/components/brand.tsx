import { Database } from "lucide-react"

/**
 * The product's identity: one object, rendered the same in the shell chrome, on
 * the auth plates, on the gate screens and on the error surfaces. It was
 * duplicated across five files, which is how a logo drifts — the tile picks up a
 * different radius in one place and nobody notices.
 *
 * Alignment belongs to the caller: the header lays it out inline, the plates
 * centre it. That is a container's job, not a prop.
 */
export function Brand() {
  return (
    <div className="flex items-center gap-space-sm">
      <div className="flex items-center justify-center rounded-lg bg-surface-high p-space-2xs">
        <Database strokeWidth={1.5} className="size-5 text-cyan" />
      </div>
      <span className="text-headline-sm font-semibold text-ink">Datalize</span>
    </div>
  )
}
