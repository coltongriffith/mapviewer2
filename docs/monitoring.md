# Monitoring, alerting and incident response

Audit refs: **P1-12** (no error monitoring or alerting), **P1-13** (no backup
or disaster-recovery evidence).

## What is already built and live

These need no external account and are working now:

| Piece | Where | What it does |
|---|---|---|
| Client error capture | `src/utils/errorReporter.js` | Catches uncaught errors, unhandled promise rejections and React render crashes. Redacts tokens/JWTs/API keys/emails before sending. Caps at 25 reports per session and dedupes the same fault to once a minute. |
| React boundary reporting | `src/components/ErrorBoundary.jsx` | A render crash — the worst client failure — now reaches the sink, not just the console. |
| Ingest endpoint | `api/client-error.js` | Verifies identity from the bearer token (never the request body), fingerprints the fault, and collapses repeats inside a 10-minute window so a render loop is one row, not thousands. |
| Storage | `public.error_events` | Service-role writes only; RLS on; no client grants. |
| Admin view | Admin → **Health** tab | Errors in the last 24h, grouped by fingerprint, with count, affected users, release, and a sample stack. |
| API error logs | `api/stripe-*.js`, `api/client-error.js` | Structured single-line JSON to stdout, visible in Vercel runtime logs. Billing failures log unconditionally (they used to log only outside production, which is why the checkout failure was invisible). |
| Release tagging | `vite.config.js` `__APP_VERSION__` | Every report carries the package version, so "did my last deploy break this" is answerable. |

**The gap this leaves:** the Health tab is *pull*, not *push*. Somebody has to
look at it. Nothing pages you at 2am when the error rate spikes or when the
Stripe webhook starts returning 500s. That is what the steps below add.

---

## Steps to finish P1-12 (routed alerting)

These need accounts, so they are yours to do. Roughly 45 minutes total.

### 1. Sentry for frontend + API errors (~20 min)

1. Create a project at <https://sentry.io> → **Create Project** → platform
   **React**. Copy the DSN.
2. Install: `npm i @sentry/react`
3. In Vercel → Project → Settings → Environment Variables, add for
   **Production** and **Preview**:
   - `VITE_SENTRY_DSN` = the DSN from step 1
4. Initialise in `src/main.jsx`, above `installErrorReporting()`:
   ```js
   import * as Sentry from '@sentry/react';
   if (import.meta.env.VITE_SENTRY_DSN) {
     Sentry.init({
       dsn: import.meta.env.VITE_SENTRY_DSN,
       release: __APP_VERSION__,
       tracesSampleRate: 0.1,
       replaysOnErrorSampleRate: 0.1,
       // Do not ship PII; our own reporter already redacts, mirror that here.
       sendDefaultPii: false,
     });
   }
   ```
   Then add one line inside `reportError()` in `src/utils/errorReporter.js` so
   both sinks receive the same events:
   ```js
   if (window.Sentry) window.Sentry.captureException(error);
   ```
5. **Update the CSP** in `vercel.json` — this is the step people forget, and
   without it Sentry is silently blocked. Add to `connect-src`:
   `https://*.ingest.sentry.io`
6. Verify: deploy, then in the browser console run `throw new Error('sentry smoke test')`
   and confirm it appears in Sentry **and** in the admin Health tab.

### 2. Alert rules (~10 min)

In Sentry → **Alerts** → **Create Alert Rule**:

| Alert | Condition | Route to |
|---|---|---|
| New error type | A new issue is created | Email / Slack |
| Error spike | More than 25 events in 5 minutes | Email + phone |
| Billing broken | Issue tags contain `stripe-webhook` or `stripe-checkout` | Phone — this one costs money |

Set the owner to a monitored address, not a personal mailbox (see the
`support@` / `billing@` note in the privacy policy).

### 3. Uptime checks (~10 min)

