export default function DatasetsPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-foreground">Datasets</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Every chart in this workspace starts from a dataset.
      </p>

      <div className="rounded-lg border border-dashed border-border p-12 text-center">
        <p className="text-sm font-medium text-foreground">No datasets yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a CSV to get started. Importing datasets isn&apos;t built yet.
        </p>
      </div>
    </div>
  )
}
