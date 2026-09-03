/**
 * Benchmark gate (docs/decisions/06 item 15 / docs/decisions/01 "Ceiling
 * Conflict — Resolved"). Runs the real two-phase import pipeline
 * (src/modules/imports) against the dev Postgres on 5433 for each of the
 * three canonical fixtures, at the file size that actually binds first for
 * that fixture's schema (the byte ceiling — see tests/fixtures/README.md's
 * arithmetic), and then benchmarks the interactive aggregation query
 * decisions/01 names directly against the loaded physical table.
 *
 * Not part of src/ — this is a one-off measurement tool, run by hand, ONE
 * FIXTURE PER PROCESS (`--fixture=transactions_stripe|customers_saaS|events_product`,
 * optionally `--small` to use the committed 1,000-row fixtures for a smoke
 * test). Each invocation is a fresh Node process so one fixture's resident
 * memory can never bleed into the next one's "peak RSS" reading — the
 * previous version of this script ran all three fixtures in one process and
 * the second and third fixtures' baseline RSS visibly inherited the first
 * fixture's still-resident buffers, which is not a legitimate reading of
 * "this fixture's peak RSS starting cold":
 *
 *   DATABASE_URL=... ANALYTICAL_DATABASE_URL=... BETTER_AUTH_SECRET=... \
 *     BETTER_AUTH_URL=... npx tsx --expose-gc bench/storage-benchmark.ts --fixture=transactions_stripe
 *
 * `bench/run-all.sh` runs all three as separate processes and prints the
 * combined table. Results are written to bench/results/<fixture>.json
 * (gitignored).
 */
import { randomUUID } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"

import { eq } from "drizzle-orm"

import { PostgresAnalyticalStore } from "@/modules/analytical-store"
import { qualifiedTableName } from "@/modules/analytical-store/physical-names"
import { InMemoryStorageProvider } from "@/modules/storage"
import type { ObjectKey, StorageProvider, UploadTarget, ObjectStat } from "@/modules/storage"
import { createTestRequestContext } from "@/shared/context/testing"
import type { RequestContext } from "@/shared/context/request-context"
import type { JobDispatcher, JobPayload, JobReference, JobType } from "@/modules/jobs"

import { analyticalPool, importPool, ANALYTICAL_STATEMENT_TIMEOUT_MS } from "@/db/analytical"
import { applicationPool, db } from "@/db/client"
import {
  analyticalColumns,
  analyticalTables,
  datasetColumns,
  datasets,
  datasetVersions,
  importErrors,
  imports,
  organizations,
  users,
} from "@/db/schema"

import { startImport } from "@/modules/imports/internal/start"
import { confirmImport } from "@/modules/imports/internal/confirm"
import { profileImport } from "@/modules/imports/internal/profile"
import { loadImport } from "@/modules/imports/internal/load"
import { getImportForContext } from "@/modules/imports/repository/import-repository"

// ---------------------------------------------------------------------------
// Chunked storage read (matches an S3 GetObject stream's chunking)
// ---------------------------------------------------------------------------

/**
 * `InMemoryStorageProvider.readObject` hands the whole stored buffer to
 * `ReadableStreamDefaultController.enqueue` in one call — one 50 MB chunk.
 * `csv-parse`'s transform stream then has no backpressure signal to react
 * to inside that single chunk, so it parses the whole file and queues
 * hundreds of thousands of records before the consumer can drain any of
 * them: a real S3 `GetObject` body arrives as a stream of ~16-64 KB
 * chunks and never does this. Wrapping the read side to re-chunk at 64 KB
 * (network-ish chunking, not the multi-megabyte single enqueue) is what
 * makes this benchmark's peak-RSS numbers a reading of the pipeline's own
 * streaming discipline rather than of this one test double's shortcut.
 * Everything else (writes, stat, delete) delegates unchanged.
 */
const READ_CHUNK_BYTES = 64 * 1024

class ChunkedStorageProvider implements StorageProvider {
  constructor(private readonly inner: InMemoryStorageProvider) {}

  createUploadTarget(organizationId: string): Promise<UploadTarget> {
    return this.inner.createUploadTarget(organizationId)
  }

  receiveUpload(target: UploadTarget, bytes: Uint8Array): Promise<void> {
    return this.inner.receiveUpload(target, bytes)
  }

