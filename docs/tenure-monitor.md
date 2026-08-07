# Tenure Monitor — B.C. mineral tenure monitoring

Developer and operator documentation. User-facing help lives in
[`docs/tenure-monitor-help.md`](./tenure-monitor-help.md).

Status: v1 (phases 1–5). Last updated 2026-08-05.

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

**Verified against the live layer by the `--discover` run of 2026-08-05**
(GitHub Actions run 31027735213). Schema fingerprint `93a271e8`, 34 fields,
sample geometry type `Polygon`.

```
AREA_IN_HECTARES              CASH_IN_LIEU_EVENT_COUNT      CLAIM_NAME
CLIENT_NUMBER_ID              COMPLAINTS_EVENT_COUNT        ENTRY_TIMESTAMP
ENTRY_USERID                  FEATURE_AREA_SQM              FEATURE_CODE
FEATURE_LENGTH_M              GOOD_TO_DATE                  ISSUE_DATE
NUMBER_OF_OWNERS              OBJECTID                      OWNERSHIP_TRANSFER_EVENT_COUNT
OWNER_NAME                    PERCENT_OWNERSHIP             PROTECTED_IND
REDUCTION_EVENT_COUNT         REVISION_NUMBER               SE_ANNO_CAD_DATA
STATEMENT_OF_WORK_EVENT_COUNT TAG_NUMBER                    TENURE_NUMBER_ID
TENURE_SUB_TYPE_CODE          TENURE_SUB_TYPE_DESCRIPTION   TENURE_TYPE_CODE
TENURE_TYPE_DESCRIPTION       TERMINATION_DATE              TERMINATION_TYPE_DESCRIPTION
TITLE_TYPE_CODE               TITLE_TYPE_DESCRIPTION        UPDATE_TIMESTAMP
UPDATE_USERID
```

Resolved mapping:

| Field | Resolves to |
|---|---|
| `sourceRecordId`, `tenureNumber` | `TENURE_NUMBER_ID` |
| `goodToDate` | `GOOD_TO_DATE` |
| `ownerName` | `OWNER_NAME` |
| `tenureName` | `CLAIM_NAME` |
| `tenureType` / `tenureSubtype` | `TENURE_TYPE_DESCRIPTION` / `TENURE_SUB_TYPE_DESCRIPTION` |
| `issueDate` | `ISSUE_DATE` |
| `areaHectares` | `AREA_IN_HECTARES` |
| `terminationDate` | `TERMINATION_DATE` |
| `clientNumber` | `CLIENT_NUMBER_ID` |
| `ownershipPercentage` | `PERCENT_OWNERSHIP` |
| `ownerCount` | `NUMBER_OF_OWNERS` |
| `workEventCount` | `STATEMENT_OF_WORK_EVENT_COUNT` |
| `transferEventCount` | `OWNERSHIP_TRANSFER_EVENT_COUNT` |
| `sourceUpdatedAt` | `UPDATE_TIMESTAMP` |

**Genuinely not published — these render as *"Not published in the B.C. source"*:**

- **`status`** — the layer has no status column at all. Active versus terminated
  must be read from `TERMINATION_DATE` / `TERMINATION_TYPE_DESCRIPTION`. This
  degrades correctly: `reconcileRows` guards on `tenure.status &&` before
  judging good standing, so a null status reconciles as *matched* rather than
  as *not in good standing*, and `isActiveStatus()` is currently unused.
- **`mapUnit`** — no `MAP_UNIT_NO` on this layer, despite it appearing in
  `scripts/pseo/config.mjs` for a different endpoint.

#### What the first discover run corrected

This section previously listed six fields as "not confirmed to exist" and told
readers not to build on them. **Four of the six are published**, under names the
candidate lists did not contain — the layer names them the way MTO does rather
than the way the rest of DataBC does:

| Documented as absent | Actually published as |
|---|---|
| government client number | `CLIENT_NUMBER_ID` |
| work-event count | `STATEMENT_OF_WORK_EVENT_COUNT` |
| transfer-event count | `OWNERSHIP_TRANSFER_EVENT_COUNT` |
| record-update timestamp | `UPDATE_TIMESTAMP` |

The client number is the one that cost something. **Client-number search is a
shipped, user-visible feature**, and it had nothing to match on — silently, for
as long as this document kept asserting the province did not publish the field.
A candidate list is meant to survive exactly this kind of wrong guess, and this
one did not, because every guess in it was wrong the same way.

Ownership percentage and owner count are also real government values rather than
our inference. `normalizeOwners` already attaches them only when the title has
exactly one owner, which stays correct: they arrive as flat per-title fields and
cannot be attributed to one of several co-owners.

