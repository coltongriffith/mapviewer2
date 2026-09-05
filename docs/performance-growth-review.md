# Performance and customer-growth review — September 5, 2026

This release reviews application startup, map rendering and data import, draft storage, authentication and plan state, analytics reporting, the admin interface, database access, and the release checks. The changes focus on getting customers to a useful map quickly and making subscription and repeat-use decisions from defensible metrics.

## Findings addressed

| Finding | Change and resulting behavior |
| --- | --- |
| A direct admin visit initialized the entire map editor. | Route directly to a lazy admin entry. Existing workspace navigation continues to preserve an opened editor. |
| Restoring compressed drafts fetched PDF/ZIP code; the claims dialog also fetched parsers through shared projection dependencies. | Give compression, ZIP, PDF and projection libraries separate chunks. Load the upload panel only when selected. A new map/claims flow no longer requests PDF or shapefile/ZIP engines. |
| All demo data and detailed region polygons loaded with the editor. | Import demos and region geometry on demand; use a small region index for dropdowns. Preserve the existing region geometry and rendering styles. |
| Style changes repeated expensive polygon dissolves. | Cache visible/dissolved geometry by immutable geometry and feature overrides. Hidden-feature changes invalidate the result; trimming bypasses dissolve. Weak keys allow old projects and undo snapshots to be collected. |
| Rendering the editor repeatedly scanned potentially megabytes of local storage. | Measure storage after writes and focus/storage events, with a debounce and listener cleanup. |
| Admin loaded inactive reports, repeated lookups, and continuously animated the globe. | Lazy-load tabs, reduce Acquisition from 13 report calls to five displayed reports, fetch/poll live locations only on the visible Acquisition tab, and render the globe on interaction. Growth requires access plus one aggregate report. |
| Slow or failed requests could show misleading empty data or stale results. | Add bounded account/query caches, cancellation, a 20-second timeout, refresh, timestamps, and explicit errors. Guard range, account, refresh and unmount races. |
| A slow paid-plan response could affect a different account; initial auth could race sign-out. | Invalidate requests on identity changes and ignore stale initial sessions. Preserve verified, account-scoped offline Pro grace. |
| Existing funnel counts, demo exports and free watermark settings could imply conversions or payment intent they did not prove. | Add a sequential session funnel, explicit real-data exports, mature account cohorts and Stripe-backed subscription counts. Correct the generic sample loader's provenance. Retain legacy reports with accurate labels. |
| Calendar ranges could shift with timezone offsets and incomplete days. | Use complete Pacific calendar days and explicit UTC boundaries. Historical daylight-saving transitions and B.C.'s permanent UTC−7 change are covered by tests. |
| Admin navigation and timeline interactions were difficult on narrow screens. | Wrap navigation and range controls, improve table labels/contrast, make actionable charts keyboard-operable, and use a native dialog for session timelines. |

Shared report cards and request handling replace duplicate implementations. The admin shell is substantially smaller after extracting its globe and report views. Error telemetry now includes a commit identifier when the deployment provides one.

## Measured loading changes

Gzipped JavaScript, in KiB (1,024 bytes), from production Vite manifests. The baseline is `b1547e51e08c1aea227b41f1da65163201153298`, built with Supabase **and the former admin email flag** configured. Omitting that flag pruned the old admin implementation and understated its baseline.

| Configured production graph | Before | After | Change |
| --- | ---: | ---: | ---: |
| Fresh homepage | 124.1 | 124.4 | Approximately unchanged |
| Editor entry and map canvas | 506.9 | 301.5 | 40.5% less startup JavaScript |
| Direct admin entry and default report | 555.6 | 139.8 | 74.8% less startup JavaScript |
| All JavaScript, including lazy features | 824.8 | 836.7 | 1.4% more total feature code |

The complete initial claims flow is 311.2 KiB with auth configured. The anonymous build is 58.9 KiB for the homepage, 234.2 KiB for the editor, 243.8 KiB for claims, and 68.9 KiB for admin. The largest configured chunk is approximately 124.2 KiB; CSS is 28.9 KiB.

These are measured dependency/transfer reductions, not a measured percentage improvement in load time or Core Web Vitals. Network conditions, map tiles and customer geometry still affect response time. CI now checks homepage, editor, claims and admin import graphs, and browser tests check actual engine requests. The total-code budget accounts for the added reports while the largest-chunk budget tightens from 191 to 135 KiB.

## What the dashboard means

**Growth is the default tab.** It starts with active subscriptions, estimated MRR, confirmed real-data exports, and week-two return, then presents the first-map journey, source cohorts, friction and free accounts demonstrating value.

