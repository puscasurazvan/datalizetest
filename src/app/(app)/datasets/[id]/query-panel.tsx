"use client"

import { useEffect, useRef, useState, type ChangeEvent } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import type { DatasetColumnSummary } from "@/modules/datasets"
import type { Aggregation, Granularity, QueryResult } from "@/modules/queries"
import type { SafeErrorDto } from "@/shared/errors"

import {
  aggregationOptions,
  buildQueryAst,
  filterOperatorOptions,
  resolveFilterChoice,
  type DimensionChoice,
  type MeasureChoice,
  type SingleValueOperator,
} from "./build-query-ast"
import { QueryResultView } from "./query-result-view"

const NO_SELECTION = ""
const COUNT_ALL = "__count_all__"
const GRANULARITIES: readonly Granularity[] = ["day", "week", "month", "quarter", "year"]

const AGGREGATION_LABELS: Record<Aggregation, string> = {
  count: "Count",
  count_distinct: "Distinct count",
  sum: "Sum",
  avg: "Average",
  min: "Min",
  max: "Max",
}

const OPERATOR_LABELS: Record<SingleValueOperator, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  is_null: "is empty",
  is_not_null: "is not empty",
}

// The done state snapshots the choices that produced `result` — granularity
// and measureLabel must NOT be re-read from live builder state at render
// time, or changing the dimension after a run relabels (and un-charts) a
// result that was actually computed under the previous choice.
type RunState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "done"
      result: QueryResult
      granularity: Granularity | null
      measureLabel: string
      columnNames: Readonly<Record<string, string>>
    }

/**
 * A single-dimension, single-measure, single-filter query builder — the
 * AST allows more (up to 3 dimensions, 5 measures, 10 filters) and the
 * compiler handles it, but only the builder UI is capped here, deliberately
 * (plan section 6, "multi-dimension / multi-measure builder UI"). The
 * filter row is not polish: it is how the currency rule (queries/CLAUDE.md,
 * decisions/01) gets satisfied — "total amount by month" only resolves once
 * "currency" is pinned to one value.
 */
