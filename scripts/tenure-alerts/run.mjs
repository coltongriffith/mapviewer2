#!/usr/bin/env node
// Tenure Monitor alert engine — schedule, then dispatch.
//
//   node scripts/tenure-alerts/run.mjs                 schedule + send
//   node scripts/tenure-alerts/run.mjs --schedule-only recompute, send nothing
//   node scripts/tenure-alerts/run.mjs --dry-run       render emails to stdout
//
// Scheduled by .github/workflows/tenure-alerts.yml. Both halves are idempotent
// and safe to re-run:
//
//   scheduling  is a reconcile — it inserts what is missing and supersedes what
//               no longer matches. Running it twice changes nothing the second
//               time. Duplicate inserts lose to the database's unique index
//               rather than to a check in this file.
//
//   dispatch    claims rows by flipping their status before sending, so a
//               concurrent or re-fired run finds nothing left to take.
//
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY.

import { createClient } from '@supabase/supabase-js';
import { supabaseCredentials } from '../lib/env.mjs';
import { bcToday } from '../../src/utils/tenureDates.js';
import {
  planExpiryAlerts, planChangeAlerts, reconcileAlerts, dueNow, maySend,
} from './plan.mjs';
import { renderAlert } from './templates.mjs';
import { send } from './send.mjs';

const MAX_ATTEMPTS = 3;
const CHANGE_LOOKBACK_DAYS = 7;

function client() {
  const { url, key } = supabaseCredentials();
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const scheduleOnly = args.has('--schedule-only');
  const sb = client();
  const now = new Date();

  const sync = await lastSuccessfulSync(sb);
  const alertsSafe = Boolean(sync?.alerts_safe);
  console.log(`[tenure-alerts] last successful sync: ${sync?.completed_at || 'never'} `
    + `(alerts_safe=${alertsSafe})`);

  if (!sync) {
    // No successful import has ever completed, so every good-to-date we hold is
    // unverified. Reminders wait rather than going out against nothing.
    console.log('[tenure-alerts] no successful government sync yet — nothing to alert on.');
    return;
  }

  const scheduled = await schedule(sb, { now, alertsSafe });
  console.log(`[tenure-alerts] scheduled ${scheduled.inserted} new, `
    + `superseded ${scheduled.superseded} obsolete, `
    + `requeued ${scheduled.revived} previously held.`);

  if (scheduleOnly) return;

  const sent = await dispatch(sb, { now, alertsSafe, sync, dryRun });
  console.log(`[tenure-alerts] sent ${sent.sent}, failed ${sent.failed}, `
    + `held ${sent.suppressed}.`);
}

// ── Scheduling ─────────────────────────────────────────────────────────────

