"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type ChangeEvent } from "react"

import { Select } from "@/components/ui/select"
import { authClient } from "@/modules/auth/client"
import type { OrganizationSummary } from "@/modules/organizations"

export interface WorkspaceSwitcherProps {
  organizations: OrganizationSummary[]
  activeOrganizationId: string
}

/**
 * Switching which Organization is active is Better Auth's own
 * `/organization/set-active` route, which re-verifies the caller's
 * membership before honouring it (src/modules/auth/CLAUDE.md "re-verify,
 * never assume") — unlike `createWorkspaceAction`/`updateTimezoneAction`,
 * this is not a Datalize mutation that needs `assertCan`, so it is called
 * straight from the client rather than through a Server Action.
 */
export function WorkspaceSwitcher({ organizations, activeOrganizationId }: WorkspaceSwitcherProps) {
  const router = useRouter()
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const organizationId = event.target.value
    if (organizationId === activeOrganizationId) {
      return
    }

    setError(null)
    setSwitching(true)
    try {
      const { error: switchError } = await authClient.organization.setActive({ organizationId })
      if (switchError) {
        // The <select> is controlled by `activeOrganizationId`, which only
        // the server can change, so on failure it snaps back to the old
        // workspace on its own re-render — this message is what tells the
        // user that was a rejection, not a glitch.
        setError(switchError.message ?? "Could not switch workspace. Try again.")
        return
      }
      router.refresh()
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="workspace-switcher" className="sr-only">
        Switch workspace
      </label>
      <Select
        id="workspace-switcher"
        value={activeOrganizationId}
        onChange={(event) => void handleChange(event)}
        disabled={switching}
        className="w-auto min-w-40"
      >
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
      </Select>
      <Link
        href="/workspaces/new"
        className="rounded-md px-2 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        + New workspace
      </Link>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