  async readObject(key: ObjectKey): Promise<ReadableStream<Uint8Array> | undefined> {
    const inner = await this.inner.readObject(key)
    if (inner === undefined) return undefined

    const reader = inner.getReader()
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        for (let offset = 0; offset < value.byteLength; offset += READ_CHUNK_BYTES) {
          controller.enqueue(value.subarray(offset, offset + READ_CHUNK_BYTES))
        }
      },
    })
  }

  deleteObject(key: ObjectKey): Promise<void> {
    return this.inner.deleteObject(key)
  }

  statObject(key: ObjectKey): Promise<ObjectStat | undefined> {
    return this.inner.statObject(key)
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const RESULTS_DIR = path.join(process.cwd(), "bench/results")
mkdirSync(RESULTS_DIR, { recursive: true })

const runId = randomUUID()
const userId = randomUUID()
const organizationId = randomUUID()
const TIMEZONE = "UTC"

// `rawStorage` is what receives the test upload (`receiveUpload` is a
// test-only method InMemoryStorageProvider exposes, not part of
// StorageProvider). `storage` is what the pipeline actually reads through
// — chunked, per the class doc above.
const rawStorage = new InMemoryStorageProvider()
const storage: StorageProvider = new ChunkedStorageProvider(rawStorage)
const analyticalStore = new PostgresAnalyticalStore()

/** Never dispatches anything — every phase is invoked directly, by hand, so
 * this benchmark controls exactly when each phase starts and stops instead
 * of letting InlineDispatcher run profile/load as a side effect of enqueue. */
const noopDispatcher: JobDispatcher = {
  async enqueue<T extends JobType>(_type: T, _payload: JobPayload<T>): Promise<JobReference> {
    return { runId: randomUUID() }
  },
}

function contextFor(timezone: string): RequestContext {
  return createTestRequestContext({
    userId,
    organizationId,
    role: "owner",
    organizationTimezone: timezone,
  })
}

// ---------------------------------------------------------------------------
// Memory + timing sampling
// ---------------------------------------------------------------------------

type PhaseMeasurement = {
  readonly wallMs: number
  readonly baselineRssBytes: number
  readonly peakRssBytes: number
}

async function measurePhase<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; measurement: PhaseMeasurement }> {
  if (global.gc) global.gc()
  await new Promise((resolve) => setTimeout(resolve, 50))

  const baselineRssBytes = process.memoryUsage().rss
  let peakRssBytes = baselineRssBytes
  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss
    if (rss > peakRssBytes) peakRssBytes = rss
  }, 40)

  const t0 = performance.now()
  const result = await fn()
  const wallMs = performance.now() - t0

  clearInterval(sampler)
  // one last sample in case the peak landed after the final interval tick
  const finalRss = process.memoryUsage().rss
  if (finalRss > peakRssBytes) peakRssBytes = finalRss

  return { result, measurement: { wallMs, baselineRssBytes, peakRssBytes } }
}

function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10
}

// ---------------------------------------------------------------------------
// Aggregation latency benchmark
// ---------------------------------------------------------------------------

type LatencyStats = {
  readonly runs: number
  readonly coldMs: number
  readonly p50Ms: number
  readonly p95Ms: number
  readonly minMs: number
  readonly maxMs: number
}

function percentile(sortedMs: readonly number[], p: number): number {
  const index = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length))
  const value = sortedMs[index]
  if (value === undefined) throw new Error("percentile: empty sample")
  return Math.round(value * 100) / 100
}

async function benchmarkAggregation(
  versionId: string,
  amountColumn: string,
  currencyColumn: string,
  createdAtColumn: string,
  currencyValue: string,
  runs: number,
): Promise<LatencyStats> {
  const table = qualifiedTableName(versionId)
  const sql = `select date_trunc('month', "${createdAtColumn}") as month, sum("${amountColumn}") as total
               from ${table}
               where "${currencyColumn}" = $1
               group by 1
               order by 1`

  const timings: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    // oxlint-disable-next-line no-await-in-loop -- latency measurement is inherently sequential: each run must see a fresh clock.
    await analyticalPool.query(sql, [currencyValue])
    timings.push(performance.now() - t0)
  }

  const coldMs = timings[0]
  if (coldMs === undefined) throw new Error("benchmarkAggregation: no runs")
  const sorted = timings.toSorted((a, b) => a - b)
  return {
    runs,
    coldMs: Math.round(coldMs * 100) / 100,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    minMs: percentile(sorted, 0),
    maxMs: percentile(sorted, 100),
  }
}

// ---------------------------------------------------------------------------
// Per-fixture run
// ---------------------------------------------------------------------------

type FixtureResult = {
  fixture: string
  filePath: string
  fileSizeBytes: number
  profile: PhaseMeasurement & { rowsRead: number }
  load: PhaseMeasurement & { rowsImported: number; rowsRejected: number; rowsPerSecond: number }
  physicalTableBytes: number
  aggregation?: LatencyStats
}

