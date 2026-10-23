# Local drill database scale benchmark

Run from the repository root with the existing development dependencies:

```sh
node scripts/benchmark-drill-scale.mjs --smoke --out=smoke-report.json
node scripts/benchmark-drill-scale.mjs --out=scale-report.json
```

The full run creates 2,000 synthetic collars, 20,000 survey stations and 200,000
assays in a new in-memory PGlite database. The smoke run uses 20 holes. All
positions are invented test inputs, not exploration data. The script accepts
no database URL or credentials, does not read environment credentials, and
closes its database on completion. Keep generated JSON reports outside Git.

It applies the existing workspace, property-file and drill-database migrations
through the repository's SQL test fixture, then imports through the real
`drill_import_batch` RPC as an authenticated editor. It checks every batch's
written count, the property summary, loaded row counts, unique assay keys and
the number of holes represented by calculated intercepts.

The actual `property-data.pull` loader reads through a small local adapter in
its normal 1,000-row pages. The adapter preserves filters, ordering and role
checks; it serializes calls because the fixture switches one connection's role
per query. It does not simulate HTTP, PostgREST overhead or network latency.
The report records individual page timings, file sizes and an authenticated
`EXPLAIN (ANALYZE, BUFFERS)` of the final assay page.

Exit codes: 0 means local assertions passed and imports were below the
eight-second reference; 1 means an assertion/query failed; 2 means an import
exceeded the local reference. This comparison does not configure or enforce a
server timeout. Supabase documents eight seconds as the default authenticated
role timeout: [Timeouts](https://supabase.com/docs/guides/database/postgres/timeouts).
PGlite timings cannot certify a hosted database's response time.

## Initial measurement, 23 October 2026

One Windows x64 / Node 24.13.1 run on main `4743adda`:

| Stage | Measured time |
| --- | ---: |
| 2,000-collar import | 0.42 s |
| 20,000-station survey import | 2.09 s |
| Each 20,000-row assay import, ten batches | 2.02–3.19 s |
| Property summary | 0.24 s |
| Paginated property read and CSV conversion | 25.57 s |
| Intercept calculation, 200,000 rows / 2,000 results | 0.13 s |

The load is the main measured bottleneck: its 201 assay reads consumed 25.03 s.
The last-page plan used a sequential scan and external merge sort of 200,000
rows before discarding the first 199,000. The expected partial current-row
indexes already exist; adding duplicate indexes is not justified by this run.
Investigate cursor pagination against this baseline before changing queries.
These are one-run diagnostic measurements, not a formal throughput benchmark.

## Remaining P2-9 acceptance

Measure `/3d` parsing, minimum-curvature paths and rendering in a real browser
with the same scale. The current script measures the property data loader and
intercept calculation in Node; it does not prove that the interactive figure
loads successfully or remains responsive. Any query optimization must retain
stable complete pagination and the existing import-change retry, with regression
checks for repeated hole IDs, interval boundaries and access controls.