`tests/tenure-import.test.js` pins this schema verbatim so the mapping cannot
drift back unnoticed.

#### Answered by the first full sync (42,316 rows, 2026-08)

The three questions the discover run left open are now settled against the
live mirror.

**1. Terminated titles are retained.** 23 rows carry a non-null
`termination_date`, and 1,003 carry a `good_to_date` in the past. The layer is
not filtered to titles in good standing, so the portfolio view must keep saying
"verify in MTO" rather than reading absence as termination.

**2. Placer and coal share the layer, and so do applications.**

| `tenure_type` | `tenure_subtype` | Rows |
|---|---|---:|
| Mineral | CLAIM | 30,385 |
| Placer | CLAIM | 7,853 |
| Mineral | APPLICATION | 1,725 |
| Coal | LICENSE | 858 |
| Placer | APPLICATION | 783 |
| Mineral | LEASE | 447 |
| Placer | LEASE | 199 |
| Coal | APPLICATION | 41 |
| Coal | LEASE | 25 |

**3. Ownership** is published as one flat `OWNER_NAME` plus a
`NUMBER_OF_OWNERS` count, so `ownersAreDiscrete` stays `false` and any
multi-owner split remains marked as ours rather than the province's.

#### Applications share the layer with granted titles

`TENURE_SUB_TYPE_DESCRIPTION = 'APPLICATION'` — **2,549 rows**, about 6% of the
mirror. They arrive with the same columns as a granted claim, **including a
`GOOD_TO_DATE`**, and for the first weeks of this feature nothing downstream
told them apart: an application appeared in a portfolio, in the table, on the
map and in a reminder email looking exactly like ground somebody held.

`src/utils/tenureKind.js` is now the single discriminator. Two rules it exists
to enforce:

- **`TENURE_SUB_TYPE_DESCRIPTION` is the discriminator. `TITLE_TYPE_DESCRIPTION`
  is not.** "Mineral Cell Title Submission" is carried by 25,401 granted
  `CLAIM`s and 1,725 `APPLICATION`s alike — the word "Submission" describes how
  a claim was staked, not whether it was granted. Anything reaching for the
  title type would classify two-thirds of B.C.'s live mineral claims as
  applications.
- **We report the subtype and stop.** This layer publishes no application
  status, stage, decision date or consultation state, so Tenure Monitor offers
  none. No "under review", no expected-decision date, no progress indicator.
  Inferring a stage from an issue date would be inventing a government fact.

An unrecognised subtype classifies as `unknown`, not as granted — defaulting an
unfamiliar value to "granted" would quietly reintroduce the same confusion the
next time the province adds a category.

#### Placeholder dates

Three application rows carry `1900-01-01` in **both** `ISSUE_DATE` and
`GOOD_TO_DATE`. That is a sentinel for a missing value, not a date from 1900,
and rendering it as one produced "46,000 days ago" on a dashboard whose whole
job is to be trusted about dates.

`isPlaceholderDate()` in `src/utils/tenureDates.js` treats `1900-01-01`,
`0001-01-01` and `9999-12-31` as absent: `daysRemaining` returns `null`, the
urgency band becomes *"Date unavailable — verify in MTO"*, and
`planExpiryAlerts` schedules nothing off a date we do not actually have.

The rule is an **exact set, not a cutoff**. B.C.'s oldest genuine issue date in
the mirror is 1891-07-29 and its oldest genuine good-to-date is 1991, so a
"before 1950" heuristic would have discarded real records to catch three fake
ones.

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
| `20260801000005_tenure_grant_hardening.sql` | revokes the anon EXECUTE grant that default privileges added behind the `revoke ... from public` in 3 and 4 |
| `20260801000006_tenure_table_grants.sql` | reduces `tenures` and `tenure_owners` to SELECT for anon/authenticated |
| `20260801000007_tenure_add_result_accuracy.sql` | `add_portfolio_tenures` counts an unknown id separately from a plan limit |

Apply in order. Each carries a `Rollback:` block and verification queries.

Migrations 5 and 6 exist because this project carries a bootstrap
`alter default privileges in schema public grant all ... to anon, authenticated`.
Every function and table is therefore created with an **explicit** anon grant
already in its ACL, so `revoke all ... from public` — which removes only the
PUBLIC pseudo-role entry — reads like it locks a function down and does not.
Anything added here later must revoke from `anon` by name, not from `public`.
`supabase-fix-rls-public-tables.sql` does this correctly for `qc_claims`; use it
as the reference.

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

### What "untouched" covers, precisely

Up to and including the guardrail verdict the importer is a **pure reader** —
the only writes go to `tenure_import_staging`. A dropped connection, a renamed
field or an abort verdict there genuinely leaves every trusted row alone.