async function runFixture(
  fixtureLabel: string,
  filePath: string,
  aggregationColumns?: { amountName: string; currencyName: string; createdAtName: string },
): Promise<FixtureResult> {
  console.log(`\n=== ${fixtureLabel} (${filePath}) ===`)
  const bytes = readFileSync(filePath)
  const fileSizeBytes = bytes.byteLength
  console.log(`file: ${mb(fileSizeBytes)} MiB`)

  const target = await rawStorage.createUploadTarget(organizationId)
  await rawStorage.receiveUpload(target, bytes)

  const context = contextFor(TIMEZONE)
  const { importId } = await startImport(
    context,
    {
      objectKey: target.key.value,
      originalFilename: path.basename(filePath),
      contentType: "text/csv",
      datasetName: `Bench ${fixtureLabel} ${runId}`,
    },
    { storage, jobDispatcher: noopDispatcher },
  )

  // --- Phase 1: import.profile ---
  const { measurement: profileMeasurement } = await measurePhase(() =>
    profileImport(context, importId, { storage }),
  )
  const afterProfile = await getImportForContext(context, importId)
  if (afterProfile.status !== "AWAITING_CONFIRMATION") {
    throw new Error(`profile did not reach AWAITING_CONFIRMATION: status=${afterProfile.status}`)
  }
  console.log(
    `profile: ${(profileMeasurement.wallMs / 1000).toFixed(2)}s wall, peak RSS ${mb(profileMeasurement.peakRssBytes)} MiB (baseline ${mb(profileMeasurement.baselineRssBytes)} MiB)`,
  )

  // --- Confirm (untimed — a metadata write, not part of either measured phase) ---
  await confirmImport(context, { importId }, { jobDispatcher: noopDispatcher })

  // --- Phase 2: import.load ---
  const { measurement: loadMeasurement } = await measurePhase(() =>
    loadImport(context, importId, { storage, analyticalStore }),
  )
  const afterLoad = await getImportForContext(context, importId)
  if (afterLoad.status !== "COMPLETED") {
    throw new Error(`load did not complete: status=${afterLoad.status}`)
  }
  const versionId = afterLoad.datasetVersionId
  if (versionId === null) throw new Error("expected a dataset version id after load")

  const rowsImported = afterLoad.rowsImported ?? 0
  const rowsPerSecond = Math.round(rowsImported / (loadMeasurement.wallMs / 1000))
  console.log(
    `load: ${(loadMeasurement.wallMs / 1000).toFixed(2)}s wall, peak RSS ${mb(loadMeasurement.peakRssBytes)} MiB (baseline ${mb(loadMeasurement.baselineRssBytes)} MiB), ${rowsImported} rows, ${rowsPerSecond} rows/s`,
  )

  const sizeResult = await importPool.query<{ size: string }>(
    `select pg_total_relation_size($1)::text as size`,
    [qualifiedTableName(versionId)],
  )
  const physicalTableBytesRow = sizeResult.rows[0]
  const physicalTableBytes = physicalTableBytesRow ? Number(physicalTableBytesRow.size) : -1
  console.log(`physical table size on disk: ${mb(physicalTableBytes)} MiB`)

  const result: FixtureResult = {
    fixture: fixtureLabel,
    filePath,
    fileSizeBytes,
    profile: { ...profileMeasurement, rowsRead: afterProfile.rowsRead ?? 0 },
    load: {
      ...loadMeasurement,
      rowsImported,
      rowsRejected: afterLoad.rowsRejected ?? 0,
      rowsPerSecond,
    },
    physicalTableBytes,
  }

  // --- Aggregation latency (only for the fixture decisions/01 names) ---
  if (aggregationColumns) {
    const columnMap = await physicalColumnMap(versionId)
    const amountColumn = columnMap.get(aggregationColumns.amountName)
    const currencyColumn = columnMap.get(aggregationColumns.currencyName)
    const createdAtColumn = columnMap.get(aggregationColumns.createdAtName)
    if (!amountColumn || !currencyColumn || !createdAtColumn) {
      throw new Error("could not resolve physical columns for aggregation benchmark")
    }

    const currencyValue = await mostCommonCurrency(versionId, currencyColumn)
    console.log(
      `aggregation benchmark: SUM(amount) GROUP BY month(created_at) WHERE currency = '${currencyValue}'`,
    )

    const stats = await benchmarkAggregation(
      versionId,
      amountColumn,
      currencyColumn,
      createdAtColumn,
      currencyValue,
      30,
    )
    console.log(
      `  cold=${stats.coldMs}ms p50=${stats.p50Ms}ms p95=${stats.p95Ms}ms min=${stats.minMs}ms max=${stats.maxMs}ms over ${stats.runs} runs`,
    )
    result.aggregation = stats
  }

  return result
}

