import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { AppShell } from "@/components/shell/app-shell"
import { OpenSoleWorkspace } from "@/components/shell/open-sole-workspace"
import { SelectWorkspacePrompt } from "@/components/shell/select-workspace-prompt"
import { Card } from "@/components/ui/card"
import { auth } from "@/modules/auth"
import type { OrganizationSummary } from "@/modules/organizations"

import { resolveActiveContext } from "./active-context"
import { CreateWorkspaceForm } from "./workspaces/new/create-workspace-form"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session) {
    redirect("/sign-in")
  }

  const memberOrganizations = await auth.api.listOrganizations({ headers: requestHeaders })
  // This is a Server Component: it executes once per request rather than re-rendering on the
  // client, so there is no live memoization for a fresh array reference to defeat, and the array
  // cannot be hoisted since it is derived from `memberOrganizations`, known only after the await.
  // oxlint-disable-next-line react-perf/jsx-no-new-array-as-prop
  const organizations: OrganizationSummary[] = memberOrganizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
  }))

  if (organizations.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-xl font-semibold text-foreground">Create your workspace</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Datasets, dashboards, and members all belong to a workspace.
          </p>
          <Card>
            <CreateWorkspaceForm />
          </Card>
        </div>
      </div>
    )
  }

  const context = await resolveActiveContext()

  if (context === "no-active-organization") {
    // One workspace is not a choice — open it rather than asking. This is the
    // path a brand-new user takes: `auth.ts`'s `session.create.before` hook
    // cannot stamp the personal Organization at sign-up, because Better Auth
    // creates the session before the hook that creates it runs.
    const soleOrganization = organizations.length === 1 ? organizations[0] : undefined
    if (soleOrganization !== undefined) {
      return (
        <div className="flex flex-1 items-center justify-center px-6 py-16">
          <OpenSoleWorkspace organization={soleOrganization} />
        </div>
      )
    }

    return (
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <SelectWorkspacePrompt organizations={organizations} />
      </div>
    )
  }

  return (
    <AppShell organizations={organizations} activeOrganizationId={context.organizationId}>
      {children}
    </AppShell>
  )
}
