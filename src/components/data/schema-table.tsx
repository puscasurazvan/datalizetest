"use client"

import { tableFeatures, useTable } from "@tanstack/react-table"
import type { ColumnDef } from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * One column as the import inferred it. `continuity` is the Column ID's fate
 * across versions (CONTEXT.md): a column carries its ID forward only when
 * both its name and its type are unchanged, so `revised` and `removed` are
 * what tells a Saved Query it no longer fits.
 */
export interface InferredColumn {
  readonly position: number
  readonly name: string
  readonly columnId: string
  readonly type: string
  readonly nullCount: number
  readonly unparseableCount: number
  readonly sample: string | null
  readonly continuity: "carried" | "new" | "revised" | "removed"
}

/** Figures are right-aligned; text is not. Derived from the column id rather
 *  than a `meta` augmentation, which would need its own module declaration. */
const NUMERIC_COLUMNS: ReadonlySet<string> = new Set(["position", "nullCount", "unparseableCount"])

const features = tableFeatures({})

const columns: Array<ColumnDef<typeof features, InferredColumn>> = [
  { accessorKey: "position", header: "#" },
  {
    accessorKey: "name",
    header: "COLUMN",
    cell: (info) => (
      <>
        {info.row.original.name}
        <span className="mt-0.5 block text-[9.5px] tracking-[0.04em] text-muted-foreground">
          {info.row.original.columnId}
        </span>
      </>
    ),
  },
  { accessorKey: "type", header: "INFERRED TYPE" },
  {
    accessorKey: "nullCount",
    header: "NULL",
    cell: (info) => info.row.original.nullCount.toLocaleString("en-US"),
  },
  {
    accessorKey: "unparseableCount",
    header: "UNPARSEABLE",
    cell: (info) => info.row.original.unparseableCount.toLocaleString("en-US"),
  },
  {
    accessorKey: "sample",
    header: "SAMPLE",
    cell: (info) =>
      info.row.original.sample ?? <span className="text-muted-foreground italic">empty</span>,
  },
]

/**
 * The parts list of the sheet: every column, its inferred type, and what it
 * refused to parse. Built on TanStack Table because shadcn ships no data
 * table — its own docs point here — and because sorting and column
 * visibility can be added later as features without a rewrite.
 *
 * Not virtualized: a Dataset Version is capped at 100 columns
 * (docs/adr/0002), so this list is bounded and short. The 10,000-row result
 * grid (decisions/05) is the one that needs windowing.
 */
export function SchemaTable({ rows }: { rows: readonly InferredColumn[] }) {
  const table = useTable({ features, columns, data: [...rows] })
  const changed = rows.filter((row) => row.continuity === "revised" || row.continuity === "removed")

  return (
    <div className="overflow-x-auto">
      <Table className="font-mono text-xs">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={cn(
                    "text-[9.5px] font-semibold tracking-[0.11em] text-muted-foreground",
                    NUMERIC_COLUMNS.has(header.column.id) && "text-right",
                  )}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              // Material state, not a colour badge: a revised column takes the
              // redline wash, a removed one is struck through and stays.
              className={cn(
                row.original.continuity === "revised" && "bg-redline-wash",
                row.original.continuity === "removed" && "text-muted-foreground line-through",
              )}
            >
              {row.getAllCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={cn(
                    "whitespace-nowrap",
                    NUMERIC_COLUMNS.has(cell.column.id) && "text-right",
                  )}
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {changed.length > 0 ? (
        <p className="sr-only">
          {changed.length} columns changed in this version:{" "}
          {changed.map((row) => `${row.name} ${row.continuity}`).join(", ")}
        </p>
      ) : null}
    </div>
  )
}