export function QueryPanel({
  datasetId,
  columns,
  organizationTimezone,
}: {
  datasetId: string
  columns: readonly DatasetColumnSummary[]
  organizationTimezone: string
}) {
  const [dimensionColumnId, setDimensionColumnId] = useState(NO_SELECTION)
  const [granularity, setGranularity] = useState<Granularity>("month")
  const [measureFieldId, setMeasureFieldId] = useState(COUNT_ALL)
  const [aggregation, setAggregation] = useState<Aggregation>("count")
  const [filterColumnId, setFilterColumnId] = useState(NO_SELECTION)
  const [filterOperator, setFilterOperator] = useState<SingleValueOperator>("eq")
  const [filterValueRaw, setFilterValueRaw] = useState("")
  const [run, setRun] = useState<RunState>({ status: "idle" })

  // Aborts an in-flight request on unmount — the one thing here genuinely
  // external to React. Re-running the query itself happens from the button's
  // click handler, not from an effect.
  const controllerRef = useRef<AbortController | null>(null)
  useEffect(() => () => controllerRef.current?.abort(), [])

  const dimensionColumn = columns.find((column) => column.columnId === dimensionColumnId) ?? null
  const dimension: DimensionChoice | null =
    dimensionColumn === null
      ? null
      : {
          columnId: dimensionColumn.columnId,
          granularity: dimensionColumn.type === "timestamptz" ? granularity : null,
        }

  const measureColumn =
    measureFieldId === COUNT_ALL
      ? null
      : (columns.find((column) => column.columnId === measureFieldId) ?? null)
  const measure: MeasureChoice = {
    fieldColumnId: measureColumn === null ? null : measureColumn.columnId,
    aggregation: measureColumn === null ? "count" : aggregation,
  }
  const measureLabel =
    measureColumn === null
      ? "Row count"
      : `${AGGREGATION_LABELS[aggregation]} of ${measureColumn.name}`

  const filterColumn = columns.find((column) => column.columnId === filterColumnId) ?? null
  const filter = resolveFilterChoice(filterColumn, filterOperator, filterValueRaw)
  // A filter column is chosen but its value has not parsed yet (e.g. "eq"
  // with an empty box) — running now would silently drop the filter the
  // user is mid-typing, which for a currency filter means a wrong total,
  // not just a missing one. Block the run instead of guessing.
  const filterOperatorNeedsValue = filterOperator !== "is_null" && filterOperator !== "is_not_null"
  const filterPending = filterColumn !== null && filterOperatorNeedsValue && filter === null

  // Changing which column a measure aggregates resets the aggregation to
  // that column's first valid option — the previous aggregation may not
  // apply to the new column's type (e.g. "sum" on a string column), and
  // offering it anyway would just be rejected by the server (queries/CLAUDE.md).
  function handleMeasureFieldChange(event: ChangeEvent<HTMLSelectElement>) {
    const fieldId = event.target.value
    setMeasureFieldId(fieldId)
    const column = columns.find((candidate) => candidate.columnId === fieldId)
    const firstOption = column === undefined ? undefined : aggregationOptions(column.type)[0]
    if (firstOption !== undefined) {
      setAggregation(firstOption)
    }
  }

  // Same trap as the measure field above, plus a second one: the operator
  // select can land on a value the new column's type does not offer at all
  // (a native <select> whose value matches no option silently shows the
  // first one while state still holds the stale value — timezone-form.tsx's
  // own comment names this exact failure), and a raw value typed against
  // the old column's type (e.g. "USD" for what was an integer) is meaningless
  // once the column changes. Reset both.
  function handleFilterColumnChange(event: ChangeEvent<HTMLSelectElement>) {
    const columnId = event.target.value
    setFilterColumnId(columnId)
    const column = columns.find((candidate) => candidate.columnId === columnId)
    const firstOperator = column === undefined ? undefined : filterOperatorOptions(column.type)[0]
    setFilterOperator(firstOperator ?? "eq")
    setFilterValueRaw("")
  }

  async function runQuery() {
    const ast = buildQueryAst({ datasetId, dimension, measure, filter })
    if (ast === null) return

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    setRun({ status: "loading" })
    try {
      const response = await fetch("/api/queries/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ast),
        signal: controller.signal,
      })
      const body: unknown = await response.json()
      if (!response.ok) {
        setRun({
          status: "error",
          message: isSafeErrorDto(body) ? body.message : "The query failed.",
        })
        return
      }
      if (!isQueryResult(body)) {
        setRun({ status: "error", message: "The server returned an unexpected response." })
        return
      }
      setRun({
        status: "done",
        result: body,
        granularity: dimension?.granularity ?? null,
        measureLabel,
        columnNames: Object.fromEntries(columns.map((column) => [column.columnId, column.name])),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      setRun({ status: "error", message: "The request failed. Try again." })
    }
  }

  return (
    <div className="flex flex-col gap-space-lg p-space-lg">
      <div className="grid gap-space-lg md:grid-cols-3">
        <div className="flex flex-col gap-space-sm">
          <Label htmlFor="query-dimension">Group by</Label>
          <NativeSelect
            id="query-dimension"
            value={dimensionColumnId}
            onChange={(event) => setDimensionColumnId(event.target.value)}
          >
            <option value={NO_SELECTION}>No grouping</option>
            {columns.map((column) => (
              <option key={column.columnId} value={column.columnId}>
                {column.name}
              </option>
            ))}
          </NativeSelect>
          {dimensionColumn?.type === "timestamptz" ? (
            <NativeSelect
              aria-label="Granularity"
              value={granularity}
              onChange={(event) => setGranularity(toGranularity(event.target.value))}
            >
              {GRANULARITIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          ) : null}
        </div>

        <div className="flex flex-col gap-space-sm">
          <Label htmlFor="query-measure">Measure</Label>
          <NativeSelect
            id="query-measure"
            value={measureFieldId}
            onChange={handleMeasureFieldChange}
          >
            <option value={COUNT_ALL}>Row count</option>
            {columns.map((column) => (
              <option key={column.columnId} value={column.columnId}>
                {column.name}
              </option>
            ))}
          </NativeSelect>
          {measureColumn !== null ? (
            <NativeSelect
              aria-label="Aggregation"
              value={aggregation}
              onChange={(event) => setAggregation(toAggregation(event.target.value))}
            >
              {aggregationOptions(measureColumn.type).map((option) => (
                <option key={option} value={option}>
                  {AGGREGATION_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          ) : null}
        </div>

        <div className="flex flex-col gap-space-sm">
          <Label htmlFor="query-filter">Filter</Label>
          <NativeSelect
            id="query-filter"
            value={filterColumnId}
            onChange={handleFilterColumnChange}
          >
            <option value={NO_SELECTION}>No filter</option>
            {columns.map((column) => (
              <option key={column.columnId} value={column.columnId}>
                {column.name}
              </option>
            ))}
          </NativeSelect>
          {filterColumn !== null ? (
            <div className="flex gap-space-sm">
              <NativeSelect
                aria-label="Filter operator"
                value={filterOperator}
                onChange={(event) => setFilterOperator(toSingleValueOperator(event.target.value))}
              >
                {filterOperatorOptions(filterColumn.type).map((option) => (
                  <option key={option} value={option}>
                    {OPERATOR_LABELS[option]}
                  </option>
                ))}
              </NativeSelect>
              {filterOperatorNeedsValue ? (
                <FilterValueInput
                  column={filterColumn}
                  value={filterValueRaw}
                  onChange={setFilterValueRaw}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-space-sm">
        <Button
          type="button"
          onClick={runQuery}
          disabled={run.status === "loading" || filterPending}
        >
          {run.status === "loading" ? "Running…" : "Run query"}
        </Button>
        {filterPending ? (
          <p className="text-body-sm text-ink-muted">Enter a filter value to run.</p>
        ) : null}
      </div>

      {run.status === "error" ? (
        <p role="alert" className="text-body-sm text-refused">
          {run.message}
        </p>
      ) : null}

      {run.status === "done" ? (
        <QueryResultView
          result={run.result}
          organizationTimezone={organizationTimezone}
          granularity={run.granularity}
          measureLabel={run.measureLabel}
          columnNames={run.columnNames}
        />
      ) : null}
    </div>
  )
}

function FilterValueInput({
  column,
  value,
  onChange,
}: {
  column: DatasetColumnSummary
  value: string
  onChange: (value: string) => void
}) {
  if (column.type === "boolean") {
    return (
      <NativeSelect
        aria-label="Filter value"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose…</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </NativeSelect>
    )
  }
  const inputType = column.type === "integer" || column.type === "decimal" ? "number" : "text"
  return (
    <Input
      aria-label="Filter value"
      type={inputType}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Value"
    />
  )
}

function toGranularity(value: string): Granularity {
  const match = GRANULARITIES.find((option) => option === value)
  return match ?? "month"
}

function toAggregation(value: string): Aggregation {
  const match: readonly Aggregation[] = ["count", "count_distinct", "sum", "avg", "min", "max"]
  return match.find((option) => option === value) ?? "count"
}

function toSingleValueOperator(value: string): SingleValueOperator {
  const match: readonly SingleValueOperator[] = [
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "is_null",
    "is_not_null",
  ]
  return match.find((option) => option === value) ?? "eq"
}

function isSafeErrorDto(value: unknown): value is SafeErrorDto {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof value.message === "string"
  )
}

function isQueryResult(value: unknown): value is QueryResult {
  return typeof value === "object" && value !== null && "queryId" in value && "rows" in value
}