async function schedule(sb, { now, alertsSafe }) {
  const portfolios = await loadPortfolios(sb);
  let inserted = 0;
  let superseded = 0;
  let revived = 0;

  for (const portfolio of portfolios) {
    const [memberships, recipients, existing] = await Promise.all([
      loadMemberships(sb, portfolio.id),
      loadRecipients(sb, portfolio.alert_policy_id),
      loadScheduled(sb, portfolio.id),
    ]);
    if (!memberships.length) continue;

    const offsets = portfolio.policy?.expiry_offsets || [90, 30];
    const planned = [];
    for (const m of memberships) {
      planned.push(...planExpiryAlerts(m, offsets, recipients, now));
    }

    // Change notices are only ever scheduled off a run the guardrails trusted.
    // Scheduling them from an untrusted run and suppressing them at send time
    // would leave a queue of claims that may never have been true.
    if (alertsSafe) {
      const changes = await loadRecentChanges(sb, memberships.map((m) => m.tenure.id));
      for (const m of memberships) {
        for (const c of changes.filter((x) => x.tenure_id === m.tenure.id)) {
          planned.push(...planChangeAlerts(m, c, recipients, portfolio.policy, now));
        }
      }
    }

    const { toInsert, toSupersede, toRevive } = reconcileAlerts(planned, existing);

    if (toInsert.length) {
      inserted += await insertIgnoringDuplicates(sb, toInsert);
    }

    // Hand held alerts back to the dispatcher, which re-evaluates the block and
    // either sends or holds again. Without this a suppressed reminder is never
    // looked at again — see reconcileAlerts.
    if (toRevive.length) {
      const { error } = await sb.from('tenure_alert_instances')
        .update({
          status: 'pending',
          delivery_metadata: { requeued_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        })
        .in('id', toRevive);
      if (error) {
        console.warn(`[tenure-alerts] requeue failed: ${error.message}`);
      } else {
        revived += toRevive.length;
      }
    }

    if (toSupersede.length) {
      const { error } = await sb.from('tenure_alert_instances')
        .update({ status: 'superseded', updated_at: new Date().toISOString() })
        .in('id', toSupersede);
      if (error) {
        console.warn(`[tenure-alerts] supersede failed: ${error.message}`);
      } else {
        superseded += toSupersede.length;
      }
    }
  }

  return { inserted, superseded, revived };
}

// ── Dispatch ───────────────────────────────────────────────────────────────

async function dispatch(sb, { now, alertsSafe, sync, dryRun }) {
  const globalPause = process.env.TENURE_ALERTS_PAUSED === '1';
  if (globalPause) console.log('[tenure-alerts] TENURE_ALERTS_PAUSED=1 — sending nothing.');

  const pending = await loadAllDue(sb, now);
  const due = dueNow(pending, now);
  let sent = 0;
  let failed = 0;
  let suppressed = 0;

  for (const alert of due) {
    const verdict = maySend(alert, {
      alertsSafe,
      portfolioPaused: alert.portfolio?.alerts_paused,
      globalPause,
    });

    if (!verdict.send) {
      // Held, not cancelled. The next scheduling pass hands it back to pending
      // (reconcileAlerts → toRevive) so this same check runs again against
      // fresh conditions; an administrator can also force it with
      // admin_retry_tenure_alert. Nothing here is a terminal state.
      await sb.from('tenure_alert_instances').update({
        status: 'suppressed',
        delivery_metadata: { held_reason: verdict.reason, held_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }).eq('id', alert.id);
      suppressed += 1;
      continue;
    }

    if (alert.attempt_count >= MAX_ATTEMPTS) {
      await markFailed(sb, alert, `giving up after ${MAX_ATTEMPTS} attempts`);
      failed += 1;
      continue;
    }

    // CLAIM BEFORE SENDING. Flipping the row out of 'pending' first means a
    // second worker — or this job re-fired by a flaky scheduler — finds nothing
    // to take. The alternative (send, then mark) sends twice whenever the
    // marking step loses a race, and a duplicate deadline email undermines
    // trust in every other one.
    const claimed = await claim(sb, alert);
    if (!claimed) continue;

    // Everything from here on runs on a row that is already OUT of 'pending'.
    // Any throw that escapes leaves it in 'sending' — a status nothing selects
    // and nothing requeues — so the reminder is silently lost rather than
    // retried. renderAlert and the credential read are both capable of it, so
    // the guarantee is made structurally here rather than one call at a time.
    try {
      const context = {
        tenure: alert.tenure,
        owners: alert.owners,
        portfolioName: alert.portfolio?.name,
        membership: alert.membership,
        change: alert.change,
        lastSyncedAt: sync?.completed_at,
        now,
      };
      const email = renderAlert(alert, context);

      if (dryRun) {
        console.log(`\n--- to ${alert.recipient.email}\nSubject: ${email.subject}\n`);
        console.log(email.text);
        // Put it back so a dry run leaves the queue exactly as it found it.
        await sb.from('tenure_alert_instances')
          .update({ status: 'pending', attempt_count: alert.attempt_count })
          .eq('id', alert.id);
        continue;
      }

      const result = await send(alert.recipient.email, email);
      if (result.ok) {
        await sb.from('tenure_alert_instances').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          delivery_metadata: { provider: 'resend', message_id: result.id },
          updated_at: new Date().toISOString(),
        }).eq('id', alert.id);
        sent += 1;
      } else if (result.hardBounce) {
        // A permanently bad address should stop consuming retries for every
        // future alert, not just this one.
        await sb.from('tenure_alert_recipients').update({
          bounced_at: new Date().toISOString(),
          bounce_reason: result.error?.slice(0, 300),
        }).eq('id', alert.recipient_id);
        await markFailed(sb, alert, result.error);
        failed += 1;
      } else {
        // Transient: back to pending, attempt counted, retried next run.
        await sb.from('tenure_alert_instances').update({
          status: 'pending',
          last_attempt_at: new Date().toISOString(),
          delivery_metadata: { last_error: String(result.error).slice(0, 300) },
          updated_at: new Date().toISOString(),
        }).eq('id', alert.id);
        failed += 1;
      }
    } catch (e) {
      // Put it back. An unexpected fault is a reason to try again next run,
      // never a reason to drop a deadline reminder on the floor.
      await sb.from('tenure_alert_instances').update({
        status: 'pending',
        last_attempt_at: new Date().toISOString(),
        delivery_metadata: { last_error: String(e?.message || e).slice(0, 300) },
        updated_at: new Date().toISOString(),
      }).eq('id', alert.id);
      console.warn(`[tenure-alerts] alert ${alert.id} requeued after an unexpected fault: ${e?.message || e}`);
      failed += 1;
    }
  }

  return { sent, failed, suppressed };
}

