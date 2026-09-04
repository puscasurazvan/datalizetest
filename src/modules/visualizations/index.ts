/**
 * Public surface of src/modules/visualizations. Recharts is imported only in
 * bar-chart.tsx and must never appear here — see this module's CLAUDE.md.
 */
export type {
  BarVisualizationConfig,
  FieldRef,
  Granularity,
  ResultOrdering,
  TableVisualizationConfig,
  ValueFormat,
  VisualizationConfig,
} from "./config"
export {
  BAR_CHART_CATEGORY_CAP,
  GRANULARITIES,
  VALUE_FORMATS,
  capBarCategories,
  fieldRefName,
  granularityFooterText,
} from "./config"
export type { BarCategoryCapInput, BarCategoryCapping } from "./config"

export { fieldRefSchema, visualizationConfigSchema } from "./config-schema"

export type {
  ConfigMismatch,
  DatalizeColumnType,
  QueryResultShape,
  ValidationResult,
} from "./validate"
export { validateVisualizationConfig } from "./validate"

export type { BarDatum } from "./bar-chart"
export { BarVisualization } from "./bar-chart"
