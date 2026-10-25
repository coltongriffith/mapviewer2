# Drill database scale test (P2-9)

`scripts/drill-scale-test.mjs` seeds one property with 2,000 holes and measures
the drill database at that size on a **local** Postgres server. It never
connects to a hosted database: it accepts only loopback hosts or a Unix socket,
ignores `DATABASE_URL`, creates a throwaway database and drops it at the end.
It is not part of `npm test` or CI.

```sh
# A local Postgres 15+ server you can create databases on (superuser: it creates the PostgREST roles).
PGHOST=localhost PGPORT=5432 PGUSER=postgres node scripts/drill-scale-test.mjs --explain --out=scale.json
node scripts/drill-scale-test.mjs --timeout               # enforce the 8 s statement timeout on every request
node scripts/drill-scale-test.mjs --extra-assays=800000   # then grow the property to 1,000,000 assays
node scripts/drill-scale-test.mjs --pglite --holes=20     # no server: in-process PGlite (see below)
```

`--migration=<file>` applies one more migration from `supabase/migrations`
after the drill migrations, to compare a candidate index. `--keep` leaves the
database in place for `psql`. Exit code 2 means a budgeted step went over 8 s.
The server connection uses the `pg` development dependency.

## What it does

The schema is the integrated Phase 2 release: the SQL test fixture's auth and
storage stubs (`tests/fixtures/workspace-db.js`, now exported as `baselineSql`),
then the workspace, property-file and drill migrations in order
(`20261027100000_drill_database`, `20261028100000_drill_intercepts`,
`20261101100000_drill_batch_certificates`, `20261101110000_drill_qaqc_foundation`,
`20261101120000_drill_alteration`).

Every row goes through the application's own code. Synthetic files are mapped
and checked by `drillDb.autoMapping` / `buildImport`, then sent with
`drillDb.dryRun` and `drillDb.commit` to the real `drill_import_batch` RPC,
20,000 rows per batch, as an editor:

| Kind | Rows | Batches | Content |
| --- | ---: | ---: | --- |
| Collars | 2,000 | 1 | EPSG:32610 grid |
| Surveys | 20,000 | 1 | 10 stations per hole |
| Assays | 200,000 | 10 | Cu %, Au g/t, Ag g/t, Mo ppm; about 6% `<0.005` Au, 2% `-0.5` Ag, 3% `BDL` Mo |
| Lithology | 20,000 | 1 | 5 codes with descriptions |
| Alteration | 20,000 | 1 | 5 codes with text intensities |

