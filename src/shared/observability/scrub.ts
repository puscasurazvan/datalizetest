/**
 * Pure scrubbing of arbitrary, JSON-shaped payloads before they reach a log line,
 * a Sentry event, or a trace. No Sentry import here — this module knows nothing
 * about where its output goes, only what must never leave this process unredacted:
 *
 *   - dataset content: any field that could carry customer row/cell/value data
 *   - physical identifiers: analytical-store table/schema names (docs/adr/0002 —
 *     these must never leave the analytical store, full stop)
 *   - credentials: connection strings, bearer tokens, passwords, secrets, cookies
 *
 * Scope: this operates on JSON-like structures (objects, arrays, primitives) —
 * the shape a structured log line or a Sentry `extra`/breadcrumb payload actually
 * has. A `Date`, `Map`, or class instance is treated as opaque rather than walked,
 * since scrub has no way to know what a custom `toJSON` might expose.
 */

const DEFAULT_MAX_DEPTH = 8

const DATASET_CONTENT_MARKER = "[REDACTED:dataset-content]"
const CREDENTIAL_MARKER = "[REDACTED:credential]"
const DEPTH_EXCEEDED_MARKER = "[REDACTED:max-depth-exceeded]"
const NON_SERIALIZABLE_MARKER = "[REDACTED:non-serializable]"

// Keys that name dataset content outright: "row", "rows", "cellValue", "csvRow", ...
const DATASET_CONTENT_WORDS = new Set([
  "row",
  "rows",
  "value",
  "values",
  "csv",
  "cell",
  "cells",
  "data",
  "payload",
])

// A key can contain a dataset-content word as a benign suffix/prefix qualifier
// ("rowCount", "valueType") rather than as the content itself. Only skip the key
// when every *other* word in it is one of these known-benign qualifiers.
const SAFE_METADATA_SUFFIXES = new Set([
  "count",
  "index",
  "idx",
  "id",
  "ids",
  "at",
  "timestamp",
  "url",
  "uri",
  "name",
  "label",
  "type",
  "kind",
  "status",
  "code",
  "number",
  "num",
  "total",
  "size",
  "length",
  "version",
  "ms",
  "seconds",
  "duration",
])

const CREDENTIAL_NEEDLES = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "cookie",
  "authorization",
  "dsn",
  "bearer",
  "accesskey",
  "privatekey",
  "connectionstring",
]

// Any scheme with embedded user:pass@ credentials, e.g. postgres://u:p@host/db
const CREDENTIALED_URL_RE = /\b\w+:\/\/[^\s:@/]+:[^\s@]+@\S+/gi
// A database connection string even without embedded credentials.
const KNOWN_DB_SCHEME_RE =
  /\b(?:jdbc:)?(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql|mariadb):\/\/\S+/gi
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi
// "analytical.dv_9f8e7d" — schema-qualified physical identifiers.
const ANALYTICAL_SCHEMA_RE = /\banalytical\.[a-zA-Z_][a-zA-Z0-9_]*\b/gi
// A bare physical table id, e.g. "dv_9f8e7d", without the schema prefix.
const PHYSICAL_TABLE_ID_RE = /\bdv_[0-9a-f]+\b/gi
const SECRET_QUERY_PARAM_RE = /\b(api[_-]?key|token|secret|password|access[_-]?key)=[^&\s]+/gi

function wordsOf(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase())
}

function isDatasetContentKey(key: string): boolean {
  const words = wordsOf(key)
  const hasTargetWord = words.some((word) => DATASET_CONTENT_WORDS.has(word))
  if (!hasTargetWord) return false

  const otherWords = words.filter((word) => !DATASET_CONTENT_WORDS.has(word))
  if (otherWords.length === 0) return true
  return otherWords.some((word) => !SAFE_METADATA_SUFFIXES.has(word))
}

function isCredentialKey(key: string): boolean {
  const flat = key.toLowerCase().replace(/[^a-z0-9]/g, "")
  return CREDENTIAL_NEEDLES.some((needle) => flat.includes(needle))
}

function scrubString(input: string): string {
  return input
    .replace(CREDENTIALED_URL_RE, "[REDACTED:connection-string]")
    .replace(KNOWN_DB_SCHEME_RE, "[REDACTED:connection-string]")
    .replace(BEARER_TOKEN_RE, "[REDACTED:bearer-token]")
    .replace(ANALYTICAL_SCHEMA_RE, "[REDACTED:analytical-schema]")
    .replace(PHYSICAL_TABLE_ID_RE, "[REDACTED:physical-id]")
    .replace(SECRET_QUERY_PARAM_RE, "$1=[REDACTED]")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function scrubEntries(
  obj: Record<string, unknown>,
  depth: number,
  maxDepth: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const key of Object.keys(obj)) {
    if (isCredentialKey(key)) {
      result[key] = CREDENTIAL_MARKER
      continue
    }
    if (isDatasetContentKey(key)) {
      result[key] = DATASET_CONTENT_MARKER
      continue
    }
    result[key] = scrubValue(obj[key], depth + 1, maxDepth)
  }

  return result
}

function scrubValue(value: unknown, depth: number, maxDepth: number): unknown {
  if (depth > maxDepth) return DEPTH_EXCEEDED_MARKER
  if (value === null || value === undefined) return value
  if (typeof value === "string") return scrubString(value)
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => scrubValue(item, depth + 1, maxDepth))
  }
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message) }
  }
  if (isPlainObject(value)) return scrubEntries(value, depth, maxDepth)
  // Function, symbol, Date, RegExp, Map, Set, class instance, ... — see file header.
  return NON_SERIALIZABLE_MARKER
}

/**
 * Redacts dataset content, physical identifiers, and credentials from a value
 * headed for a log line or an error report. Never mutates its input, and is
 * depth-limited so a cyclic object (`obj.self = obj`) terminates rather than
 * recursing forever.
 */
export function scrub(input: string, maxDepth?: number): string
export function scrub(input: Record<string, unknown>, maxDepth?: number): Record<string, unknown>
export function scrub(input: unknown, maxDepth?: number): unknown
export function scrub(input: unknown, maxDepth: number = DEFAULT_MAX_DEPTH): unknown {
  return scrubValue(input, 0, maxDepth)
}
