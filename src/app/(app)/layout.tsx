import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { Brand } from "@/components/brand"
import { AppShell } from "@/components/shell/app-shell"
import { OpenSoleWorkspace } from "@/components/shell/open-sole-workspace"
import { SelectWorkspacePrompt } from "@/components/shell/select-workspace-prompt"
import { Card, CardContent } from "@/components/ui/card"
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
      <GateScreen
        title="Create your workspace"
        note="Datasets, dashboards, and members all belong to a workspace."
      >
        <CreateWorkspaceForm />
      </GateScreen>
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
        <GateScreen title="Opening your workspace" note="One workspace is not a choice.">
          <OpenSoleWorkspace organization={soleOrganization} />
        </GateScreen>
      )
    }

    return (
      <GateScreen
        title="Choose a workspace"
        note="Everything you open next belongs to the workspace you pick here."
      >
        <SelectWorkspacePrompt organizations={organizations} />
      </GateScreen>
    )
  }

  const activeName =
    organizations.find((organization) => organization.id === context.organizationId)?.name ??
    "This workspace"

  return (
    <AppShell
      organizations={organizations}
      activeOrganizationId={context.organizationId}
      workspaceName={activeName}
      timezone={context.organizationTimezone}
      userEmail={session.user.email}
    >
      {children}
    </AppShell>
  )
}

/**
 * The three screens that stand between a session and the shell: no workspace
 * yet, one to open, or several to choose from. None of them has provenance to
 * show, so none carries the rail (DESIGN.md "Ruling axis") — they get the same
 * centred plate as the auth screens instead, so the wordmark never disappears.
 */
function GateScreen({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-1 items-center justify-center bg-canvas px-gutter-mobile py-space-3xl">
      <div className="flex w-full max-w-sm flex-col gap-space-xl">
        <div className="flex flex-col gap-space-xs">
          <Brand />
          <h1 className="text-headline-lg text-ink">{title}</h1>
          <p className="text-body-sm text-ink-muted">{note}</p>
        </div>
        <Card>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </div>
  )
}
