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
predicates and compares every page, in order, with the application
reader. It records query timings and final-page plans. Two-row pages on a
separate synthetic property exercise repeated hole/from keys, fractional
depths, punctuation/Unicode in IDs, and a superseded historical row. Each
candidate also checks that a nonmember receives no rows; anonymous access is
rejected. All data and queries stay in the fresh in-memory database.

One full run on commit `18da7ab4` on 23 October 2026 returned the same 200,000
assays in 201 reads:

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

Candidates run after the application reader in the same warm database, so
the timings are diagnostic, not a controlled speed guarantee. SQL parameter
binding here does not validate PostgREST filter escaping.

## Application keyset reader

The property reader now uses the bounded OR predicate for surveys, assays and
lithology, and a single greater-than key for collars. It retains the current
row and property filters, unique key ordering, CSV output and import-change
retry. It reads until an empty page, including when a server returns fewer
than the requested 1,000 rows. Invalid or repeated end-of-page keys fail with
an error instead of looping or returning a partial figure. Text keys follow
the [PostgREST quoted-value grammar](https://docs.postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters).

The real Supabase client is exercised with an isolated fetch fixture: encoded
filters, punctuation/Unicode IDs, tied interval keys, fractional depths, all
four tables, smaller response caps, read failures and concurrent imports.
The fixture parses the filter grammar independently of the application; this
is not a deployed PostgREST-server test.

A full local run of the updated application reader took 2,572 ms including
CSV conversion, versus the prior 25,190 ms offset run. All 200,000 assay rows
and 2,000 result holes passed the same checks. Assay queries took 2,115 ms,
survey queries 173 ms and collar queries 32 ms. These separate local runs
demonstrate the intended index use without promising hosted latency.

A follow-up comparison runs the committed offset reader (`18da7ab4`) and
cursor reader (`fee08132`) against the **same** in-memory database: 2,000
collars, 20,000 surveys and 200,000 assays. Deep equality passes for the entire
returned object, including ordered rows, every CSV byte and the frozen source
snapshot. Both readers make 228 requests. The matching file SHA-256 values are:

| File | Bytes | SHA-256, identical for both readers |
| --- | ---: | --- |
| property-collars.csv | 94,059 | `cd33173faa8e9d8493d4f1cedb5d7ca85d9b13d5b853f22a8b4a9d4f0f6d2b26` |
| property-surveys.csv | 508,025 | `6b6a031618424afa68589289c8376a6581bb9fa161dfc867cecc597d8550a01b` |
| property-assays.csv | 5,144,022 | `4313268a141e552f0de3e8ba80f4fd569212f939cff594df8237e58a4a6301b0` |

The cursor read/CSV conversion takes 2,639 ms, followed by 26,993 ms for the
offset reader. This sequential local comparison proves output preservation,
not a controlled performance ratio. This fixture has no lithology rows;
lithology pagination is covered by the client contract tests.

Local composition with saved recipes from PR #341 passes 62 focused tests,
including BDL half/zero/detection-limit rules across a 1,000-row page boundary,
and seven browser cases (one existing mobile 2D-editor skip). The application
changes combine without an extra fix. When adopting both branches, also carry
the integration fixture updates: recipe mocks must honor cursor filters and
terminal empty pages, and SQL comparison queries must select `bdl` consistently.
The isolated integration commit is `215aea279eab48411da3731350f104dc26d10728`;
it is not part of this reader branch. Its combined lazy-3D budget is 163.0 kB
(measured 162.7 configured), so remeasure after combining rather than taking
either branch's allowance unchanged. This is focused local compatibility
evidence, not a full combined CI or deployed PostgREST-server pass.

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

## Load-only profile after the cursor reader

A local diagnostic on `2eb4bc1f` stops CPU sampling after `layersReady` and
two frames, before the camera check and without a screenshot. Its first run
timed out after 120 seconds while fetching only 83,000 assays: 118.8 seconds
of browser CPU samples were idle. The mock server was reparsing each immutable
request filter for every synthetic row. The browser harness now parses each
filter once per request, preserving the same row predicates and counts.

With that fixture correction, the full 2,000-hole / 200,000-assay diagnostic
passes source/scene counts and camera assertions: profiled load/settle 44,152 ms,
camera/two frames 3,674 ms, maximum observed long task 6,964 ms. The 44,151 ms
load-only CPU profile excludes camera and screenshot work. Aggregating matching
call frames attributes 8,115 ms self time to `tags.statuses()`, 6,567 ms to
`bufferData`, 1,962 ms to `bufferSubData`, and 16,548 ms to idle. Status-key work
remains in overlay/tag callers despite the earlier scene-loop optimization.

These profiled SwiftShader timings are not directly comparable with the earlier
unprofiled run or representative of a physical GPU. Next investigate scoped
reuse of status results within synchronous drawing passes; preserve invalidation
after data/status/style edits and verify export parity. Graphics-buffer changes
need separate evidence. No application rendering change follows from this
diagnostic alone.
