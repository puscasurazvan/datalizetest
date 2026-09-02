import { Card } from "@/components/ui/card"

import { CreateWorkspaceForm } from "./create-workspace-form"

export default function NewWorkspacePage() {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-1 text-xl font-semibold text-foreground">Create workspace</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Datasets, dashboards, and members all belong to one workspace.
      </p>
      <Card>
        <CreateWorkspaceForm />
      </Card>
    </div>
  )
}
