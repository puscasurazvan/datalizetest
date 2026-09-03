import { Card, CardContent, CardHeader } from "@/components/ui/card"

import { CreateWorkspaceForm } from "./create-workspace-form"

export default function NewWorkspacePage() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-space-xl">
      <header className="flex flex-col gap-space-xs">
        <p className="font-mono text-label-mono uppercase tracking-wider text-ink-faint">
          Workspaces
        </p>
        <h1 className="text-[34px] font-bold tracking-[-0.03em] text-ink">Create workspace</h1>
      </header>
      <Card>
        <CardHeader>
          <p className="text-body-sm text-ink-muted">
            Datasets, dashboards, and members all belong to one workspace.
          </p>
        </CardHeader>
        <CardContent>
          <CreateWorkspaceForm />
        </CardContent>
      </Card>
    </div>
  )
}
