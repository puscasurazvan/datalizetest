# Saved queries reference a dataset, not a version, and resolve at execution time

A Saved Query stores a `datasetId` and resolves to that Dataset's current version each time it runs. Every execution records the `datasetVersionId` and the organization timezone it actually used.

**Why:** the target persona re-exports the same report monthly. Pinning a version would make the product's central workflow produce silently stale dashboards — September's data uploaded, August's numbers still on screen — which is a worse failure than a visible break, because nobody sees it.

**Consequences:** a schema change can invalidate a live dashboard. This is handled, not avoided: compatibility is checked at resolve time against the query's Column IDs, additive changes pass, and a removed or retyped column fails with a structured `SCHEMA_INCOMPATIBLE` error that names the column and renders as a widget error state. Never a blank chart, never a silently dropped filter. Opt-in version pinning can be added later if users ask for it.
