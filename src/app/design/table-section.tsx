import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { SpecimenSection } from "./specimen-section"

const COLUMNS = [
  { name: "created_at", type: "timestamptz", nulls: 0, sample: "2025-04-17T06:53:03Z" },
  { name: "amount", type: "decimal", nulls: 0, sample: "129.00" },
  { name: "currency", type: "text", nulls: 0, sample: "USD" },
  { name: "plan_name", type: "text", nulls: 157, sample: "—" },
]

export function TableSection() {
  return (
    <SpecimenSection
      title="Table"
      description="Alternating structure by hairline rather than fill; figures stay tabular."
    >
      <div className="max-w-2xl rounded-lg border border-hairline">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Column</TableHead>
              <TableHead>Inferred type</TableHead>
              <TableHead className="text-right">Nulls</TableHead>
              <TableHead>Sample</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {COLUMNS.map((column) => (
              <TableRow key={column.name}>
                <TableCell className="font-mono text-ink">{column.name}</TableCell>
                <TableCell className="font-mono text-ink-muted">{column.type}</TableCell>
                <TableCell className="text-right">{column.nulls}</TableCell>
                <TableCell className="font-mono text-ink-muted">{column.sample}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SpecimenSection>
  )
}
