import { Globe, Search, User } from "lucide-react"

import { Brand } from "@/components/brand"
import { PrimaryNav } from "@/components/shell/primary-nav"
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher"
import { NO_VALUE, PENDING_CLASS } from "@/components/ui/pending"
import type { OrganizationSummary } from "@/modules/organizations"

const PILL = "flex items-center gap-space-xs rounded-full bg-surface px-space-sm py-space-2xs"

export interface AppHeaderProps {
  organizations: OrganizationSummary[]
  activeOrganizationId: string
  timezone: string
  userEmail: string
}

/**
 * The fixed 64px chrome from the design. Depth is blur plus a bloom under the
 * bottom edge — never a border.
 */
export function AppHeader({
  organizations,
  activeOrganizationId,
  timezone,
  userEmail,
}: AppHeaderProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 h-16 bg-chrome/80 shadow-[0_1px_12px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      <div className="flex h-16 w-full items-center justify-between gap-space-md px-gutter-desktop">
        <div className="flex min-w-max items-center gap-space-md">
          <Brand />
          <div className="hidden h-4 w-px bg-hairline-strong/40 sm:block" />
          <WorkspaceSwitcher
            organizations={organizations}
            activeOrganizationId={activeOrganizationId}
          />
        </div>

        {/* Always rendered. `PrimaryNav` drops its own inert items on a narrow
            viewport; the real destinations stay reachable at every width. */}
        <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden">
          <PrimaryNav />
        </div>

        <div className="flex min-w-max items-center justify-end gap-space-sm">
          {/* Real: the interpretation applied to every naive CSV timestamp. */}
          <div className={`hidden font-mono text-label-mono text-ink-muted lg:flex ${PILL}`}>
            <Globe strokeWidth={1.5} className="size-3.5 text-cyan" />
            <span>{timezone}</span>
          </div>
          {/* Concurrency slots are not a thing the product measures yet. */}
          <div
            aria-disabled="true"
            title="Concurrency slots are not available yet"
            className={`hidden font-mono text-label-mono 2xl:flex ${PILL} ${PENDING_CLASS}`}
          >
            <span>Slots: {NO_VALUE}</span>
          </div>
          <button
            type="button"
            disabled
            title="Search is not available yet"
            className={`hidden items-center gap-space-sm rounded-lg bg-surface px-space-sm py-space-2xs xl:flex ${PENDING_CLASS}`}
          >
            <Search strokeWidth={1.5} className="size-4" />
            <span className="font-mono text-label-mono">⌘K</span>
          </button>
          <div className="flex items-center gap-space-xs pl-space-xs">
            <span className="hidden font-mono text-code-sm text-ink-muted 2xl:inline">
              {userEmail}
            </span>
            <div className="flex size-8 items-center justify-center rounded-full bg-cyan-solid">
              <User strokeWidth={1.5} className="size-4 text-on-cyan" />
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
