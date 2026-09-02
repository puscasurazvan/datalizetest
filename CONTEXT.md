# Datalize — Domain Glossary

The shared language of this project. Glossary only: no implementation details, no decisions, no specs.

Terms are added here as they are resolved. An absent term is not yet settled.

## Organization (code) / Workspace (UI)

The tenant boundary. Every dashboard, dataset, saved query, import, and member belongs to exactly one Organization.

The code, schema, and types say **Organization** — `organizations`, `organization_members`, `organization_id`, `Organization`, `OrganizationMember`. The interface says **workspace** — "Create workspace", "Switch workspace", "Workspace settings", "Invite to workspace".

There is no `Workspace` type. The two words name one concept at two layers; do not introduce a third.

## Dataset

A named body of tabular data belonging to one Organization. A Dataset has a stable identity and display name; it does not itself hold rows. Every upload of a new file creates a new Dataset unless the user deliberately adds a version to an existing one.

## Dataset Version

One immutable import result belonging to a Dataset — its rows, its columns, and the schema they were inferred with. Versions are never edited or annotated after import. A Dataset always has a current version; earlier versions remain readable and are what past executions refer to.

## Column ID

The server-generated, opaque identity of a column, stable across Dataset Versions. A column carries its ID into the next version only when both its name and its type are unchanged. A renamed or retyped column is a different column, and the absence of an old Column ID in the current version is what tells the system a Saved Query no longer fits.

Column IDs are the only way a query names a column. Physical table and column names are never exposed outside the analytical store.

## Saved Query

A stored, structured question about a Dataset — never raw SQL. It references the Dataset, not a version, and resolves to that Dataset's current version each time it runs.

## Import

One attempt to load a file into a Dataset Version. It has its own lifecycle and outcome, records rows it could not parse, and is idempotent: submitting the same upload twice does not produce two versions.

## Execution

One run of a query against one resolved Dataset Version. Every Execution records which version it read and which timezone it grouped by, so any number a chart shows can be explained after the fact.
