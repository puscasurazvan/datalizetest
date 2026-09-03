"use client"

import { Plus } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

  // Base UI's Select.Value prints the raw value when given no children, which
  // would put an Organization ID in the chrome. The name is what the reader
  // needs; the ID is the Select's value, not its label.
  const activeName =
    organizations.find((organization) => organization.id === activeOrganizationId)?.name ??
    "Select workspace"

  // Base UI's Select clears to `null` as well as selecting a value; clearing
  // is not a workspace switch, so it is ignored rather than narrowed away.
  async function handleChange(organizationId: string | null) {
    if (organizationId === null || organizationId === activeOrganizationId) {
      return
    }

    setError(null)
    setSwitching(true)
    try {
      const { error: switchError } = await authClient.organization.setActive({ organizationId })
      if (switchError) {
        // The Select is controlled by `activeOrganizationId`, which only
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
        value={activeOrganizationId}
        // `Select` renders Base UI's uncontrolled-child tree, so there is no
        // memoized child for a fresh closure to defeat.
        // oxlint-disable-next-line react-perf/jsx-no-new-function-as-prop
        onValueChange={(organizationId) => void handleChange(organizationId)}
        disabled={switching}
      >
        <SelectTrigger
          id="workspace-switcher"
          className="w-auto min-w-32 rounded-full border-hairline bg-surface px-space-sm py-space-2xs text-body-sm text-ink hover:bg-surface-high"
        >
          <SelectValue>{activeName}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          {organizations.map((organization) => (
            <SelectItem key={organization.id} value={organization.id}>
              {organization.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Link
        href="/workspaces/new"
        title="Create a workspace"
        className="rounded-full p-space-xs text-ink-faint hover:bg-surface-high hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus strokeWidth={1.5} className="size-4" />
        <span className="sr-only">New workspace</span>
      </Link>
      {error ? (
        <p role="alert" className="text-body-sm text-refused">
          {error}
        </p>
      ) : null}
    </div>
  )
}