**Promotion is not atomic**, and the code no longer claims it is. PostgREST
cannot hold one transaction across the many round trips a province-sized
promotion takes, so a process death at batch 7 of 40 leaves batches 1–6
committed. That case is handled rather than denied:

- `tenure_import_runs.promotion_started_at` marks the moment the run stops
  being a reader, and the promotion's own completion splits the failure path in
  **three**.
- A failure **before** promotion: staging cleared, and the administrator is told
  stored records are unchanged, because they are.
- A failure **during** promotion: staging is deliberately **kept** — it is the
  input a resume needs — the run records what actually happened, and the email
  says some tenures were updated and some were not.
- A failure **after** promotion (reconciliation, bookkeeping): staging is
  cleared, the real counts are recorded, and the email says the data is complete
  and current. There is nothing to resume, so keeping staging would only queue a
  pointless 42,000-row re-promotion at the head of the next run.
- The next run calls `resumeInterruptedPromotion` before staging anything of
  its own, so its diff is taken against a settled dataset. That resume is
  **best-effort**: if it fails, the run logs it and carries on with tonight's
  pull, which supersedes the staged one anyway.

> **Why three and not two.** The first version had only the first two, and put
> everything after promotion into the "during" bucket. On 2026-08-07 a run
> promoted all 42,323 records, failed in reconciliation, and was recorded as an
> interrupted promotion with `records_processed = 0` — every part of which was
> untrue. It kept 42,000 staging rows for a resume with nothing to finish, and
> because a failing resume *also* killed the run attempting it, the next run
> died at `records_received = 0` before fetching anything. One
> misclassification, and the sync was wedged until a human intervened.

Re-applying a batch that already landed is a no-op, which is what makes the
resume safe rather than merely hopeful: `promoteStaging` diffs the **stored**
row against the **staged** row, so an already-promoted batch compares equal and
emits no change event and no snapshot. The tenure upsert is keyed on
`(jurisdiction, source, source_record_id)` and idempotent on its own. The
resume deliberately does **not** reconcile — reconciliation draws conclusions
about titles absent from a dataset, and a retained staging set is one we
already know was incompletely applied.

Full atomicity would mean moving the whole diff into a database function, which
means reimplementing `changeDetect.mjs` in PL/pgSQL and keeping two copies of
the most correctness-critical logic in the feature. That is a deliberate future
decision, recorded under Known limitations rather than half-done.

### The statement timeout — read this before debugging a slow sync

**PostgREST applies the statement timeout of the role it *impersonates*, not of
the login role.** Supabase ships explicit settings for the roles a browser can
reach, and `service_role` was not one of them:

| Role | `statement_timeout` |
|---|---|
| `anon` | 3s |
| `authenticated` | 8s |
| `authenticator` (login role, session default) | 8s |
| `service_role` | **none set → inherited 8s** |

So every statement the importer issued — a 42,000-record provincial import
running in GitHub Actions with nobody waiting on it — ran under a ceiling
designed for interactive browser requests. All three of the sync's early
failures were that one fact wearing different clothes:

| Date | Reported as | Actually |
|---|---|---|
| 2026-08-06 | `Could not read existing owners: TypeError: fetch failed` | 500 UUIDs in one `.in()` → an 18 KB URL the edge refused |
| 2026-08-07 | `Reconciliation failed: canceling statement due to statement timeout` | 4 sequential scans of a wide table, ~27s, against 8s |
| 2026-08-07 | `Owner upsert failed: canceling statement due to statement timeout` | 42,695 of 42,704 owner rows written, then one 500-row batch ran long |

Fixed in three places, and it needs all three:

1. **`20260807000003_service_role_statement_timeout.sql`** raises `service_role`
   to 60s. This is the actual fix. It requires `notify pgrst, 'reload config'`
   — PostgREST caches role settings, so without it the change does not take
   effect until the pool recycles.
2. **`20260807000002_tenure_reconcile_index.sql`** indexes
   `(jurisdiction, source, last_synced_at)`, taking the reconciliation scan from
   6,750 ms to 9 ms.
3. **`writeInChunks` in `db.mjs`** halves a batch that returns SQLSTATE 57014
   and retries, down to a floor of 25 rows. Batch cost is not uniform — a page
   of claims held by one owner writes far more owner rows than a page of
   sole-owner claims — so any fixed batch size eventually meets a slow one. It
   halves on 57014 **only**; retrying a constraint violation smaller would turn
   one legible error into forty.

If a future sync reports a statement timeout, check in this order: is
`service_role`'s setting still present (`pg_db_role_setting`), does the slow
statement have an index, and only then consider the batch size.

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
| Reminder thresholds | 90, 30, 1 | 90, 30, 7, 1 | full ladder |

