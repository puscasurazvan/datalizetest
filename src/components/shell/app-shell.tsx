import type { ReactNode } from "react"

import { AppHeader } from "@/components/shell/app-header"
import { ProvenanceRail } from "@/components/shell/provenance-rail"
import type { OrganizationSummary } from "@/modules/organizations"

export interface AppShellProps {
  organizations: OrganizationSummary[]
  activeOrganizationId: string
  workspaceName: string
  timezone: string
  userEmail: string
  children: ReactNode
}

/**
 * Fixed chrome above, fixed rail to the left, page in the remaining space. Both
 * are `fixed`, so `main` has to reserve the room itself — `pt-16` for the header
 * and `lg:ml-64` for the rail, which is why the rail is also `lg:flex`: the two
 * appear and disappear together, and content is never left underneath it.
 */
export function AppShell({
  organizations,
  activeOrganizationId,
  workspaceName,
  timezone,
  userEmail,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-full bg-canvas">
      <AppHeader
        organizations={organizations}
        activeOrganizationId={activeOrganizationId}
        timezone={timezone}
        userEmail={userEmail}
      />
      <ProvenanceRail workspaceName={workspaceName} timezone={timezone} />
      <main className="min-h-screen bg-canvas px-gutter-desktop pb-space-2xl pt-16 lg:ml-64">
        <div className="flex w-full max-w-page-max-width flex-col gap-space-xl pt-space-lg">
          {children}
        </div>
      </main>
    </div>
  )
}
