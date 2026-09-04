"use client"

import { PencilLine, TriangleAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { NativeSelect } from "@/components/ui/native-select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type {
  ColumnDatetimeOffset,
  DatalizeType,
  HeaderIssue,
  ProposedSchemaColumn,
} from "@/modules/imports"

const HEADER_ISSUE_LABEL: Record<HeaderIssue, string> = {
  bom_stripped: "BOM stripped",
  blank_header: "Blank header",
  duplicate_header: "Duplicate name",
}

const DATETIME_OFFSET_LABEL: Record<ColumnDatetimeOffset, string> = {
  explicit: "Explicit offset",
  naive: "Naive local time",
  mixed: "Mixed offsets",
}

const DATETIME_OFFSET_VARIANT: Record<ColumnDatetimeOffset, "verified" | "caution"> = {
  explicit: "verified",
  naive: "caution",
  mixed: "caution",
}

function toDatalizeType(value: string, typeOptions: readonly DatalizeType[]): DatalizeType {
  return typeOptions.find((type) => type === value) ?? "string"
}

/**
 * The inferred schema, one row per column. Override options are exactly
 * `typeOptions` — `page.tsx` passes `DATALIZE_TYPES`, the six types
 * `import.load` can actually write, never a decorative
 * "text"/"varchar"/"(iso-4217)" menu (plan section 3). Taken as a prop
 * rather than imported here: this file is `"use client"`, and the barrel it
 * would otherwise come from also re-exports the pipeline's Node-only
 * internals (`@/db/client`'s `pg`) — importing any *runtime* binding from
 * `@/modules/imports` here pulls that whole module graph into the browser
 * bundle. `sampleSize` is the same story for `SAMPLE_SIZE` (H9's constant).
 * Overrides live in the parent (`confirm-import-form.tsx`): this component
 * is presentational, reading the current selection back out of `overrides`
 * so a re-render (e.g. the timezone changing) never loses a choice.
 */
export function ProposedSchemaTable({
  columns,
  overrides,
  onOverrideChange,
  typeOptions,
  sampleSize,
}: {
  columns: readonly ProposedSchemaColumn[]
  overrides: ReadonlyMap<number, DatalizeType>
  onOverrideChange: (position: number, type: DatalizeType) => void
  typeOptions: readonly DatalizeType[]
  sampleSize: number
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Column</TableHead>
          <TableHead>Inferred type</TableHead>
          <TableHead>Nulls</TableHead>
          <TableHead>Unparseable</TableHead>
          <TableHead>Override</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {columns.map((column) => (
          <SchemaRow
            key={column.position}
            column={column}
            override={overrides.get(column.position)}
            onOverrideChange={onOverrideChange}
            typeOptions={typeOptions}
            sampleSize={sampleSize}
          />
        ))}
      </TableBody>
    </Table>
  )
}

function SchemaRow({
  column,
  override,
  onOverrideChange,
  typeOptions,
  sampleSize,
}: {
  column: ProposedSchemaColumn
  override: DatalizeType | undefined
  onOverrideChange: (position: number, type: DatalizeType) => void
  typeOptions: readonly DatalizeType[]
  sampleSize: number
}) {
  const selected = override ?? column.type
  // H2: an override has no unparseable count to show — profiling only ever
  // counted matches against the INFERRED type, never against a type the
  // user is choosing now — so this is a stated consequence, not a number.
  // Overriding to `string` is exempt: every value parses as a string, so
  // nothing there ever loads as NULL.
  const showsOverrideConsequence = override !== undefined && override !== "string"

  return (
    <TableRow>
      <TableCell className="align-top text-ink-muted tabular-nums">{column.position}</TableCell>
      <TableCell className="align-top whitespace-normal">
        <div className="flex flex-col gap-space-2xs">
          <span className="font-medium text-ink">{column.name}</span>
          <div className="flex flex-wrap gap-space-2xs">
            {column.headerRenamed ? (
              <Badge variant="outline">
                <PencilLine className="size-3" strokeWidth={1.5} />
                Renamed from &quot;{column.originalHeader}&quot;
              </Badge>
            ) : null}
            {column.headerIssues.map((issue) => (
              <Badge key={issue} variant="caution">
                <TriangleAlert className="size-3" strokeWidth={1.5} />
                {HEADER_ISSUE_LABEL[issue]}
              </Badge>
            ))}
          </div>
        </div>
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <div className="flex flex-col items-start gap-space-2xs">
          <span className="font-mono text-code-sm text-ink">{column.type}</span>
          {column.datetimeOffset === undefined ? null : (
            <Badge variant={DATETIME_OFFSET_VARIANT[column.datetimeOffset]}>
              {DATETIME_OFFSET_LABEL[column.datetimeOffset]}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="align-top text-ink-muted">{column.nullable ? "yes" : "no"}</TableCell>
      <TableCell className="align-top whitespace-normal text-ink-muted">
        <span className="font-mono text-code-sm text-ink">
          {column.unparseableCount.toLocaleString()}
        </span>{" "}
        in the first {sampleSize.toLocaleString()} sampled rows
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <div className="flex flex-col gap-space-xs">
          <NativeSelect
            aria-label={`Type override for ${column.name}`}
            value={selected}
            onChange={(event) =>
              onOverrideChange(column.position, toDatalizeType(event.target.value, typeOptions))
            }
          >
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </NativeSelect>
          {showsOverrideConsequence ? (
            <p className="max-w-[36ch] text-body-sm text-caution">
              Values that don&apos;t parse as <span className="font-mono">{override}</span> load as
              NULL and are recorded as issues. The Dataset Version is immutable once committed.
            </p>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}