async function claim(sb, alert) {
  const { data, error } = await sb.from('tenure_alert_instances')
    .update({
      status: 'sending',
      attempt_count: alert.attempt_count + 1,
      last_attempt_at: new Date().toISOString(),
    })
    .eq('id', alert.id)
    .eq('status', 'pending')     // ← the compare-and-swap
    .select('id');
  if (error) {
    console.warn(`[tenure-alerts] could not claim ${alert.id}: ${error.message}`);
    return false;
  }
  return (data || []).length > 0;
}

async function markFailed(sb, alert, reason) {
  await sb.from('tenure_alert_instances').update({
    status: 'failed',
    delivery_metadata: { error: String(reason).slice(0, 300) },
    updated_at: new Date().toISOString(),
  }).eq('id', alert.id);
}

// ── Loading ────────────────────────────────────────────────────────────────

async function lastSuccessfulSync(sb) {
  const { data } = await sb
    .from('tenure_import_runs')
    .select('completed_at, alerts_safe, records_processed')
    .eq('status', 'succeeded')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function loadPortfolios(sb) {
  const { data, error } = await sb
    .from('monitored_portfolios')
    .select('id, name, alerts_paused, alert_policy_id, tenure_alert_policies(id, expiry_offsets, change_events_enabled)');
  if (error) throw new Error(`Could not load portfolios: ${error.message}`);
  return (data || []).map((p) => ({ ...p, policy: p.tenure_alert_policies }));
}

async function loadMemberships(sb, portfolioId) {
  const { data, error } = await sb
    .from('monitored_portfolio_tenures')
    .select(`id, portfolio_id, monitoring_enabled, maintenance_decision, internal_project_name,
             tenures!inner(id, tenure_number, tenure_name, status, good_to_date, area_hectares)`)
    .eq('portfolio_id', portfolioId)
    .is('removed_at', null);
  if (error) throw new Error(`Could not load memberships: ${error.message}`);
  return (data || []).map((m) => ({ ...m, tenure: m.tenures }));
}

async function loadRecipients(sb, policyId) {
  if (!policyId) return [];
  const { data, error } = await sb
    .from('tenure_alert_recipients')
    .select('id, email, receives_expiry_alerts, receives_change_alerts, bounced_at')
    .eq('policy_id', policyId);
  if (error) throw new Error(`Could not load recipients: ${error.message}`);
  return data || [];
}

/**
 * Every alert row for a portfolio, in any status.
 *
 * ALL statuses, not just pending: the unique index spans them, so an alert
 * that has already been SENT must still be visible to the reconciler or it
 * gets re-proposed on every run for the rest of time.
 */
async function loadScheduled(sb, portfolioId) {
  const { data, error } = await sb
    .from('tenure_alert_instances')
    .select('id, status, portfolio_id, tenure_id, recipient_id, alert_type, offset_days, source_good_to_date, change_event_id')
    .eq('portfolio_id', portfolioId);
  if (error) throw new Error(`Could not load scheduled alerts: ${error.message}`);
  return data || [];
}

/**
 * Insert planned alerts, letting the database reject duplicates.
 *
 * The unique index uses coalesce() over two nullable columns, which PostgREST
 * cannot express as an ON CONFLICT target — so rather than weaken the index to
 * suit the client, the client absorbs the violation. A batch that collides is
 * retried row by row and 23505 is treated as success, because a duplicate
 * alert already existing is precisely the outcome we wanted.
 */
async function insertIgnoringDuplicates(sb, rows) {
  const { error } = await sb.from('tenure_alert_instances').insert(rows);
  if (!error) return rows.length;
  if (error.code !== '23505') {
    console.warn(`[tenure-alerts] alert insert failed: ${error.message}`);
    return 0;
  }
  let ok = 0;
  for (const row of rows) {
    const { error: rowError } = await sb.from('tenure_alert_instances').insert(row);
    if (!rowError) ok += 1;
    else if (rowError.code !== '23505') {
      console.warn(`[tenure-alerts] alert insert failed: ${rowError.message}`);
    }
  }
  return ok;
}

async function loadRecentChanges(sb, tenureIds) {
  if (!tenureIds.length) return [];
  const since = new Date(Date.now() - CHANGE_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await sb
    .from('tenure_change_events')
    .select('id, tenure_id, event_type, previous_value, current_value, severity, detected_at')
    .in('tenure_id', tenureIds)
    .gte('detected_at', since)
    // Only material changes reach an inbox. Informational ones (a claim name
    // tidy-up) live in the change history where somebody can go look for them.
    .in('severity', ['notable', 'critical']);
  if (error) throw new Error(`Could not load change events: ${error.message}`);
  return data || [];
}

/** Everything due, with the joins the templates need. */
async function loadAllDue(sb, now) {
  const today = bcToday(now);
  const { data, error } = await sb
    .from('tenure_alert_instances')
    .select(`id, portfolio_id, tenure_id, recipient_id, alert_type, offset_days,
             scheduled_for, source_good_to_date, change_event_id, status, attempt_count,
             monitored_portfolios!inner(id, name, alerts_paused),
             tenures!inner(id, tenure_number, tenure_name, status, good_to_date, area_hectares),
             tenure_alert_recipients!inner(id, email, bounced_at),
             tenure_change_events(id, event_type, previous_value, current_value, severity)`)
    .eq('status', 'pending')
    .lte('scheduled_for', today)
    .order('scheduled_for', { ascending: true })
    .limit(2000);
  if (error) throw new Error(`Could not load due alerts: ${error.message}`);

  const rows = (data || []).map((a) => ({
    ...a,
    portfolio: a.monitored_portfolios,
    tenure: a.tenures,
    recipient: a.tenure_alert_recipients,
    change: a.tenure_change_events,
  }));

  // Owners, in one query rather than one per alert.
  const tenureIds = [...new Set(rows.map((r) => r.tenure_id))];
  const ownersByTenure = new Map();
  if (tenureIds.length) {
    const { data: owners } = await sb
      .from('tenure_owners')
      .select('tenure_id, owner_name')
      .in('tenure_id', tenureIds);
    for (const o of owners || []) {
      if (!ownersByTenure.has(o.tenure_id)) ownersByTenure.set(o.tenure_id, []);
      ownersByTenure.get(o.tenure_id).push(o);
    }
  }

  // Membership context (project name, decision) for the email body.
  const membershipByKey = new Map();
  const portfolioIds = [...new Set(rows.map((r) => r.portfolio_id))];
  if (portfolioIds.length) {
    const { data: ms } = await sb
      .from('monitored_portfolio_tenures')
      .select('portfolio_id, tenure_id, maintenance_decision, internal_project_name')
      .in('portfolio_id', portfolioIds)
      .is('removed_at', null);
    for (const m of ms || []) membershipByKey.set(`${m.portfolio_id}|${m.tenure_id}`, m);
  }

  return rows
    // A recipient whose address has hard-bounced should not keep consuming
    // attempts on every alert in the queue.
    .filter((r) => !r.recipient?.bounced_at)
    .map((r) => ({
      ...r,
      owners: ownersByTenure.get(r.tenure_id) || [],
      membership: membershipByKey.get(`${r.portfolio_id}|${r.tenure_id}`) || null,
    }));
}

main().catch((err) => {
  console.error(`\n[tenure-alerts] failed: ${err?.message || err}`);
  process.exit(1);
});
