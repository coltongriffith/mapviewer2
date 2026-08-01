# Tenure Monitor — B.C. mineral tenure monitoring

Developer and operator documentation. User-facing help lives in
[`docs/tenure-monitor-help.md`](./tenure-monitor-help.md).

Status: v1 (phases 1–5). Last updated 2026-08-01.

---

## What it is, and what it deliberately is not

Tenure Monitor watches a saved portfolio of B.C. mineral tenures, calculates
days remaining against each claim's good-to-date, emails reminders before the
deadline, and detects changes to the government record.

**It is read-only with respect to government transactions.** It reads public
tenure data, stores it, calculates dates, sends reminders, records internal
decisions, and links to Mineral Titles Online. It does not — and must not be
extended to — log into MTO, store MTO credentials, submit assessment work, pay
cash in lieu, register title, or acquire ground. Every user-facing surface
carries the verification notice from `src/utils/tenureDisclaimer.js`:

> Government title records and Exploration Maps monitoring results should be
> verified in the official Mineral Titles Online registry before a transaction
> or deadline decision.

---

## Data source

| | |
|---|---|
| Service | DataBC WFS, `https://openmaps.gov.bc.ca/geo/pub/wfs` |
| Layer | `pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW` |
| Licence | **Open Government Licence – British Columbia** |
| Attribution | "Contains information licensed under the Open Government Licence – British Columbia." Rendered by `<DataAttribution />` and in every alert email footer. |
| Update frequency | Not documented by the province. The product therefore never claims to be live — it displays the timestamp of the last successful sync and nothing stronger. |

This is the same layer `api/bc-claims.js`, `api/claims.js` and
`scripts/pseo/02_fetch_claims_bc.mjs` already query. One layer, one place to fix
if the province renames it.

### Verified field list

**Confirmed present** (by prior `--discover` runs recorded in
`scripts/pseo/config.mjs` and by the live integrations in `src/utils/claimInfo.js`):

`TENURE_NUMBER_ID`, `TAG_NUMBER`, `CLAIM_NAME`, `OWNER_NAME`,
`AREA_IN_HECTARES`, `GOOD_TO_DATE`, `ISSUE_DATE`, `TENURE_TYPE_DESCRIPTION`,
`TENURE_SUBTYPE_DESCRIPTION`, `TITLE_TYPE_DESCRIPTION`, `MAP_UNIT_NO`.

**Not confirmed to exist.** Do not build a feature that depends on these until
a `--discover` run says otherwise:

- government client number
- ownership percentage
- number of owners
- termination date
- work-event / transfer-event counts
- a record-update timestamp

They are nullable in the schema, resolve to `null`, and render as
*"Not published in the B.C. source"* rather than as blanks or zeroes.

### Open questions to resolve on first discovery run

Run this and paste the output into this section:

```bash
node scripts/tenure-sync/run.mjs --discover
```

1. Does the layer include expired / terminated titles, or only active ones?
   (`scripts/pseo/02_fetch_claims_bc.mjs` filters out past-good-to-date rows,
   which implies expired titles **are** retained — confirm before relying on it.)
2. Are placer and coal titles in this layer or in separate ones?
3. Is ownership ever published as discrete records rather than one flat
   `OWNER_NAME`? If so, set `fields.ownersAreDiscrete = true` in
   `scripts/tenure-sync/resolveFields.mjs` and owner rows upgrade to
   `ownership_representation = 'multi_field'` with no migration.

---

## Architecture

```
DataBC WFS
    │  scripts/tenure-sync/   (GitHub Actions, nightly + 2× targeted)
    ▼
public.tenure_import_staging ──guardrails──► tenures, tenure_owners
                                             tenure_snapshots
                                             tenure_change_events
                                             tenure_import_runs
    │
    ├─► api/tenure-search.js  (anon key, public read, rate-limited)
    │       └─► src/components/tenure/*  →  /tenure-monitor
    │
    └─► scripts/tenure-alerts/  (GitHub Actions, daily)
            └─► Resend  →  recipients
```

### Files

| Path | Role |
|---|---|
| `src/utils/tenureDates.js` | **All** deadline arithmetic, in America/Vancouver. Pure. Shared by browser, tests and cron jobs. |
| `src/utils/tenureOwners.js` | Owner-name folding and candidate ranking. Pure. |
| `src/utils/tenureDisclaimer.js` | The canonical verification wording. One copy. |
| `src/utils/tenureCsv.js` | CSV import reconciliation and schedule export. |
| `src/utils/tenureMonitor.js` | Client data access (mirrors `cloudStorage.js`). |
| `scripts/tenure-sync/` | Importer: `bcSource`, `resolveFields`, `normalize`, `changeDetect`, `guardrails`, `db`, `run`. |
| `scripts/tenure-alerts/` | Alert engine: `plan`, `templates`, `run`. |
| `api/tenure-search.js` | Public search over the mirror. |
| `src/components/tenure/` | The `/tenure-monitor` UI. |
| `src/components/admin/TenureTab.jsx` | Admin → Tenure. |

