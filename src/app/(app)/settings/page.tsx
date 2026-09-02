import { headers } from "next/headers"

import { Card } from "@/components/ui/card"
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

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-xl font-semibold text-foreground">Workspace settings</h1>
      <p className="mb-6 text-sm text-muted-foreground">{organization?.name ?? "This workspace"}</p>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-foreground">Timezone</h2>
        <TimezoneForm
          currentTimezone={context.organizationTimezone}
          availableTimezones={availableTimezones}
          canEdit={canEditTimezone}
        />
      </Card>
    </div>
  )
}