Creating a portfolio and adding tenures go through RPCs; direct `INSERT` is
revoked, so the quota cannot be raced by two tabs or bypassed by a direct call.
Adding more titles than remain is **partial**: it adds what fits and reports the
rest, rather than failing the batch.

Alert recipients are the exception to the RPC pattern — "add a colleague's
address" is a plain form, so the `INSERT` grant stays and a `BEFORE INSERT`
trigger (`tenure_recipient_guard`) enforces `max_alert_recipients` and validates
the address shape instead. It is the one chokepoint every insert passes through,
including from a screen nobody has written yet. Service-role callers
(`auth.uid()` null) are exempt, as everywhere else.

`monitored_portfolios.name` carries a length `CHECK` at the column, and
`internal_project_name` is bounded in the membership audit trigger, because both
are rendered into reminder emails and the rename path is a direct `UPDATE` that
bypasses the validation in `create_monitored_portfolio`.

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

1. **Apply the seven migrations** in the Supabase SQL editor, in order. Run the
   verification queries at the foot of each.

   > Already done on the production project (`ibuzjzoqnkwjfecftzxn`) on
   > 2026-08-01: all seven are applied, the grant matrix was verified table by
   > table and function by function, and the quota, ownership-isolation and
   > admin-authorization paths were exercised inside a rolled-back transaction.
   > Steps 2 onwards are what remain.

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
   account's portfolio is inaccessible by direct id. While there, confirm the
   two limits that are enforced by triggers rather than RPCs, since a direct
   call is exactly what they exist to stop:

   ```sql
   -- as a free user whose policy already has its 1 recipient:
   insert into public.tenure_alert_recipients (policy_id, email)
     values ('<their policy id>', 'someone@example.com');   -- expect RECIPIENT_LIMIT
   insert into public.tenure_alert_recipients (policy_id, email)
     values ('<their policy id>', 'not an address');        -- expect invalid recipient email
   update public.monitored_portfolios set name = repeat('A', 500)
     where id = '<their portfolio id>';                     -- expect a CHECK violation
   ```
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
   inference as a government record. `PERCENT_OWNERSHIP` and `NUMBER_OF_OWNERS`
   ARE published (confirmed 2026-08-05), but as flat per-title values, so they
   are attached only when the title has exactly one owner — a percentage cannot
   be assigned to whichever co-owner name happened to sort first.
2. ~~**Client-number search has nothing to match on.**~~ **Resolved 2026-08-05.**
   The field is published as `CLIENT_NUMBER_ID`; the candidate list simply did
   not name it, so a shipped feature sat inert while this document asserted the
   province was at fault. Live as of the next sync.
3. **No MTO deep link.** MTO's public search is a stateful JSP application with
   no documented stable per-tenure URL, so we link to the registry's front door
   and state the number to search. A guessed URL that rots — or worse, lands on
   the wrong title — would be worse than an honest two-step.
4. **`assigned_user_id` has no UI.** Portfolios are user-scoped in v1, so there
   is nobody else to assign to. The column and the audit hook exist for the
   organization-scoped plan.
5. **Bounce detection is inferred**, from Resend's 422 response, not from a
   webhook. A soft bounce that later becomes permanent is not detected.
6. **No double opt-in for alert recipients.** An address added to a policy starts
   receiving reminders without confirming. The abuse ceiling is bounded — the
   recipient cap is enforced server-side (1 free / 2 Pro), the portfolio cap
   bounds how many policies are live, the HTML body escapes user text, the
   plain-text part is flattened to one line, the subject is derived from
   government data rather than chosen, and every mail carries a provenance
   footer — so the residual is a small volume of unsolicited but honest-looking
   reminders. A `confirmed_at` column plus a signed confirmation link is the
   right next step before recipient limits are raised for a Company plan.
7. **No PDF or Excel export.** CSV only, because it can be produced reliably
   with what is already here.
8. **Map-extent search is a bounding-box prompt**, not a draw-on-the-map tool.
9. **Change detection cannot see history before a tenure was first imported.**
   The first sighting of a title produces no events, by design.
10. **Snapshots do not store geometry**, only its fingerprint and the change
   event. Reconstructing an exact historical polygon is not possible yet — this
   is the one thing a future Released Claim Radar would want revisited.
11. **Promotion is recoverable, not atomic.** A crash part-way through writing
   leaves some batches applied; the next run finishes the job and the operator
   is told the truth in the meantime (see *What "untouched" covers*). Making it
   genuinely atomic means moving the diff into a database function and keeping
   a second copy of `changeDetect.mjs` in PL/pgSQL — a real decision, not an
   oversight, and not one to take under review pressure.

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