### Migrations

| File | Contents |
|---|---|
| `20260801000001_tenure_registry.sql` | `tenures`, `tenure_owners`, `tenure_snapshots`, `tenure_change_events`, `tenure_import_runs`, `tenure_import_staging`, `tenure_last_sync()`, `tenures_in_bbox()`, `tenure_reconcile_run()` |
| `20260801000002_tenure_portfolios.sql` | portfolios, memberships, alert policies, recipients, alert instances, audit log, `owns_portfolio()` |
| `20260801000003_tenure_quota_and_admin.sql` | `tenure_plan_limits()`, quota-bearing write RPCs, membership audit trigger, admin RPCs, system notices |
| `20260801000004_tenure_change_history.sql` | change-history RPCs, `tenure_boundaries_changed_since()` |

Apply in order. Each carries a `Rollback:` block and verification queries.

---

## Timezone rules

**Every** deadline decision goes through `src/utils/tenureDates.js`, in
`America/Vancouver`. Never `new Date()` formatting in local time.

- `bcToday()` uses `Intl` so both DST transitions are handled by the platform's
  tz database rather than a hand-rolled −7/−8 guess that is wrong twice a year.
- `daysRemaining()` subtracts at UTC noon, so no daylight shift can move the
  result across a date boundary.
- `good_to_date` is stored as a bare `date`. The province publishes a date with
  no time; inventing a government deadline instant would be fabricating a fact
  about somebody's mineral rights. Anything needing a moment (when an alert
  fires) derives it from **our** schedule.
- A value the source omits yields `null`, never `0`. "0 days remaining" on a
  claim with no published date would read as a fabricated emergency.
- Dates are displayed in ISO everywhere. A localized `03/04/2027` is read as
  March 4th by half the audience and April 3rd by the other half.

---

## Import schedule and failure behaviour

`.github/workflows/tenure-sync.yml`

| Cron (UTC) | Mode | Purpose |
|---|---|---|
| `0 11 * * *` | full | Whole province + reconciliation. The **only** run allowed to conclude anything about an absent title. |
| `0 15,23 * * *` | targeted | Refreshes only currently-monitored tenure numbers. |

### The guardrails

`scripts/tenure-sync/guardrails.mjs`. A run **aborts without writing** when:

| Condition | Default | Env override |
|---|---|---|
| Zero records returned | always fatal | — |
| Pagination incomplete | always fatal | — |
| Full run under an absolute floor | 1,000 | `TENURE_SYNC_MIN_ABSOLUTE_RECORDS` |
| Record count vs last good run | < 70% | `TENURE_SYNC_MIN_RECORD_RATIO` |
| Rejected-record ratio | > 2% | `TENURE_SYNC_MAX_REJECT_RATIO` |
| Invalid-geometry ratio | > 2% | `TENURE_SYNC_MAX_GEOMETRY_FAIL_RATIO` |
| A required field vanished | always fatal | — |

A run that passes but is incomplete or whose schema fingerprint moved is marked
`alerts_safe = false`: it promotes data but withholds change notices.

**Why staging exists.** The guardrails are run-level — they need the whole
result set before they can judge it. Buffering a province in memory is what
forces the Quebec loader to a 12 GB heap. So each page lands in
`tenure_import_staging`; memory stays flat, and an aborted run is cleaned up
with a `DELETE` that touches nothing a portfolio depends on.

**Nothing is ever deleted.** A tenure absent from a clean full run gets
`missing_run_count += 1`. Only at **two** consecutive clean misses does the
product say anything, and what it says is *"This title was not present in the
latest successful dataset. Verify its status in MTO."* — never that it expired.

On abort: `tenure_import_runs.status = 'aborted'`, guardrail report stored, the
administrator emailed via Resend, existing data untouched, exit code 1.

---

## Alert scheduling

`scripts/tenure-alerts/`, `.github/workflows/tenure-alerts.yml`, daily at
`0 15 * * *` UTC (08:00 Pacific).

**Idempotency is a database constraint**, not application logic —
`tenure_alert_instances_unique` over
`(portfolio, tenure, recipient, alert_type, offset_days, source_good_to_date, change_event_id)`.
The dispatcher additionally claims each row with a compare-and-swap out of
`pending` **before** calling Resend; sending first and marking after sends twice
whenever the marking step loses a race.

