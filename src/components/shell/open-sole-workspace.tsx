"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { authClient } from "@/modules/auth/client"
import type { OrganizationSummary } from "@/modules/organizations"

export interface OpenSoleWorkspaceProps {
  organization: OrganizationSummary
}

/**
 * The single-workspace counterpart to `SelectWorkspacePrompt`: when a user
 * belongs to exactly one Organization and the session has no active one,
 * there is nothing to choose, so this opens it instead of asking.
 *
 * This is the screen a brand-new user hits. `auth.ts`'s
 * `session.create.before` hook stamps `activeOrganizationId` for a sole
 * membership on every *later* sign-in, but it cannot at sign-up: Better
 * Auth creates the session before `user.create.after` runs, so the personal
 * Organization does not exist yet at the moment the hook fires. Setting the
 * active Organization needs a real HTTP round trip to set the session
 * cookie — which a Server Component render cannot do — so the recovery
 * happens here, on the client.
 *
 * A failure falls back to a visible button rather than retrying on a timer:
 * a silent retry loop against a failing auth route is worse than one clear
 * thing to click.
 */
export function OpenSoleWorkspace({ organization }: OpenSoleWorkspaceProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const hasRequested = useRef(false)

  useEffect(() => {
    // Guards React's development double-invoke, which would otherwise fire
    // two set-active requests for the same session.
    if (hasRequested.current) {
      return
    }
    hasRequested.current = true

    void (async () => {
      const { error: switchError } = await authClient.organization.setActive({
        organizationId: organization.id,
      })
      if (switchError) {
        setError(switchError.message ?? "Could not open your workspace.")
        return
      }
      router.refresh()
    })()
  }, [organization.id, router])

  async function retry() {
    setError(null)
    const { error: switchError } = await authClient.organization.setActive({
      organizationId: organization.id,
    })
    if (switchError) {
      setError(switchError.message ?? "Could not open your workspace.")
      return
    }
    router.refresh()
  }

  if (error !== null) {
    return (
      <div className="flex flex-col gap-space-md">
        <p role="alert" className="text-body-sm text-refused">
          {error}
        </p>
        {/* oxlint-disable-next-line react-perf/jsx-no-new-function-as-prop */}
        <Button variant="secondary" className="w-full" onClick={() => void retry()}>
          Open {organization.name}
        </Button>
      </div>
    )
  }

  return <p className="text-body-sm text-ink-muted">Opening {organization.name}…</p>
}