It then re-imports the last assay file unchanged (dry run) and with changed
grades (20,000 rows superseded), rolls back that replacement and the original
batch, and imports it again. The reads use the application's readers through a
small PostgREST-shaped adapter (each request is one transaction as
`authenticated` with RLS, four connections like a browser):
`property-data.pull` (the /3d loader, also used by the 2D drill plan's "Load
property data"), `propertyResults.pullPropertyResults` with a saved CuEq
recipe, and `drillResultsDb.assays` (the property page's Results panel).
`computeResults` runs on the 200,000 loaded assays in Node.

## Environment

- PostgreSQL 16.15 (Ubuntu package), default settings: `shared_buffers` 128 MB,
  `work_mem` 4 MB, `random_page_cost` 4, JIT on. Same machine as the client, so
  there is no network time.
- Linux VM, 4 vCPUs (shared), 15 GB RAM, Node 22.22.
- The VM was shared with other build and browser-test jobs. Load averages are
  in each report. The table is the quietest full run (load 5 to 8). One run at
  load 15 was about twice as slow and its replacement commit hit the 8 s
  timeout (below). Treat these as one machine's numbers, not hosted latency.
- Docker and the Supabase CLI were not available. `--pglite` is
  single-connection WebAssembly Postgres, and its timings are pessimistic and
  not representative of a server. `docs/drill-scale-benchmark.md` has earlier
  PGlite runs.

## Results, 25 October 2026

The budget is 8 s per request: the `authenticated` role's statement timeout
(`20260807000003_service_role_statement_timeout.sql`). Whole loads made of many
requests have no single budget. They are listed for user-visible time.

| Step | Quiet run | First run | Load-15 run | Budget |
| --- | ---: | ---: | ---: | --- |
| Collars, 2,000: dry run / commit | 0.16 / 0.25 s | 0.17 / 0.26 s | 0.17 / 0.30 s | pass |
| Surveys, 20,000: dry run / commit | 0.80 / 1.70 s | 0.76 / 1.51 s | 0.85 / 2.36 s | pass |
| Assay batch 1 (empty property): dry run / commit | 1.12 / 2.08 s | 1.17 / 1.85 s | 1.93 / 3.03 s | pass |
| Assay batch 10 (180,000 stored): dry run / commit | 2.35 / 3.12 s | 2.31 / 3.28 s | 5.41 / 6.71 s | pass |
| Lithology, 20,000: dry run / commit | 0.60 / 1.35 s | 0.60 / 1.45 s | 1.30 / 3.05 s | pass |
| Alteration, 20,000: dry run / commit | 0.67 / 1.41 s | 0.59 / 1.35 s | 1.02 / 2.42 s | pass |
| Re-import of 20,000 unchanged assays (dry run) | 2.47 s | 2.70 s | 5.85 s | pass |
| Replacement of 20,000 assays: dry run / commit | 2.56 / 4.16 s | 2.62 / 4.23 s | 6.27 / **timeout** | pass (fail at load 15) |
| Rollback of the replacement (20,000 withdrawn, 20,000 restored) | 0.85 s | 0.96 s | not reached | pass |
| Rollback of an original batch (20,000 withdrawn) | 0.47 s | 0.57 s | not reached | pass |
| `drill_property_summary` | 1.10 s | 1.63 s | not reached | pass |
| /3d + 2D plan load, `pull()` with lithology (1,000-row keyset pages) | 2.90 s | 4.86 s | not reached | each request < 0.17 s |
| The same with alteration | 3.03 s | 5.02 s | not reached | each request < 0.17 s |
| The same with a saved CuEq recipe (load + intercepts) | 3.77 s | 5.28 s | not reached | each request < 0.17 s |
| Results panel, `drillResultsDb.assays` (200 offset pages) | **28.7 s** | **34.0 s** | not reached | each page < 0.62 s |
| `computeResults`, CuEq of Cu/Au/Ag/Mo with "incl.": 2,000 results | 0.42 s | 0.89 s | not reached | Node, no budget |
| `computeResults`, Au only: 2,021 results | 0.33 s | 0.59 s | not reached | Node, no budget |
| **Beyond the seed:** property grown to 1,000,000 current assays | | | | |
| One more 20,000-row assay file: dry run / commit | **12.9 / 12.0 s** | | | **over** |
| `drill_property_summary` at 1,000,000 assays | 3.36 s | | | pass |

The 1,000,000-assay rows come from `--extra-assays=800000`. The same SQL
growth step was run by hand in `psql` on another run's database, with the
machine quieter: dry run 8.1 s, commit 9.1 s, summary 3.6 s. Both runs are over
budget.

All budgeted requests pass at the P2-9 size. On this machine the slowest, the
replacement commit, has about 2x headroom. That headroom is gone when the
machine is busy, as in the load-15 run.

## Where the time goes

**Imports.** `auto_explain` on a 20,000-row assay dry run against the full
property (absolute times are inflated by per-node timing) splits the time
into: row checks (`drill_row_errors`, jsonpath per row) about 40%, parsing the
incoming rows (`drill_incoming`) about 25%, and `drill_current` (every current
assay of the property, rebuilt as jsonb and materialized) plus the 200,000-row
sort/merge join for the diff the rest. A commit does the same work, parses the
rows again for the insert and updates the table's indexes. Dry runs grow with the
rows already stored: from 1.1 s on an empty property to 2.35 s at 180,000
assays. At 1,000,000 they pass 8 s. The cost is CPU in the materialized
`drill_current` CTE. That CTE does not use an index, so no index can fix it.

**Results panel.** `drillResultsDb.assays` pages with `.range()`, which becomes
`LIMIT 1000 OFFSET n`. Total work grows with the square of the row count. On the
deepest pages PostgreSQL scans the whole table and sorts 140,000 to 200,000
rows (an external merge, 36 MB on disk at `work_mem` 4 MB) to return 1,000:
228–526 ms per page in `EXPLAIN ANALYZE`. With `random_page_cost` 1.1, the
setting for SSD storage, it walks `drill_assays_current_key` instead (95–102 ms),
but still reads every skipped row. Each page is far under 8 s, but the panel
takes about 30 s to open. The /3d loader's keyset pages, which seek on the
same index, take about 1 ms each.

**Summary.** About 60% of the time is the `elements` list:
`jsonb_object_keys` over every current assay (0.58–0.74 s). The holes union
takes 0.15–0.19 s, and the counts are sequential scans. JIT compilation roughly
doubles the function on this server (1.4 s with JIT, 0.6 s without). It
grows linearly: 3.4 s at 1,000,000 assays.

## Indexes: no migration

Before writing an index migration, the existing indexes were checked against
every plan above. Every current-row read already has a matching partial unique
index: `drill_collars_current_key (property_id, hole_id)`, `drill_surveys_current_key (property_id, hole_id, depth_m)`,
and `drill_{assays,lithology,alteration}_current_key (property_id, hole_id, from_m, to_m)`,
all `where superseded_by_batch is null`. The suggested candidate,
`(property_id, hole_id) where superseded_by_batch is null`, is a left prefix of
each one, so it would add nothing. The batch, rollback (`batch_id`,
`superseded_by_batch`) and batch-list (`property_id, created_at desc`) lookups
are also indexed. The keyset pages and the insert's current-row check use these
indexes. The slow steps are CPU work on rows that must all be read (imports,
`elements`) or a client paging pattern (offset), and no index fixes either.
Every extra index on `drill_assays` would also slow each commit. So
`20261102120000_drill_scale_indexes.sql` was not written, and nothing was
re-measured after a fix.

## Not fixed (outside an index-only change)

1. **Imports pass 8 s well before the property limit.** `c_max_property_rows`
   allows 2,000,000 rows, but a 20,000-row assay import times out at about
   1,000,000 current assays (8–13 s here). Fix in `drill_import_batch`: restrict
   the `c` CTE (and the `overlap` join) to the holes in the file, for example
   `drill_current(...) where hole_id in (select hole_id from i)`. The current-key
   index can serve that lookup. Parse `p_rows` once for the diff and the insert.
   Until then, consider a lower property limit.
2. **The Results panel takes about 30 s at 200,000 assays.** Change
   `drillResultsDb.assays` to the bounded keyset cursor that
   `property-data.readAll` already uses, with the same `hole_id, from_m, to_m`
   order and terminal empty page.
3. **The summary is linear in assays** (1.1 s at 200,000, 3.4 s at 1,000,000).
   This passes for now. If it nears the budget, keep the element list per batch
   (from the mapping) instead of reading every row's keys.
4. Hosted Supabase settings differ (instance size, `random_page_cost`, JIT,
   `work_mem`). Repeat the timed parts on a Supabase branch database before
   relying on the margin.
