import Link from "next/link"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import type { ImportView } from "@/modules/imports"

/**
 * `import_errors.error_code` (docs/decisions/06 #5), in the one place this
 * screen names them. Never a row number, column name, or cell value here —
 * `countImportErrorsByCode` (H3) only ever hands back a count per code.
 */
const ISSUE_CODE_LABEL: Record<string, string> = {
  UNPARSEABLE_VALUE: "didn't parse as the column's confirmed type — cell left NULL",
  AMBIGUOUS_LOCAL_TIME: "an ambiguous local time (DST fall-back) — resolved, not dropped",
  NONEXISTENT_LOCAL_TIME: "a local time inside a DST spring-forward gap — resolved, not dropped",
  FIELD_COUNT_MISMATCH: "the wrong number of fields for this file's header",
  ENCODING: "unreadable in the file's encoding",
}

type TerminalPhase = "completed" | "failed" | "cancelled"

/**
 * The three phases an import ends on, grouped here because none is
 * reachable from either of the others — together they ARE the screen once
 * the pipeline has stopped running, not three separate product surfaces.
 */
export function ImportOutcome({ view }: { view: Extract<ImportView, { phase: TerminalPhase }> }) {
  if (view.phase === "completed") return <CompletedOutcome view={view} />
  if (view.phase === "failed") return <FailedOutcome view={view} />
  return <CancelledOutcome view={view} />
}

function OutcomeCard({ tone, children }: { tone: "neutral" | "refused"; children: ReactNode }) {
  const toneClass =
    tone === "refused"
      ? "border-refused/40 shadow-[0_4px_32px_rgba(105,0,5,0.35)]"
      : "border-hairline"
  return (
    <div
      className={`flex flex-col gap-space-md rounded-2xl border bg-surface/90 p-space-lg backdrop-blur-xl ${toneClass}`}
    >
      {children}
    </div>
  )
}

function CompletedOutcome({ view }: { view: Extract<ImportView, { phase: "completed" }> }) {
  const issueCounts = Object.entries(view.issueCountsByCode).filter(([, count]) => count > 0)

  return (
    <OutcomeCard tone="neutral">
      <Badge variant="verified">Completed</Badge>
      <p className="text-body-md text-ink">
        <span className="font-mono text-headline-sm">{view.rowsLoaded.toLocaleString()}</span> rows
        loaded.
      </p>
      {view.rowsWithRecordedIssue > 0 ? (
        <p className="max-w-[64ch] text-body-sm text-ink-muted">
          <span className="font-mono text-ink">{view.rowsWithRecordedIssue.toLocaleString()}</span>{" "}
          of those rows — a subset of the {view.rowsLoaded.toLocaleString()} above, not a separate
          remainder — have at least one recorded issue. Every one of them still loaded.
        </p>
      ) : null}
      {issueCounts.length > 0 ? (
        <ul className="flex flex-col gap-space-xs border-t border-hairline pt-space-sm">
          {issueCounts.map(([code, count]) => (
            <li key={code} className="text-body-sm text-ink-muted">
              <span className="font-mono text-ink">{count.toLocaleString()}</span>{" "}
              {ISSUE_CODE_LABEL[code] ?? code}
            </li>
          ))}
        </ul>
      ) : null}
      <DatasetLink datasetId={view.datasetId}>Go to this Dataset</DatasetLink>
    </OutcomeCard>
  )
}

function FailedOutcome({ view }: { view: Extract<ImportView, { phase: "failed" }> }) {
  return (
    <OutcomeCard tone="refused">
      <Badge variant="destructive">Failed</Badge>
      <p className="text-body-md text-ink">
        {view.errorMessage ?? "This import failed for a reason that was not recorded."}
      </p>
      {/* H4: the Dataset this import would have versioned still exists —
          without this datasetId the user has to hunt for it. */}
      <DatasetLink datasetId={view.datasetId}>Try another file</DatasetLink>
    </OutcomeCard>
  )
}

function CancelledOutcome({ view }: { view: Extract<ImportView, { phase: "cancelled" }> }) {
  return (
    <OutcomeCard tone="neutral">
      <Badge>Cancelled</Badge>
      {/* Nothing writes CANCELLED yet (plan section 3), so this can't
          honestly claim WHEN relative to loading it happened. */}
      <p className="text-body-md text-ink">This import was cancelled.</p>
      <DatasetLink datasetId={view.datasetId}>Back to this Dataset</DatasetLink>
    </OutcomeCard>
  )
}

function DatasetLink({ datasetId, children }: { datasetId: string; children: ReactNode }) {
  return (
    <Link
      href={`/datasets/${datasetId}`}
      className="text-body-sm text-cyan underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  )
}
