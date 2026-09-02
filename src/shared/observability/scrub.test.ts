import { describe, expect, it } from "vitest"

import { scrub } from "./scrub"

describe("scrub", () => {
  it("redacts a fake CSV row object carried under 'rows' and 'row'", () => {
    const payload = {
      datasetId: "ds_123",
      rows: [{ email: "user@example.com", amount: 42 }],
      row: { name: "Alice", ssn: "123-45-6789" },
    }

    expect(scrub(payload)).toEqual({
      datasetId: "ds_123",
      rows: "[REDACTED:dataset-content]",
      row: "[REDACTED:dataset-content]",
    })
  })

  it("redacts dataset-content keys nested inside other objects and arrays", () => {
    const payload = {
      import: {
        sampledValues: ["a", "b"],
        cells: [{ csv: "1,2,3" }],
      },
    }

    expect(scrub(payload)).toEqual({
      import: {
        sampledValues: "[REDACTED:dataset-content]",
        cells: "[REDACTED:dataset-content]",
      },
    })
  })

  it("does not flag benign keys that merely contain a dataset-content word as a qualifier", () => {
    const payload = { rowCount: 1_000_000, valueType: "decimal" }

    expect(scrub(payload)).toEqual(payload)
  })

  it("redacts a postgres:// connection string embedded in free text", () => {
    const payload = {
      message: "connecting to postgres://app:hunter2@db.internal:5432/prod failed",
    }

    expect(scrub(payload)).toEqual({
      message: "connecting to [REDACTED:connection-string] failed",
    })
  })

  it("redacts a schema-qualified physical identifier ('analytical.dv_9f8e7d')", () => {
    const payload = { table: "analytical.dv_9f8e7d" }

    expect(scrub(payload)).toEqual({ table: "[REDACTED:analytical-schema]" })
  })

  it("redacts a bare physical table id without the schema prefix", () => {
    const payload = { hint: "failed to load dv_9f8e7d" }

    expect(scrub(payload)).toEqual({ hint: "failed to load [REDACTED:physical-id]" })
  })

  it("redacts a bearer token embedded in free text", () => {
    const payload = { header: "Authorization: Bearer abc123.def456-ghi" }

    expect(scrub(payload)).toEqual({ header: "Authorization: [REDACTED:bearer-token]" })
  })

  it("redacts credential-named fields regardless of value shape, including nested ones", () => {
    const payload = {
      password: "hunter2",
      apiKey: "sk-abcdef",
      connectionString: "opaque-handle",
      nested: { cookie: "session=abc" },
    }

    expect(scrub(payload)).toEqual({
      password: "[REDACTED:credential]",
      apiKey: "[REDACTED:credential]",
      connectionString: "[REDACTED:credential]",
      nested: { cookie: "[REDACTED:credential]" },
    })
  })

  it("terminates on a cyclic object instead of hanging, and breaks the cycle", () => {
    const cyclic: Record<string, unknown> = { name: "loop" }
    cyclic.self = cyclic

    const result = scrub(cyclic)

    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it("terminates on a cyclic array instead of hanging", () => {
    const cyclic: unknown[] = ["start"]
    cyclic.push(cyclic)

    const result = scrub(cyclic)

    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it("passes a benign object through unchanged", () => {
    const benign = {
      datasetId: "ds_123",
      ownerId: "org_456",
      count: 3,
      tags: ["finance", "q3"],
      createdAt: "2026-01-01T00:00:00.000Z",
    }

    expect(scrub(benign)).toEqual(benign)
  })

  it("does not mutate the input", () => {
    const original = { rows: [{ amount: 1 }], meta: { count: 1 } }
    const snapshot = JSON.parse(JSON.stringify(original))

    scrub(original)

    expect(original).toEqual(snapshot)
  })
})
