import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SchemaTable, type InferredColumn } from "@/components/data/schema-table"
import { BarVisualization, type BarDatum } from "@/modules/visualizations/bar-chart"

import { Sheet } from "./sheet"

/**
 * The six sheets, composed from the drawing primitives against the seeded
 * fixture at `tests/fixtures/transactions_stripe.csv`. Every figure below is
 * a real aggregate of those 1,000 rows, not an invented number.
 *
 * This is design reference, not the product: the real screens will take the
 * same props from a module service. It is rendered only by the dev-only
 * `/design` route.
 */

const SCHEMA: readonly InferredColumn[] = [
  {
    position: 1,
    name: "id",
    columnId: "col_7a3f",
    type: "text",
    nullCount: 0,
    unparseableCount: 0,
    sample: "tx0000001",
    continuity: "carried",
  },
  {
    position: 2,
    name: "customer_id",
    columnId: "col_9b21",
    type: "text",
    nullCount: 0,
    unparseableCount: 0,
    sample: "c000300",
    continuity: "carried",
  },
  {
    position: 3,
    name: "amount",
    columnId: "col_1d88",
    type: "decimal(12,2)",
    nullCount: 0,
    unparseableCount: 0,
    sample: "4263.07",
    continuity: "carried",
  },
  {
    position: 4,
    name: "currency",
    columnId: "col_5f0a",
    type: "text",
    nullCount: 0,
    unparseableCount: 0,
    sample: "EUR",
    continuity: "carried",
  },
  {
    position: 5,
    name: "status",
    columnId: "col_2e77",
    type: "text",
    nullCount: 0,
    unparseableCount: 0,
    sample: "succeeded",
    continuity: "carried",
  },
  {
    position: 6,
    name: "created_at",
    columnId: "col_8c1b",
    type: "timestamptz",
    nullCount: 0,
    unparseableCount: 0,
    sample: "2025-11-17T04:02:18Z",
    continuity: "carried",
  },
  {
    position: 7,
    name: "region",
    columnId: "col_9e02",
    type: "decimal(12,2)",
    nullCount: 0,
    unparseableCount: 12,
    sample: "4.50",
    continuity: "revised",
  },
  {
    position: 8,
    name: "plan_name",
    columnId: "col_0a95",
    type: "text",
    nullCount: 157,
    unparseableCount: 0,
    sample: null,
    continuity: "removed",
  },
]

const MONTHLY: readonly BarDatum[] = [
  { label: "2025-01", value: 39889.53, rowCount: 13 },
  { label: "2025-02", value: 25792.32, rowCount: 13 },
  { label: "2025-03", value: 36022.85, rowCount: 12 },
  { label: "2025-04", value: 29159.75, rowCount: 9 },
  { label: "2025-05", value: 17248.86, rowCount: 12 },
  { label: "2025-06", value: 24234.46, rowCount: 9 },
  { label: "2025-07", value: 39503.14, rowCount: 16 },
  { label: "2025-08", value: 13110.32, rowCount: 4 },
  { label: "2025-09", value: 32205.66, rowCount: 12 },
  { label: "2025-10", value: 35428.44, rowCount: 11 },
  { label: "2025-11", value: 29783.12, rowCount: 11 },
  { label: "2025-12", value: 13417.94, rowCount: 7 },
  { label: "2026-01", value: 33158.33, rowCount: 13 },
  { label: "2026-02", value: 18860.98, rowCount: 7 },
  { label: "2026-03", value: 47431.77, rowCount: 15 },
  { label: "2026-04", value: 26161.12, rowCount: 10 },
  { label: "2026-05", value: 27902.14, rowCount: 11 },
  { label: "2026-06", value: 11926.28, rowCount: 5 },
  { label: "2026-07", value: 21551.07, rowCount: 9 },
  { label: "2026-08", value: 49548.95, rowCount: 17 },
]

const IMPORT_LINEAGE = [
  { label: "acme-ops" },
  { label: "transactions" },
  { label: "import · pending" },
  { label: "v2 · draft" },
]

const IMPORT_TITLE_BLOCK = [
  { label: "DATASET", value: "transactions_stripe" },
  { label: "VERSION", value: "2 — draft" },
  { label: "NAIVE TIMES READ IN", value: "Europe/Paris", tone: "caution" as const },
  { label: "CHECKED", value: "1,000 / 0 refused", tone: "checked" as const },
]

const IMPORT_SCHEMA = SCHEMA.filter((column) => column.continuity !== "removed")

