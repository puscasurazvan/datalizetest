import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { DatasetVersionSummary } from "@/modules/datasets"

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
})

/** The Badge variant a Dataset Version's import status reads as. */
function statusVariant(status: string): "verified" | "destructive" | "caution" {
  if (status === "COMPLETED") return "verified"
  if (status === "FAILED" || status === "CANCELLED") return "destructive"
  return "caution"
}

/**
 * Every Dataset Version this Dataset has had, newest first. A superseded
 * version is never dropped from the list — it stays struck through and
 * faint rather than removed (DESIGN.md "Persistent history"), and the
 * active version carries its own border, fill AND a Badge, so the state
 * never rides on colour alone (DESIGN.md "Material state").
 */
export function VersionHistory({
  versions,
  activeVersionId,
}: {
  versions: readonly DatasetVersionSummary[]
  /** `null` when the Dataset has no current version — then no entry is active. */
  activeVersionId: string | null
}) {
  return (
    <ol className="flex flex-col gap-space-sm p-space-lg">
      {versions.map((version) => (
        <li key={version.id}>
          <VersionEntry version={version} isActive={version.id === activeVersionId} />
        </li>
      ))}
    </ol>
  )
}

function VersionEntry({
  version,
  isActive,
}: {
  version: DatasetVersionSummary
  isActive: boolean
}) {
  const rows = version.rowCount === null ? "—" : version.rowCount.toLocaleString()

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-space-md rounded-xl border px-space-md py-space-sm",
        isActive ? "border-cyan bg-cyan/5" : "border-hairline text-ink-faint line-through",
      )}
    >
      <span className="flex items-center gap-space-sm">
        <span className={cn("font-mono text-code-md font-semibold", isActive && "text-ink")}>
          v{version.versionNumber}
        </span>
        {isActive ? (
          <Badge variant={statusVariant(version.status)}>Active · {version.status}</Badge>
        ) : null}
      </span>
      <span className="font-mono text-code-sm tabular-nums">{rows} rows</span>
      <span className="font-mono text-code-sm">{TIMESTAMP_FORMAT.format(version.createdAt)}</span>
    </div>
  )
}