| Metric | Definition and practical limit |
| --- | --- |
| First-map journey | Tracked tab sessions → editor opened → a supported real-data import → a later export, in that order and within the window. A tab is not a person; an import and export in one tab do not prove the same map was exported. |
| Confirmed real-data export | A successful export explicitly tagged `real_data: true`. It confirms supported source provenance, not ownership of the claims or whether the customer used the result. Earlier missing provenance remains unclassified. |
| Confirmed accounts | Accounts whose email confirmation falls in the selected window. An email submission or sign-in-link send is not a signup. |
| Seven-day activation | A real-data export in the first seven days after confirmation, only for accounts with seven complete observable days and the new tracking available. Pending and pre-tracking accounts are separate. |
| Week-two return | Recorded product/editor or tenure activity on days 7–13 after confirmation; the denominator requires fourteen complete days. Merely signing in does not qualify. |
| Active subscriptions | Current `source = stripe`, `plan = pro`, `status = active` records, excluding admins. Trials, complimentary access and past-due plans are separate. This is a current billing snapshot, not proof of cash collected. |
| Estimated MRR / ARR | Catalog prices of $29/month or $290/year, normalized by the known billing interval. Unknown intervals are flagged/excluded. Discounts, taxes, refunds and actual collections are not included. |
| Sources | Session source is the first recorded page in that tab/window. Account source is signup-time first-touch metadata. The two denominators remain separate. Missing attribution is not labeled proven direct traffic. |
| Follow-up candidates | Free, identified accounts with explicitly confirmed real-data exports in the window. Removing the large free watermark does not indicate intent to buy. |

Known administrator accounts and identifiable sessions are excluded. Unidentified testing, bots, blocked tracking, cross-device work and historical missing attribution remain limitations. Windows use complete days; the single-day inspector explicitly labels an in-progress day. The day inspector's activity span is not dwell time. Legacy independent product counts no longer imply a sequential conversion rate.

CAC and ROAS are not calculated because spend and collected revenue are not connected. Refunds remain grouped by currency. Revenue lists distinguish amounts due from paid invoices and visibly separate trials and past-due subscriptions.

The business use is to find where real imports fail to become usable exports, review repeat use, and identify free accounts with a recurring need. Use tagged links for working sessions with consultants and IR/design teams. Keep customer conversations in a private sales record and use [growth-validation.md](growth-validation.md) for the proposed five-person usability exercise.

## Database and release

Additive migration: `supabase/migrations/20260905053221_growth_dashboard_performance.sql`. This version is already applied to the production database and matches its migration history.

It adds a timestamp index and four admin RPCs: `admin_get_access`, `admin_get_growth`, `admin_get_day_activity`, and `admin_get_billing_metrics`. Each checks the server's admin membership, fixes its search path, denies anonymous execution and allows authenticated callers only through that guard. Historical events are preserved. The existing revenue RPC is retained so cached older clients remain compatible.

Growth scans a bounded window in one aggregate report. A live SQL execution-plan check completed in approximately 62 ms, but that single warm-cache observation is not a latency benchmark. Live permission checks confirmed anonymous denial and non-admin rejection; aggregate production data was checked without seeding synthetic events.

The timezone helper explicitly handles [B.C.'s March 2026 switch to permanent Pacific time](https://news.gov.bc.ca/releases/2026AG0013-000209). The database's timezone data still predicted the former November fallback, so post-transition legacy reports receive a fixed UTC−7 reporting zone. Historical transition tests retain their original 23/25-hour days.

## Validation

- 1,174 unit/component tests, including actual migration execution against isolated PostgreSQL via PGlite, billing/cohort edge cases, authorization, geometry invalidation, storage scheduling, and authentication/report races.
- Anonymous production-build browser coverage for routes, map/editor interactions, imports, exports, accessibility and loading; a regression verifies samples stay classified as demos.
- Eight configured admin browser flows across desktop and mobile, with isolated auth/data fixtures, covering report loading, source cohorts, lazy reports, errors/retry, day boundaries, timelines and non-admin denial.
- Production and configured-auth builds and performance budgets; lint with no errors; production dependency audit with no vulnerabilities at review time.

Authenticated UI coverage uses local fixtures plus separately verified live SQL. It does not establish that a real customer payment was collected or that a real sign-in email was delivered. Deployment checks and commit-specific CI status are recorded in the release pull request.

## Remaining work

- The main editor is still a large component. Extract further feature boundaries as those workflows change; avoid a broad rewrite that risks map behavior without a measured benefit.
- The first dissolve of a very large new dataset still runs on the main thread. Profile representative customer files before choosing a worker or geometry simplification; cached style updates now avoid repeated unions.
- The lint backlog remains visible as warnings. This release reduces it and fixes warnings introduced by these changes; it does not claim every legacy warning is resolved.
- Supabase still reports pre-existing advisories for the public claims snapshot view, the PostGIS reference table and older helper functions. Review their intended public-data behavior and extension ownership separately before changing permissions. New admin functions intentionally appear as authenticated security-definer functions and have explicit tested guards.
- Add collected-revenue, discounts/refunds and acquisition-spend reconciliation when those sources are available. Do not derive historical paid conversion or backfill real-data provenance from incomplete events.

Rollback the application commit through the normal GitHub/Vercel deployment flow. The additive RPCs and index can remain; preserving them avoids breaking clients already using this release. No customer-data deletion is required.
