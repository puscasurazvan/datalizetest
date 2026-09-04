/**
 * Public surface of src/modules/dashboards. `src/app` and Server Actions
 * import dashboard operations from here, never from `./repository` or
 * `./service` directly.
 */
export {
  addWidget,
  getOrCreateDefaultDashboard,
  loadDashboard,
  removeWidget,
  saveLayout,
} from "./service"
export type { DashboardView, DashboardWidgetView, WidgetOutcome, WidgetSize } from "./service"
export type { WidgetLayoutInput } from "./repository"