async function physicalColumnMap(versionId: string): Promise<Map<string, string>> {
  const namesAndIds = await db
    .select({ columnId: datasetColumns.columnId, name: datasetColumns.name })
    .from(datasetColumns)
    .where(eq(datasetColumns.datasetVersionId, versionId))

  const physical = await db
    .select({ columnId: analyticalColumns.columnId, physicalName: analyticalColumns.physicalName })
    .from(analyticalColumns)
    .where(eq(analyticalColumns.datasetVersionId, versionId))

  const physicalByColumnId = new Map(physical.map((p) => [p.columnId, p.physicalName] as const))
  const result = new Map<string, string>()
  for (const { columnId, name } of namesAndIds) {
    const physicalName = physicalByColumnId.get(columnId)
    if (physicalName) result.set(name, physicalName)
  }
  return result
}

async function mostCommonCurrency(versionId: string, currencyColumn: string): Promise<string> {
  const table = qualifiedTableName(versionId)
  const result = await importPool.query<{ value: string; count: string }>(
    `select "${currencyColumn}" as value, count(*)::text as count from ${table} group by 1 order by 2 desc limit 1`,
  )
  const row = result.rows[0]
  if (!row) throw new Error("no currency values found")
  return row.value
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanupOrganization(): Promise<void> {
  const versions = await db
    .select({ id: datasetVersions.id })
    .from(datasetVersions)
    .where(eq(datasetVersions.organizationId, organizationId))

  for (const version of versions) {
    // oxlint-disable-next-line no-await-in-loop -- teardown, one-at-a-time is fine.
    await analyticalStore.dropVersion(contextFor(TIMEZONE), version.id)
  }

  await db.delete(analyticalColumns).where(eq(analyticalColumns.organizationId, organizationId))
  await db.delete(analyticalTables).where(eq(analyticalTables.organizationId, organizationId))
  await db.delete(importErrors).where(eq(importErrors.organizationId, organizationId))
  await db.delete(imports).where(eq(imports.organizationId, organizationId))
  await db.delete(datasetColumns).where(eq(datasetColumns.organizationId, organizationId))
  await db.delete(datasetVersions).where(eq(datasetVersions.organizationId, organizationId))
  await db.delete(datasets).where(eq(datasets.organizationId, organizationId))
  await db.delete(organizations).where(eq(organizations.id, organizationId))
  await db.delete(users).where(eq(users.id, userId))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const FIXTURES = {
  transactions_stripe: {
    label: "transactions_stripe",
    aggregationColumns: {
      amountName: "amount",
      currencyName: "currency",
      createdAtName: "created_at",
    },
  },
  customers_saaS: { label: "customers_saaS", aggregationColumns: undefined },
  events_product: { label: "events_product", aggregationColumns: undefined },
} as const
type FixtureKey = keyof typeof FIXTURES

function parseFixtureArg(): FixtureKey {
  const arg = process.argv.find((a) => a.startsWith("--fixture="))
  const key = arg?.slice("--fixture=".length)
  if (key === "transactions_stripe" || key === "customers_saaS" || key === "events_product") {
    return key
  }
  throw new Error("pass --fixture=transactions_stripe|customers_saaS|events_product")
}

async function main(): Promise<void> {
  const fixtureKey = parseFixtureArg()
  const fixture = FIXTURES[fixtureKey]
  console.log(`Benchmark run ${runId} — fixture ${fixtureKey}`)
  console.log(`analytical pool statement_timeout: ${ANALYTICAL_STATEMENT_TIMEOUT_MS}ms`)

  await db.insert(users).values({
    id: userId,
    name: "Storage Benchmark",
    email: `storage-benchmark-${runId}@example.test`,
    emailVerified: true,
  })
  await db.insert(organizations).values({
    id: organizationId,
    name: "Storage Benchmark Org",
    slug: `storage-benchmark-${runId}`,
  })

  const small = process.argv.includes("--small")
  const dir = small
    ? path.join(process.cwd(), "tests/fixtures")
    : path.join(process.cwd(), "tests/fixtures/generated")
  const suffix = small ? "" : "_ceiling"
  const filePath = path.join(dir, `${fixtureKey}${suffix}.csv`)

  let result: FixtureResult
  try {
    result = await runFixture(fixture.label, filePath, fixture.aggregationColumns)
  } finally {
    await cleanupOrganization()
  }

  writeFileSync(path.join(RESULTS_DIR, `${fixtureKey}.json`), JSON.stringify(result, null, 2))
  console.log("\n=== RESULT ===")
  console.log(JSON.stringify(result, null, 2))

  await importPool.end()
  await analyticalPool.end()
  await applicationPool.end()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
