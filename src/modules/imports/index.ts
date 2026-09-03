/**
 * Public surface of src/modules/imports (docs/decisions/06 #1). Other
 * modules and `src/app` import the two-phase import pipeline from here —
 * never from `./internal/*` or `./repository/*` directly.
 */
export { startImportAction } from "./start-action"
export { confirmImportAction } from "./confirm-action"

export { registerImportTasks } from "./internal/register-tasks"
export type { ImportTaskDeps } from "./internal/register-tasks"
export type { CreateContextForImport } from "./internal/job-context"
export {
  ensureImportTasksRegistered,
  productionImportTaskDeps,
} from "./internal/register-production-tasks"

export { profileImport } from "./internal/profile"
export type { ProfileImportDeps } from "./internal/profile"
export { loadImport } from "./internal/load"
export type { LoadImportDeps } from "./internal/load"
export { startImport, startImportInputSchema } from "./internal/start"
export type { StartImportDeps, StartImportInput, StartImportResult } from "./internal/start"
export { confirmImport, confirmImportInputSchema } from "./internal/confirm"
export type { ConfirmImportDeps, ConfirmImportInput, ConfirmImportResult } from "./internal/confirm"

export type {
  ColumnOverride,
  ConfirmedSchema,
  ConfirmedSchemaColumn,
  ProposedSchema,
  ProposedSchemaColumn,
} from "./internal/schema-types"

export { findImportOwnerById } from "./repository/import-repository"
export type { ImportRow, ImportStatus } from "./repository/import-repository"
