import { and, eq } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core"

import type { RequestContext } from "./context/request-context"

/**
 * Tenant-scoped repository base (src/shared/CLAUDE.md, AGENTS.md: "every
 * tenant-owned row carries organization_id").
 *
 * Every module repository (datasets, imports, saved queries, ...) is built
 * on the two functions below, never on a bare `db.select()` / `db.update()`
 * / `db.insert()` against a tenant-owned table. Both take the verified
 * `RequestContext` as their first argument, and there is no other way to
 * obtain the organization scope fragment, or a row ready to insert: a
 * repository function that "forgets" the scope has nothing to pass here and
 * so cannot assemble a correctly scoped query without hand-writing the
 * `organization_id` predicate itself — which is exactly the mistake this
 * module exists to make visible on read.
 */

/** A Drizzle pg table that carries the mandatory `organization_id` column. */
export interface TenantScopedTable extends PgTable {
  organizationId: AnyPgColumn<{ data: string }>
}

/** The WHERE fragment that scopes any query against `table` to `context`'s organization. */
export function organizationScope<TTable extends TenantScopedTable>(
  context: RequestContext,
  table: TTable,
): SQL {
  return eq(table.organizationId, context.organizationId)
}

/**
 * Combine the mandatory organization scope with any number of additional
 * predicates. Use this instead of a bare `and(...)` in a repository
 * function so the organization scope can never be dropped by accident as
 * the function grows more filters — it is always the first clause, always
 * present, and the only one this function supplies on its own.
 */
export function scopedWhere<TTable extends TenantScopedTable>(
  context: RequestContext,
  table: TTable,
  ...predicates: Array<SQL | undefined>
): SQL {
  const combined = and(organizationScope(context, table), ...predicates)
  if (!combined) {
    // Unreachable: organizationScope's clause is always present, so `and`
    // always receives at least one defined condition.
    throw new Error("scopedWhere: failed to build a scoped WHERE clause")
  }
  return combined
}

/**
 * Attach the caller's organization to a row about to be inserted into a
 * tenant-owned table. Use this to build `db.insert(table).values(...)`
 * arguments so a new row can never be written without its scope.
 */
export function withOrganizationId<TRow extends Record<string, unknown>>(
  context: RequestContext,
  row: TRow,
): TRow & { organizationId: string } {
  return { ...row, organizationId: context.organizationId }
}
