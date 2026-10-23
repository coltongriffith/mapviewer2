# Local drill database scale benchmark

Run from the repository root with the existing development dependencies:

```sh
node scripts/benchmark-drill-scale.mjs --smoke --out=smoke-report.json
node scripts/benchmark-drill-scale.mjs --out=scale-report.json
node scripts/benchmark-drill-scale.mjs --compare-pagination --out=cursor-report.json
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

## SQL cursor comparison

`--compare-pagination` additionally reads all assays with three SQL cursor
predicates and compares every page, in order, with the unchanged application
reader. It records query timings and final-page plans. Two-row pages on a
separate synthetic property exercise repeated hole/from keys, fractional
depths, punctuation/Unicode in IDs, and a superseded historical row. Each
candidate also checks that a nonmember receives no rows; anonymous access is
rejected. All data and queries stay in the fresh in-memory database.

One full run on 23 October 2026 returned the same 200,000 assays in 201 reads:

| Query approach | Sum of assay query times |
| --- | ---: |
| Existing offset reader | 24.64 s |
| Expanded lexicographic OR | 9.60 s |
| Same OR plus `hole_id >= last_hole_id` | 2.02 s |
| SQL row-tuple comparison | 1.81 s |

The additional hole bound lets PostgreSQL seek into the existing
`drill_assays_current_key` index; its final page took 1.45 ms in EXPLAIN versus
sorting a large offset prefix. The tuple candidate also seeks directly and
took 1.35 ms. There is no new index or migration. The bound may help less when
most intervals belong to one hole; this fixture has 100 intervals per hole.

These are SQL experiments, not a changed application reader. Candidates run
after the offset baseline in the same warm database, so the timings are
diagnostic, not a controlled speed guarantee. Before adopting a candidate,
verify real Supabase-client filter serialization (especially quoted IDs),
complete pagination for every table and the existing import-change retry.
SQL parameter binding here does not validate PostgREST filter escaping.

## Remaining P2-9 acceptance

For browser measurements, build with the placeholder Supabase client and serve
it locally. In PowerShell:

```powershell
$env:VITE_SUPABASE_URL='https://example.supabase.co'
$env:VITE_SUPABASE_ANON_KEY='build-check-placeholder'
npx vite build --outDir dist-auth-check
$env:E2E_DIST='dist-auth-check'
$env:PORT='4197'
node scripts/serve-like-vercel.mjs
```

In a second terminal, from the repository root:

```sh
node scripts/benchmark-drill-browser.mjs --smoke --out=browser-smoke.json
node scripts/benchmark-drill-browser.mjs --out=browser-scale.json
node scripts/benchmark-drill-browser.mjs --out=browser-profile.json --profile=load.cpuprofile
```

Only a loopback HTTP server is accepted. The benchmark mocks the placeholder
Supabase host and blocks other external origins. Both harnesses use the same
deterministic row generator. Browser reports record complete page counts,
scene counts, load/settle time, a camera move with two animation frames and
observed long tasks. A successful run also saves `<report>.png`. The run is
bounded to three minutes, uses desktop Chromium with software WebGL, and does
not measure hosted SQL/network time or mobile performance. Failure details are
saved without claiming the workload passed.
The optional `--profile` records a Chrome CPU profile from immediately before
the load click until completion or failure. Open it in DevTools' JavaScript
profiler. Profile capture has its own five-second limit and reports failures;
profiling adds overhead, so use an unprofiled run for timing comparisons.

The first full browser run on main failed after fetching every row with
`Maximum call stack size exceeded`. Scene setup spread all 202,000 path
elevations into a single `Math.min` call. A streaming minimum removes this
argument-count limit without changing the elevation calculation. Completion
and responsiveness of the full scene still need verification after that fix.
The patched 20-hole smoke case passes. Two full-scale attempts exceeded the
120-second import wait under SwiftShader. At the second timeout, diagnostic
capture found the import button enabled and the status reporting all 2,000
holes and 200,000 assays loaded, but the run did not reach its scene-count and
camera assertions. Observed long tasks included 31.8, 34.9, 37.1 and 21.0 seconds.
This is evidence of prolonged UI blocking, not a successful performance gate.
The subsequent 136-second CPU profile attributed about 92 seconds of self time
to `tags.statuses()`. Although statuses are cached, each lookup rebuilds a key
from every hole ID. Trace construction requested that lookup per path segment,
and assay styling requested it per interval for both weight and fade. These
hole-wide decisions now run once per hole within each synchronous build/style
pass. No cross-pass cache is added: status, emphasis and visibility edits are
re-evaluated on the next pass.

With that change, the unprofiled full browser workload passes all scene/source
counts and camera assertions: 37,696 ms load/settle, 1,660 ms camera/two frames,
and a 6,358 ms maximum observed long task. The entire run including screenshot
capture and cleanup took about 104 seconds. This is one local software-renderer
measurement, not an interactive-performance target met. Eight PNG comparisons
against main match exactly: 3D and section exports for the default sample, a
20-hole synthetic figure, edited new/previous/planned statuses with emphasis,
and a subsequent reset. The reports retain the original failures.

Remaining work includes reducing the still-visible multi-second pauses and
measuring physical-device responsiveness. Do not infer hosted performance from
these mocked browser reads or this software GPU.

Any query optimization must retain
stable complete pagination and the existing import-change retry, with regression
checks for repeated hole IDs, interval boundaries and access controls.