Free tier of [Better Stack](https://betterstack.com) or
[UptimeRobot](https://uptimerobot.com). Monitor every 5 minutes:

- `https://www.explorationmaps.com/` — expect 200, expect body to contain `root`
- `https://www.explorationmaps.com/api/claims?q=test&province=BC` — expect 200
- `https://www.explorationmaps.com/api/stripe-webhook` — expect **405**
  (it only accepts POST; a 404 here means the function stopped deploying)

Route failures to the same place as the phone alerts above.

### 4. Stripe's own alerting (~5 min)

Stripe Dashboard → **Developers → Webhooks** → your endpoint → enable
**Email me about failed webhook deliveries**. The `stripe_events` ledger means
a redelivery is safe, so alerting on failure costs nothing but catches an
outage early.

---

## Steps to finish P1-13 (backups and a restore drill)

Backups you have never restored are not backups. This is ~1 hour, mostly
waiting.

### 1. Confirm backups are on

Supabase Dashboard → Project → **Database → Backups**.

- Free plan: daily backups, 7-day retention, **no point-in-time recovery**.
- Pro plan ($25/mo): PITR available. Given the product now stores customer
  projects, brand kits and billing state, PITR is worth the $25.

Enable PITR if on Pro.

### 2. Write down your targets

Decide and record, in this file:

- **RPO** (how much data you can afford to lose): with daily backups, up to
  24 hours. With PITR, ~2 minutes.
- **RTO** (how long recovery may take): realistically 1–2 hours for a restore
  into a new project plus a DNS/env cutover.

### 3. Do the drill

1. Supabase → **New project** named `explorationmaps-restore-drill`.
2. Restore the most recent backup into it (Backups → **Restore** → choose the
   new project), or use `supabase db dump` from production and
   `psql` it into the drill project.
3. Run the verification queries from
   `supabase/migrations/00000000000000_baseline_schema.sql` (bottom of the
   file) against the restored database and confirm:
   - every expected table exists,
   - RLS is on for every application table,
   - `anon` holds no read access to user data.
4. Point a local build at it: set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   to the drill project and confirm sign-in, opening a project, and export work.
5. **Record the wall-clock time it actually took** in the table below.
6. Delete the drill project.

| Drill date | Restored from | Time to usable | Notes |
|---|---|---|---|
| _(not yet run)_ | | | |

### 4. Migration rollback rehearsal

Every migration in `supabase/migrations/` has a `Rollback:` comment block.
Pick the most recent one, apply it to the drill project, confirm the app still
works, then re-apply the migration. This is the procedure you will want under
pressure, and the first time you run it should not be during an incident.

---

## Incident runbook

**Billing is broken (checkout 502s, or webhooks failing)**
1. Vercel → Logs, filter `at":"stripe-checkout"` or `at":"stripe-webhook"`.
   Every billing failure logs one JSON line with the Stripe event id.
2. Stripe Dashboard → Developers → Webhooks → check delivery attempts.
3. The `stripe_events` ledger makes redelivery safe — resend from Stripe
   rather than hand-editing entitlements.
4. Most common cause: env vars from mismatched Stripe accounts or modes. All
   four (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_MONTHLY_ID`, `STRIPE_PRICE_YEARLY_ID`) must come from **one
   account in one mode**.

**Error rate spiked after a deploy**
1. Admin → Health. Group by fingerprint; check the `release` column to confirm
   it started with the latest deploy.
2. Vercel → Deployments → **Instant Rollback** to the previous build.
3. Reproduce locally against the failing release before rolling forward.

**Database degraded or wrong**
1. Supabase → Database → Backups.
2. Restore into a *new* project first (never in place) and verify before any
   cutover, exactly as rehearsed in the drill above.

**A share link is leaking something it should not**
Revoke it immediately — Account → Shared links → Revoke, which clears the
stored payload rather than merely hiding it. For someone else's share, as
service role:
```sql
select public.revoke_shared_map('<share id>');
```
