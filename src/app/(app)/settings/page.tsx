import { headers } from "next/headers"

import { Sheet } from "@/components/drawing/sheet"
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
    <div className="mx-auto max-w-3xl">
      <p className="mb-1 font-mono text-[9.5px] font-semibold tracking-[0.16em] text-muted-foreground">
        WORKSPACE SETTINGS
      </p>
      <h1 className="font-display mb-7 text-[30px] leading-[1.05] tracking-[-0.02em]">
        {workspaceName}
      </h1>

      <Sheet
        title="Date grouping"
        note="This is the interpretation applied to every CSV timestamp that arrives without an offset. It is stamped onto each Dataset Version at import and never re-applied afterwards."
        lineageHeading="APPLIES TO"
        lineage={[
          { label: "naive timestamps" },
          { label: "date grouping" },
          { label: "new imports only" },
        ]}
        titleBlock={[
          { label: "CURRENT", value: context.organizationTimezone, tone: "caution" },
          { label: "ZONES AVAILABLE", value: availableTimezones.length.toLocaleString("en-US") },
          { label: "SCOPE", value: "Future imports" },
          {
            label: "YOU CAN EDIT",
            value: canEditTimezone ? "Yes" : "No — owner or admin",
            tone: canEditTimezone ? "checked" : undefined,
          },
        ]}
      >
        <TimezoneForm
          currentTimezone={context.organizationTimezone}
          availableTimezones={availableTimezones}
          canEdit={canEditTimezone}
        />
      </Sheet>
    </div>
  )
}
