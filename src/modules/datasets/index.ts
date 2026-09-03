/**
 * Public surface of src/modules/datasets. `src/app` imports Dataset reads
 * from here, never from `./repository` directly.
 */
export {
  getDatasetDetail,
  getDatasetSchema,
  listDatasetsForContext,
  PREVIEW_ROW_LIMIT,
} from "./service"
export type { DatasetDetail } from "./service"
export type {
  DatasetColumnSummary,
  DatasetColumnType,
  DatasetSummary,
  DatasetVersionSummary,
} from "./repository"
