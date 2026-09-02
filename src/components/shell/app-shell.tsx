import Link from "next/link"
import type { ReactNode } from "react"

import { SignOutButton } from "@/components/shell/sign-out-button"
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher"
import type { OrganizationSummary } from "@/modules/organizations"

const NAV_LINKS = [
  { href: "/datasets", label: "Datasets" },
  { href: "/settings", label: "Workspace settings" },
] as const

export interface AppShellProps {
  organizations: OrganizationSummary[]
  activeOrganizationId: string
  children: ReactNode
}

export function AppShell({ organizations, activeOrganizationId, children }: AppShellProps) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-foreground">Datalize</span>
          <nav aria-label="Primary" className="flex items-center gap-4">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <WorkspaceSwitcher
            organizations={organizations}
            activeOrganizationId={activeOrganizationId}
          />
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  )
}
