import { headers } from "next/headers"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { auth } from "@/modules/auth"
import { can } from "@/modules/auth/policy"
import { listAvailableTimezones, toPolicyContext } from "@/modules/organizations"
import { createRequestContext } from "@/shared/context/request-context"

import { TimezoneForm } from "./timezone-form"

export default async function SettingsPage() {
  const context = await createRequestContext()
  const requestHeaders = await headers()

  const [organization, availableTimezones] = await Promise.all([
    auth.api.getOrganization({ headers: requestHeaders }),
    listAvailableTimezones(),
  ])

  const canEditTimezone = can(toPolicyContext(context), "organization:update")
  const workspaceName = organization?.name ?? "This workspace"

  return (
    <div className="flex w-full max-w-2xl flex-col gap-space-xl">
      <header className="flex flex-col gap-space-xs">
        <p className="font-mono text-label-mono uppercase tracking-wider text-ink-faint">
          Workspace settings
        </p>
        <h1 className="text-[34px] font-bold tracking-[-0.03em] text-ink">{workspaceName}</h1>
      </header>

      <Card>
        <CardHeader>
          <h2 className="text-headline-md text-ink">Date grouping</h2>
          <p className="text-body-sm text-ink-muted">
            This is the interpretation applied to every CSV timestamp that arrives without an
            offset. It is stamped onto each Dataset Version at import and never re-applied
            afterwards.
          </p>
        </CardHeader>
        <CardContent>
          <TimezoneForm
            currentTimezone={context.organizationTimezone}
            availableTimezones={availableTimezones}
            canEdit={canEditTimezone}
          />
        </CardContent>
      </Card>
    </div>
  )
}
