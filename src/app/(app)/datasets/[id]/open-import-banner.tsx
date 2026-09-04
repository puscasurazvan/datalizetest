import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import type { ImportView } from "@/modules/imports"

/**
 * `null` for `completed`/`cancelled` only because `ImportView` (imports/
 * internal/read.ts) is one type across all six phases and this component
 * takes whatever `findOpenImportForDataset` hands it — that function's own
 * doc guarantees it never returns those two, so this never actually
 * renders `null`. Written as an exhaustive switch, no `default`, so a
 * phase added to `ImportPhase` later fails `pnpm typecheck` here too.
 */
function copyForPhase(view: ImportView): string | null {
  switch (view.phase) {
    case "profiling":
      return "Still reading this file."
    case "awaiting_confirmation":
      return "Waiting for you to confirm the inferred schema."
    case "loading":
      return "Loading rows into a Dataset Version."
    case "failed":
      return view.errorMessage ?? "This import failed."
    case "completed":
    case "cancelled":
      return null
  }
}

/**
 * H4/H5/H7: the only path back to an import that never reached
 * `/imports/[id]` on its own — H5's profile crash propagates out of the
 * Server Action under `InlineDispatcher` instead of navigating there, and
 * H7's stuck `QUEUED` row has no reconciler to notice it. Without this
 * banner on the Dataset it belongs to, that import is unreachable.
 */
export function OpenImportBanner({ view }: { view: ImportView }) {
  const copy = copyForPhase(view)
  if (copy === null) {
    return null
  }

  return (
    <Link
      href={`/imports/${view.importId}`}
      className="flex flex-wrap items-center justify-between gap-space-sm rounded-xl border border-hairline bg-surface-raised px-space-md py-space-sm text-body-sm text-ink transition-colors hover:bg-surface-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center gap-space-sm">
        <Badge variant={view.phase === "failed" ? "destructive" : "caution"}>Open import</Badge>
        <span className="font-mono text-code-sm text-ink-muted">{view.originalFilename}</span>
        <span>{copy}</span>
      </span>
      <span className="text-ink-muted">View import →</span>
    </Link>
  )
}