export function ImportSheet() {
  return (
    <Sheet
      title="Import — confirm the schema"
      note="ADR 0004 requires the preview to state which timezone it applied and let the analyst override it before the import commits. So it is on the sheet, where it binds."
      lineageHeading="PROVENANCE"
      lineage={IMPORT_LINEAGE}
      titleBlock={IMPORT_TITLE_BLOCK}
    >
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertTitle>3 columns hold local times with no offset</AlertTitle>
          <AlertDescription>
            They will be read as wall-clock time in Europe/Paris, the workspace timezone, and stored
            as instants. That interpretation is stamped onto this version and never re-applied
            later.
          </AlertDescription>
        </Alert>
        <SchemaTable rows={IMPORT_SCHEMA} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline-faint pt-3">
          <div className="flex gap-2">
            <Badge variant="outline">1,000 read</Badge>
            <Badge variant="outline">0 refused</Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline">Change types</Button>
            <Button>Commit version 2</Button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

const RESULT_LINEAGE = [
  { label: "acme-ops" },
  { label: "transactions" },
  { label: "v2 · current" },
  { label: "execution ex_4b8e" },
]

const RESULT_TITLE_BLOCK = [
  { label: "RESOLVED TO", value: "v2 — current" },
  { label: "GROUPED IN", value: "Europe/Paris" },
  { label: "EXECUTION", value: "ex_4b8e · 412 ms" },
  { label: "ROWS SCANNED", value: "1,000 → 349 → 209", tone: "checked" as const },
]

export function ResultSheet() {
  return (
    <Sheet
      title="Query — composed, never typed"
      note="The analyst assembles a QueryAst. Mixed-currency aggregates are refused rather than summed, so this total is USD only and is never labelled MRR."
      lineageHeading="PROVENANCE"
      lineage={RESULT_LINEAGE}
      titleBlock={RESULT_TITLE_BLOCK}
    >
      <BarVisualization
        data={MONTHLY}
        measureLabel="sum(amount) USD"
        granularityNote="Grouped by month (Europe/Paris)"
        groupCount={20}
      />
    </Sheet>
  )
}

const REVISION_LINEAGE = [
  { label: "△2 · 2026-09-03" },
  { label: "1,000 rows" },
  { label: "△1 · 2026-08-01" },
  { label: "△0 initial", superseded: true },
]

const REVISION_TITLE_BLOCK = [
  { label: "SUPERSEDES", value: "v1 — 964 rows" },
  { label: "CARRIED", value: "6 of 8 columns", tone: "checked" as const },
  { label: "BROKEN", value: "2 saved queries", tone: "redline" as const },
  { label: "IMPORT", value: "im_88c1 · idempotent" },
]

export function RevisionSheet() {
  return (
    <Sheet
      title="Revision — what changed, clouded"
      note="A new upload is a revision, not an edit. A column carries its Column ID forward only when name and type are both unchanged."
      lineageHeading="REVISIONS"
      lineage={REVISION_LINEAGE}
      titleBlock={REVISION_TITLE_BLOCK}
    >
      <div className="flex flex-col gap-4">
        <SchemaTable rows={SCHEMA} />
        <Alert variant="destructive">
          <AlertTitle>2 saved queries no longer fit this dataset</AlertTitle>
          <AlertDescription>
            Revenue by plan filters on plan_name, which version 2 does not contain. Regional split
            groups by region, which changed from text to decimal and is therefore a different
            column. Both render a named widget error, never a blank chart.
          </AlertDescription>
        </Alert>
      </div>
    </Sheet>
  )
}

const REFUSALS_LINEAGE = [
  { label: "decisions/05" },
  { label: "ADR 0003" },
  { label: "decisions/01" },
  { label: "shared/errors" },
]

const REFUSALS_TITLE_BLOCK = [
  { label: "RULE", value: "Break visibly" },
  { label: "NEVER", value: "Blank chart" },
  { label: "NEVER", value: "Dropped filter" },
  { label: "NEVER", value: "Physical name" },
]

export function RefusalsSheet() {
  return (
    <Sheet
      title="Refusals — the states this product is judged on"
      note="Each names the problem and the recovery, and none leaks a physical table name, a raw row value, or a stack trace."
      lineageHeading="SOURCE"
      lineage={REFUSALS_LINEAGE}
      titleBlock={REFUSALS_TITLE_BLOCK}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Alert>
          <AlertTitle>This query took longer than 30 seconds</AlertTitle>
          <AlertDescription>
            It was stopped so the workspace stays responsive. Narrowing the date range or adding a
            filter will usually bring it under the limit.
          </AlertDescription>
        </Alert>
        <Alert>
          <AlertTitle>Three queries are already running in this workspace</AlertTitle>
          <AlertDescription>
            This one is queued and will start as soon as a slot frees. Nothing is lost.
          </AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTitle>The column this chart groups by is gone</AlertTitle>
          <AlertDescription>
            plan_name was removed in version 2. Choose a column to group by instead, or set version
            1 as current again.
          </AlertDescription>
        </Alert>
        <Alert>
          <AlertTitle>No datasets in this workspace yet</AlertTitle>
          <AlertDescription>
            Upload a CSV up to 50 MB. Datalize will read the columns, show what it inferred, and
            wait for you to confirm before storing anything.
          </AlertDescription>
        </Alert>
      </div>
    </Sheet>
  )
}
