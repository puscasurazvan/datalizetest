# Imported data lives in one physical Postgres table per dataset version

Each imported Dataset Version is stored as a server-created physical table in a dedicated analytical schema, with a server-owned mapping from opaque Column IDs to physical column names and Postgres types. Not a JSONB row blob, and not DuckDB/Parquet.

**Why:** at the MVP ceiling (50 MB / 1M rows / 100 columns) Postgres is comfortably fast with real column types, while JSONB would forfeit type safety and index use, and DuckDB/Parquet would pull in worker, object-storage, and query-runtime complexity before any workload has been measured.

**Consequences:** the `AnalyticalStore` interface stays a genuine boundary so a columnar engine can replace the implementation when measured load justifies it — but it is not built speculatively. Analytical queries run on a separate connection pool with their own statement timeout. Physical table and column names are never exposed outside the store; queries name columns only by Column ID.
