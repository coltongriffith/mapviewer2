# Browser checks in CI

Six standard Ubuntu jobs run the browser suites: three measured anonymous buckets and three configured admin shards. The original selectors, skip conditions, two workers per job, one retry in CI, and real production-build serving remain unchanged. Product and test sources are not modified by the scheduling configuration.

Anonymous jobs use `playwright.ci-anonymous.config.js` with `E2E_ANONYMOUS_BUCKET=1`, `2`, or `3`; missing/invalid values fail. It adds exclusions to the original `testIgnore` and keeps its `testMatch` and projects. Two explicit sets distribute expensive software-rendered 3D files; bucket 1 receives every other file, including future files. Do not also pass `--shard`: that would partition a bucket again and omit tests.

Admin jobs still run `npm run test:e2e:admin -- --shard=N/3`, with the original configured build, static-page generation and fixtures. [Playwright's sharding](https://playwright.dev/docs/test-sharding) divides tests by count; configured-suite scheduling is unchanged. Anonymous jobs retain the original plain production build. Neither suite needs live account credentials.

The stable `e2e` check waits for all six jobs and succeeds only when all succeed. Failure, cancellation or skipped matrix work cannot produce a green gate. `fail-fast: false` lets independent failures finish. Failed jobs upload HTML reports and test results (traces/screenshots) with suite/group/attempt-specific names and seven-day retention.

## Why anonymous selection changed

[CI run 40431963159](https://github.com/coltongriffith/mapviewer2/actions/runs/40431963159) passed, but its count-based anonymous shards took 1.2, 2.6 and 31.6 minutes. The last shard held all 62 active tests from twelve expensive 3D files. No test retried or failed. Its tests accounted for 87.2% of the previous run's work, so equal test counts were misleading.

Measured file durations from that run give these approximate aggregate totals (two workers execute each bucket):

| Bucket | Aggregate test seconds |
| --- | ---: |
| 1: default remainder | 1,307 |
| 2: four specified files | 1,333 |
| 3: six specified files | 1,297 |

This suggests roughly 11–12 minutes plus setup/overhead if those timings recur. It is an unmeasured projection: software rendering, runner availability and individual durations vary. The same 62 tests were 1.63× slower than their preceding run; logs show broad rendering-heavy slowdown but do not establish a host or network cause. No runtime workaround is included.

## Coverage guard

`node scripts/check-browser-buckets.mjs` runs once in the existing `test` job after install. It invokes real JSON discovery without starting browsers or building. The original 273 test-ID/project-ID pairs (178 active, 95 static skips) must appear exactly once across the buckets with unchanged expected status. A temporary unique future file adds one active and one skipped test; both must appear only in the remainder. Invalid/missing bucket checks must fail. Failed discovery, missing/extra IDs, duplicates or changed statuses fail the guard; the temporary file is removed in `finally`.

Local validation took 8.3 seconds. Actual bucket inventories were 222/19/32 IDs (136/19/23 active and 86/0/9 static skips), with exact union equality. Keep this guard when adjusting bucket membership. Runtime skip predicates remain in the unchanged test sources; JSON listing can only account for static skips.