Three properties of `plan.mjs`:

1. **No late lies.** A threshold already passed is never scheduled.
2. **No silent gaps.** A claim added inside its last threshold gets one catch-up
   reminder dated today whose offset is the real days remaining.
3. **No stale deadlines.** Alerts record the good-to-date they were computed
   from; when the province moves it, the old ones are superseded.

**Suppression is asymmetric, on purpose.** Change and not-observed notices wait
for an import the guardrails trusted — they are claims about what the province
did. Expiry reminders still send: a good-to-date already read from a successful
import does not become wrong because a later sync failed, and going quiet about
a real deadline is the worse failure. They carry the honest last-sync timestamp.

Missed runs self-heal: the dispatcher sends anything `scheduled_for <= today`.

---

## Plan entitlements

Enforced by `public.tenure_plan_limits()`; mirrored for the UI in
`src/utils/entitlements.js`. **Keep the two in step** —
`tests/tenure-portfolio.test.js` asserts the numbers match.

| | Free | Pro | Company (not sold) |
|---|---|---|---|
| Monitored tenures | 10 | 50 | 500 |
| Portfolios | 1 | unlimited | unlimited |
| Alert recipients | 1 | 2 | 10 |
| Reminder thresholds | 90, 30 | 90, 30, 7 | full ladder |

Creating a portfolio and adding tenures go through RPCs; direct `INSERT` is
revoked, so the quota cannot be raced by two tabs or bypassed by a direct call.
Adding more titles than remain is **partial**: it adds what fits and reports the
rest, rather than failing the batch.

The `company` tier exists in the entitlement matrix and the `user_plans` check
constraint but has no price and nothing writes it.

---

## Environment variables

Repository secrets (GitHub Actions):

| Name | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Both jobs |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Both jobs (bypasses RLS for bulk writes) |
| `RESEND_API_KEY` | for email | Alerts and admin failure notices. Without it the sync still runs and records failures; alerts report "not configured". |
| `TENURE_ADMIN_EMAIL` | no | Defaults to the address in `scripts/tenure-sync/db.mjs` |

Repository variables:

| Name | Purpose |
|---|---|
| `TENURE_ALERT_FROM` | Sender, defaults to `Exploration Maps <notifications@explorationmaps.com>` |
| `SITE_URL` | Link base in emails |
| `TENURE_ALERTS_PAUSED` | Set to `1` to stop all sending without disabling the workflow (the scheduling half must keep running to keep the queue correct) |
| `TENURE_SYNC_MIN_RECORD_RATIO`, `TENURE_SYNC_MAX_REJECT_RATIO` | Loosen a guardrail during a known provincial data event |

Vercel needs nothing new: `api/tenure-search.js` reuses `SUPABASE_URL` /
`SUPABASE_ANON_KEY` (or their `VITE_` fallbacks).

---

## Deployment and first run

1. **Apply the four migrations** in the Supabase SQL editor, in order. Run the
   verification queries at the foot of each.
2. **Discover the live schema** — run the sync workflow with `mode: discover`.
   It writes nothing. Paste the output into *Verified field list* above and
   answer the three open questions.
3. **Add the secrets and variables** listed above.
4. **First full sync**: run the workflow with `mode: full`. Expect a
   `succeeded` row in `tenure_import_runs` with a plausible record count.
5. **Confirm the abort path** before trusting the guardrails: re-run against a
   deliberately truncated fixture (or temporarily set
   `TENURE_SYNC_MIN_ABSOLUTE_RECORDS` above the real count) and verify the run
   aborts, the administrator is emailed, and `select count(*) from tenures` is
   unchanged.
6. **Verify permissions**: sign in as a second account and confirm the first
   account's portfolio is inaccessible by direct id.
7. **Dry-run the alerts**: run the alerts workflow with `mode: dry-run` and read
   the rendered emails in the job log. Then run it for real, and run it a second
   time to confirm **zero** duplicates.
8. Deploy the frontend. `/tenure-monitor` is already in `vercel.json`.

---

## Administrative recovery

**A sync has been failing.** Admin → Tenure shows the run history and each run's
guardrail report. An `aborted` run wrote nothing; stored data is the last good
dataset. Read `error_summary`, then run `--discover` if a required field is
named.

**The province changed the schema.** The importer stops before writing and names
the missing field. Update `FIELD_CANDIDATES` in
`scripts/tenure-sync/resolveFields.mjs` and re-run. A *fingerprint* change alone
does not stop a run — it withholds change alerts and emails you.

**False alerts are going out.** Set repository variable
`TENURE_ALERTS_PAUSED=1`, or use Admin → Tenure → *Pause all reminders* (which
is recorded in the audit log). Post an incident banner so users see why. Note
the scheduling half must keep running.

