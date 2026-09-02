// Hand-written CSV writer (RFC 4180 quoting). The repo has no CSV parser or
// writer dependency yet — this is the small piece the fixture generator needs,
// kept separate from a real import-pipeline parser.

const NEEDS_QUOTING = /[",\n]/

/** Quotes a single field only when it contains a comma, a quote, or a newline. */
export function csvField(value: string): string {
  if (!NEEDS_QUOTING.test(value)) return value
  return `"${value.replaceAll('"', '""')}"`
}

/** Joins already-ordered values into one CSV line, without a trailing newline. */
export function csvLine(values: readonly string[]): string {
  return values.map(csvField).join(",")
}
