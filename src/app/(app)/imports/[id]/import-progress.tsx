"use client"

import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

const POLL_INTERVAL_MS = 2_000

const PHASE_COPY: Record<"profiling" | "loading", string> = {
  profiling: "Still reading this file.",
  loading: "Loading rows into the Dataset Version.",
}

/**
 * `PENDING`/`PROFILING`/`QUEUED`-before-confirm and `QUEUED`-after-confirm/
 * `RUNNING` (imports/internal/read.ts's `profiling`/`loading` phases) only
 * ever change from a background job (Trigger.dev, or `InlineDispatcher`'s
 * in-process equivalent) this client has no channel to — this effect is
 * the one thing in the slice that synchronises with something outside
 * React: it polls by re-running the Server Component on an interval so the
 * page notices when that job moves the phase on. H7: no reconciler exists
 * for a job that crashes mid-run, so this promises nothing about *when* —
 * no progress bar, no ETA, just "still going".
 */
export function ImportProgress({ phase }: { phase: "profiling" | "loading" }) {
  const router = useRouter()

  useEffect(() => {
    const intervalId = setInterval(() => router.refresh(), POLL_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [router])

  return (
    <div className="flex items-center gap-space-md rounded-2xl border border-hairline bg-surface/90 p-space-lg backdrop-blur-xl">
      <Loader2 strokeWidth={1.5} className="size-5 shrink-0 animate-spin text-cyan" />
      <div>
        <p className="text-body-md text-ink">{PHASE_COPY[phase]}</p>
        <p className="text-body-sm text-ink-muted">
          This page checks again every few seconds — no need to reload it yourself.
        </p>
      </div>
    </div>
  )
}