**A recipient address is bouncing.** The dispatcher sets `bounced_at` on a hard
bounce and stops sending there. Clear it with
`update public.tenure_alert_recipients set bounced_at = null, bounce_reason = null where email = '…';`

**A reminder failed to send.** `select public.admin_retry_tenure_alert('<id>');`
resets it to pending for the next run.

**Reconcile one tenure by hand.** Run a targeted sync, or inspect
`select raw_source_data from public.tenures where tenure_number = '…';`

---

## Adding another Canadian jurisdiction

The schema is jurisdiction-generic; `jurisdiction` and `source` are columns, not
assumptions.

1. Add a source module beside `scripts/tenure-sync/bcSource.mjs` for the new
   registry's endpoint and paging.
2. Add its `FIELD_CANDIDATES` (or a second map keyed by jurisdiction).
3. Confirm `normalize.mjs` handles its date formats — `toIsoDate` already
   covers ISO, ISO-with-time and epoch millis.
4. **Deadline semantics are the hard part.** `tenureDates.js` hardcodes
   `America/Vancouver` because that is where B.C. deadlines fall. Another
   province needs its own zone, and possibly a different rule about what the
   published date means. Do not reuse the B.C. interpretation by default.
5. Add the jurisdiction to the search endpoint and the UI's jurisdiction label.

---

## Known limitations

1. **Ownership fidelity.** The B.C. layer publishes one flat `OWNER_NAME`.
   Where a title appears jointly held, the split is *derived* by us and marked
   `ownership_representation = 'single_field'` so the UI never presents an
   inference as a government record. Percentages and a verified owner count are
   not available.
2. **Client-number search has nothing to match on** until the province publishes
   the field. The endpoint says so explicitly rather than returning a bare
   "no results".
3. **No MTO deep link.** MTO's public search is a stateful JSP application with
   no documented stable per-tenure URL, so we link to the registry's front door
   and state the number to search. A guessed URL that rots — or worse, lands on
   the wrong title — would be worse than an honest two-step.
4. **`assigned_user_id` has no UI.** Portfolios are user-scoped in v1, so there
   is nobody else to assign to. The column and the audit hook exist for the
   organization-scoped plan.
5. **Bounce detection is inferred**, from Resend's 422 response, not from a
   webhook. A soft bounce that later becomes permanent is not detected.
6. **No PDF or Excel export.** CSV only, because it can be produced reliably
   with what is already here.
7. **Map-extent search is a bounding-box prompt**, not a draw-on-the-map tool.
8. **Change detection cannot see history before a tenure was first imported.**
   The first sighting of a title produces no events, by design.
9. **Snapshots do not store geometry**, only its fingerprint and the change
   event. Reconstructing an exact historical polygon is not possible yet — this
   is the one thing a future Released Claim Radar would want revisited.

---

## Released Claim Radar — prepared, not built

Deliberately not implemented. The architecture supports it:

- historical snapshots and `tenure_change_events` keyed by tenure
- `missing_run_count` and the two-clean-miss rule for absences
- `TENURE_TERMINATED` / `TENURE_NO_LONGER_OBSERVED` / `TENURE_REAPPEARED` events
- PostGIS `geom` with a GIST index for intersection and distance queries
- `tenures_in_bbox()` for spatial lookups

**Do not ship "available ground" alerts** off this data. A title dropping out of
the dataset is not evidence it was released, and telling somebody otherwise
could send them to restake ground they already hold. Any such feature must
verify against the authoritative registry first, and say so.

---

## Testing

```bash
npm test                  # unit + integration (fixtures, never live endpoints)
npm run test:e2e          # Playwright against the real production build
npm run lint
```

| Suite | Covers |
|---|---|
| `tests/tenure-dates.test.js` | B.C. today, days remaining, both DST transitions, year and leap boundaries, urgency bands, non-colour indicators |
| `tests/tenure-import.test.js` | Field resolution and schema drift, normalization and rejection, geometry validation, every guardrail threshold |
| `tests/tenure-change-detect.test.js` | Change events, tolerances, discrepancy-vs-change, owner diffing, owner folding |
| `tests/tenure-alerts.test.js` | Scheduling, refusals, idempotency, recalculation, the alert key vs the DB index, suppression, template content |
| `tests/tenure-portfolio.test.js` | CSV mapping and reconciliation, schedule export, client/API normalization agreement, entitlements |
| `e2e/tenure-monitor.spec.js` | Route, signed-out honesty, data-freshness disclosure, product-boundary wording, history navigation, deep links |

Tests never call the live government endpoint. A suite that depends on DataBC
being up fails for reasons unrelated to the code, and then gets ignored.
