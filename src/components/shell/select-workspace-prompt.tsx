"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { authClient } from "@/modules/auth/client"
import type { OrganizationSummary } from "@/modules/organizations"

export interface SelectWorkspacePromptProps {
  organizations: OrganizationSummary[]
}

/**
 * Shown by `(app)/layout.tsx` when the session has no valid active
 * Organization even though the user belongs to at least one. Picking one
 * calls Better Auth's `/organization/set-active` route from the browser —
 * a real HTTP round trip, so the response can set the session cookie,
 * which a Server Component render cannot do.
 */
export function SelectWorkspacePrompt({ organizations }: SelectWorkspacePromptProps) {
  const router = useRouter()
  const [selectingId, setSelectingId] = useState<string | null>(null)

  async function select(organizationId: string) {
    setSelectingId(organizationId)
    await authClient.organization.setActive({ organizationId })
    router.refresh()
  }

  return (
    <div className="w-full max-w-sm space-y-3">
      <p className="text-sm text-muted-foreground">Choose a workspace to continue.</p>
      <ul className="space-y-2">
        {organizations.map((organization) => (
          <li key={organization.id}>
            <Button
              variant="secondary"
              className="w-full justify-start"
              disabled={selectingId !== null}
              onClick={() => void select(organization.id)}
            >
              {selectingId === organization.id ? "Opening…" : organization.name}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
