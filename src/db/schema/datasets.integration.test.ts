import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

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

// Constraint behaviour for the Slice 1 schema (src/db/schema/datasets.ts).
// Every other module builds against these exact names and shapes, so this
// asserts what the database actually enforces, not just what the Drizzle
// types claim.
describe("datasets schema (integration)", () => {
  const runId = randomUUID()
  const userId = randomUUID()
  const organizationId = randomUUID()

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      name: "Datasets Schema Test User",
      email: `datasets-schema-${runId}@example.test`,
      emailVerified: true,
    })

    await db.insert(organizations).values({
      id: organizationId,
      name: "Datasets Schema Test Org",
      slug: `datasets-schema-${runId}`,
    })
  })

  afterAll(async () => {
    // Children first: analytical_columns -> analytical_tables -> dataset
    // rows are all cascade or restrict-guarded, so clean up in dependency
    // order rather than relying on cascade alone.
    await db.delete(analyticalColumns).where(eq(analyticalColumns.organizationId, organizationId))
    await db.delete(analyticalTables).where(eq(analyticalTables.organizationId, organizationId))
    await db.delete(importErrors).where(eq(importErrors.organizationId, organizationId))
    await db.delete(imports).where(eq(imports.organizationId, organizationId))
    await db.delete(datasetColumns).where(eq(datasetColumns.organizationId, organizationId))
    await db.delete(datasetVersions).where(eq(datasetVersions.organizationId, organizationId))
    await db.delete(datasets).where(eq(datasets.organizationId, organizationId))
    await db.delete(organizations).where(eq(organizations.id, organizationId))
    await db.delete(users).where(eq(users.id, userId))
    await applicationPool.end()
  })

  it("rejects a dataset_versions row with a null timezoneUsedForNaiveTimestamps", async () => {
    // docs/decisions/03: "timezoneUsedForNaiveTimestamps is never null" is a
    // database-level guarantee, not merely a Drizzle type — the insert
    // shape below is what a caller bypassing the TS layer entirely (a raw
    // migration, a different client) could still attempt, so this goes
    // through raw SQL rather than `db.insert`, which the TS types already
    // refuse to compile with the field omitted.
    const datasetId = randomUUID()
    await db.insert(datasets).values({
      id: datasetId,
      organizationId,
      name: "Timezone NOT NULL Test",
      createdByUserId: userId,
    })

    await expect(
      db.execute(
        `insert into dataset_versions
          (id, organization_id, dataset_id, version_number, status)
         values
          ('${randomUUID()}', '${organizationId}', '${datasetId}', 1, 'RUNNING')`,
      ),
      // Postgres error code 23502: not_null_violation.
    ).rejects.toMatchObject({ cause: { code: "23502" } })
  })

  it("rejects an unknown dataset_versions.status value", async () => {
    const datasetId = randomUUID()
    await db.insert(datasets).values({
      id: datasetId,
      organizationId,
      name: "Status Enum Test",
      createdByUserId: userId,
    })

    await expect(
      db.execute(
        `insert into dataset_versions
          (id, organization_id, dataset_id, version_number, status, timezone_used_for_naive_timestamps)
         values
          ('${randomUUID()}', '${organizationId}', '${datasetId}', 1, 'NOT_A_REAL_STATUS', 'UTC')`,
      ),
      // Postgres error code 22P02: invalid_text_representation (bad enum label).
    ).rejects.toMatchObject({ cause: { code: "22P02" } })
  })

  it("rejects a second dataset_versions row for the same (dataset_id, version_number)", async () => {
    const datasetId = randomUUID()
    await db.insert(datasets).values({
      id: datasetId,
      organizationId,
      name: "Version Uniqueness Test",
      createdByUserId: userId,
    })

    await db.insert(datasetVersions).values({
      id: randomUUID(),
      organizationId,
      datasetId,
      versionNumber: 1,
      status: "COMPLETED",
      timezoneUsedForNaiveTimestamps: "UTC",
    })

    await expect(
      db.insert(datasetVersions).values({
        id: randomUUID(),
        organizationId,
        datasetId,
        versionNumber: 1,
        status: "COMPLETED",
        timezoneUsedForNaiveTimestamps: "UTC",
      }),
    ).rejects.toMatchObject({
      cause: { constraint: "dataset_versions_organization_dataset_version_idx" },
    })
  })

  it("rejects duplicate dataset_columns on each of the three unique tuples", async () => {
    const datasetId = randomUUID()
    await db.insert(datasets).values({
      id: datasetId,
      organizationId,
      name: "Dataset Columns Uniqueness Test",
      createdByUserId: userId,
    })

    const versionId = randomUUID()
    await db.insert(datasetVersions).values({
      id: versionId,
      organizationId,
      datasetId,
      versionNumber: 1,
      status: "COMPLETED",
      timezoneUsedForNaiveTimestamps: "UTC",
    })

    await db.insert(datasetColumns).values({
      id: randomUUID(),
      columnId: "col_amount",
      organizationId,
      datasetVersionId: versionId,
      name: "amount",
      type: "decimal",
      nullable: false,
      position: 0,
    })

    await expect(
      db.insert(datasetColumns).values({
        id: randomUUID(),
        columnId: "col_amount", // duplicate columnId
        organizationId,
        datasetVersionId: versionId,
        name: "amount_2",
        type: "decimal",
        nullable: false,
        position: 1,
      }),
    ).rejects.toMatchObject({
      cause: { constraint: "dataset_columns_organization_version_column_idx" },
    })

    await expect(
      db.insert(datasetColumns).values({
        id: randomUUID(),
        columnId: "col_amount_2",
        organizationId,
        datasetVersionId: versionId,
        name: "amount", // duplicate name
        type: "decimal",
        nullable: false,
        position: 2,
      }),
    ).rejects.toMatchObject({
      cause: { constraint: "dataset_columns_organization_version_name_idx" },
    })

    await expect(
      db.insert(datasetColumns).values({
        id: randomUUID(),
        columnId: "col_amount_3",
        organizationId,
        datasetVersionId: versionId,
        name: "amount_3",
        type: "decimal",
        nullable: false,
        position: 0, // duplicate position
      }),
    ).rejects.toMatchObject({
      cause: { constraint: "dataset_columns_organization_version_position_idx" },
    })
  })

  it("rejects a second imports row for the same (organization_id, idempotency_key)", async () => {
    const datasetId = randomUUID()
    await db.insert(datasets).values({
      id: datasetId,
      organizationId,
      name: "Import Idempotency Test",
      createdByUserId: userId,
    })

    const idempotencyKey = `idem-${randomUUID()}`
    await db.insert(imports).values({
      id: randomUUID(),
      organizationId,
      datasetId,
      idempotencyKey,
      objectKey: "uploads/one.csv",
      originalFilename: "one.csv",
      byteSize: 1024,
      contentType: "text/csv",
      status: "PENDING",
      createdByUserId: userId,
    })

    await expect(
      db.insert(imports).values({
        id: randomUUID(),
        organizationId,
        datasetId,
        idempotencyKey,
        objectKey: "uploads/two.csv",
        originalFilename: "two.csv",
        byteSize: 2048,
        contentType: "text/csv",
        status: "PENDING",
        createdByUserId: userId,
      }),
    ).rejects.toMatchObject({
      cause: { constraint: "imports_organization_idempotency_key_idx" },
    })
  })

  it("round-trips the circular FK: insert dataset, insert version, point current_version_id at it", async () => {
    const datasetId = randomUUID()
    await db.insert(datasets).values({
      id: datasetId,
      organizationId,
      name: "Circular FK Round-Trip Test",
      createdByUserId: userId,
    })

    const versionId = randomUUID()
    await db.insert(datasetVersions).values({
      id: versionId,
      organizationId,
      datasetId,
      versionNumber: 1,
      status: "COMPLETED",
      rowCount: 10,
      columnCount: 2,
      timezoneUsedForNaiveTimestamps: "UTC",
    })

    await db.update(datasets).set({ currentVersionId: versionId }).where(eq(datasets.id, datasetId))

    const [row] = await db.select().from(datasets).where(eq(datasets.id, datasetId))
    expect(row?.currentVersionId).toBe(versionId)
  })

  it("blocks deleting a dataset_versions row while an analytical_tables row still references it", async () => {
    const datasetId = randomUUID()
    await db.insert(datasets).values({
      id: datasetId,
      organizationId,
      name: "Analytical Restrict Test",
      createdByUserId: userId,
    })

    const versionId = randomUUID()
    await db.insert(datasetVersions).values({
      id: versionId,
      organizationId,
      datasetId,
      versionNumber: 1,
      status: "COMPLETED",
      timezoneUsedForNaiveTimestamps: "UTC",
    })

    await db.insert(analyticalTables).values({
      datasetVersionId: versionId,
      organizationId,
      schemaName: "analytical",
      tableName: `dsv_${versionId.replaceAll("-", "_")}`,
    })

    await expect(
      db.delete(datasetVersions).where(eq(datasetVersions.id, versionId)),
      // Postgres error code 23503: foreign_key_violation.
    ).rejects.toMatchObject({ cause: { code: "23503" } })

    // Clean up in the order the restrict FK requires.
    await db.delete(analyticalTables).where(eq(analyticalTables.datasetVersionId, versionId))
    await db.delete(datasetVersions).where(eq(datasetVersions.id, versionId))
  })

  // Regression for the confirmed defect: analytical_tables.organization_id
  // used to be ON DELETE CASCADE, which let an organization delete remove
  // this registry row directly — satisfying datasetVersionId's own
  // "restrict" FK trivially (the row is already gone by the time the
  // cascade reaches dataset_versions) and orphaning the live
  // analytical.dv_* physical table with no registry row left to find it.
  it("blocks deleting an organizations row while an analytical_tables row still references it", async () => {
    const orgId = randomUUID()
    await db.insert(organizations).values({
      id: orgId,
      name: "Org Delete Restrict Test",
      slug: `org-delete-restrict-${randomUUID()}`,
    })

    const datasetId = randomUUID()
    await db.insert(datasets).values({
      id: datasetId,
      organizationId: orgId,
      name: "Org Delete Restrict Dataset",
      createdByUserId: userId,
    })

    const versionId = randomUUID()
    await db.insert(datasetVersions).values({
      id: versionId,
      organizationId: orgId,
      datasetId,
      versionNumber: 1,
      status: "COMPLETED",
      timezoneUsedForNaiveTimestamps: "UTC",
    })

    await db.insert(analyticalTables).values({
      datasetVersionId: versionId,
      organizationId: orgId,
      schemaName: "analytical",
      tableName: `dsv_${versionId.replaceAll("-", "_")}`,
    })

    await expect(
      db.delete(organizations).where(eq(organizations.id, orgId)),
      // Postgres error code 23503: foreign_key_violation. Before the fix
      // this delete succeeded (DELETE 1) and left the analytical_tables
      // row, dataset_versions row, and dataset row all silently swept away.
    ).rejects.toMatchObject({ cause: { code: "23503" } })

    // The whole statement aborted, so every row this test created is still
    // present — verify that, then clean up in restrict-FK order.
    const [survivingTable] = await db
      .select()
      .from(analyticalTables)
      .where(eq(analyticalTables.datasetVersionId, versionId))
    expect(survivingTable).toBeDefined()

    await db.delete(analyticalTables).where(eq(analyticalTables.datasetVersionId, versionId))
    await db.delete(datasetVersions).where(eq(datasetVersions.id, versionId))
    await db.delete(datasets).where(eq(datasets.id, datasetId))
    await db.delete(organizations).where(eq(organizations.id, orgId))
  })
})
