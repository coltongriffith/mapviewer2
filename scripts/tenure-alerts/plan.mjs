// What reminders SHOULD exist, given a portfolio and its policy.
//
// PURE. No database, no email, no clock beyond an injectable `now`. This is
// where the alert engine's correctness lives, and it is where the tests point.
//
// THREE PROPERTIES THIS MODULE GUARANTEES:
//
// 1. NO LATE LIES. An alert whose threshold has already passed is never
//    created. Sending "your claim reaches its good-to-date in 90 days" to
//    somebody who has 20 days left is worse than sending nothing: they will
//    read the number, not the date, and plan around it.
//
// 2. NO SILENT GAPS. A claim added with 20 days left has already passed every
//    standard threshold, and rule 1 would leave it with no reminder at all.
//    So it gets one catch-up reminder, dated today. The email states the
//    ACTUAL days remaining (templates.mjs computes it at send time), so it is
//    truthful by construction. Its key is the threshold being caught up — the
//    smallest policy offset at or above the days left — so the key is stable
//    from one day to the next and the catch-up is sent once, not daily.
//
// 3. NO STALE DEADLINES. Every planned alert records the good-to-date it was
//    computed from. When the province moves that date, the old plan no longer
//    matches and those pending alerts are superseded rather than sent.
//
// De-duplication is NOT this module's job — that is a unique constraint in the
// database (see migration 20260801000002). A plan that proposes the same alert
// twice loses to the constraint, which is the correct division of labour: an
// invariant this important should not depend on application code being right.

import { bcToday, daysRemaining, alertDateFor, toIsoDate } from '../../src/utils/tenureDates.js';

export const ALERT_TYPE = { EXPIRY: 'EXPIRY', CHANGE: 'CHANGE', NOT_OBSERVED: 'NOT_OBSERVED' };

/**
 * The alerts that should exist for one monitored title.
 *
 * @param {object} membership   { tenure, monitoring_enabled, portfolio_id }
 * @param {number[]} offsets    policy thresholds, in days
 * @param {object[]} recipients rows from tenure_alert_recipients
 * @param {Date} now
 * @returns {object[]} planned alert rows (no ids — the database assigns those)
 */
export function planExpiryAlerts(membership, offsets, recipients, now = new Date()) {
  const tenure = membership.tenure || {};
  const goodTo = toIsoDate(tenure.good_to_date);

  // No usable date → no reminder. The portfolio view says "date unavailable —
  // verify in MTO", which is the honest answer; inventing a schedule off a
  // missing date would be worse than saying nothing.
  if (!goodTo) return [];
  if (membership.monitoring_enabled === false) return [];

  const days = daysRemaining(goodTo, now);
  // Already past. The dashboard shows it as expired; an email counting down to
  // a date that has gone is not a reminder, it is noise.
  if (days == null || days < 0) return [];

  const today = bcToday(now);
  const eligible = recipients.filter((r) => r.receives_expiry_alerts !== false && !r.bounced_at);
  if (!eligible.length) return [];

  const rows = [];
  const scheduledOffsets = [];

  for (const offset of [...new Set(offsets)].sort((a, b) => b - a)) {
    const when = alertDateFor(goodTo, offset);
    if (!when) continue;
    // Strictly future-or-today. A threshold in the past is dropped, never
    // back-dated into the outbox.
    if (when < today) continue;
    scheduledOffsets.push(offset);
    for (const r of eligible) {
      rows.push(makeRow(membership, r, {
        alert_type: ALERT_TYPE.EXPIRY,
        offset_days: offset,
        scheduled_for: when,
        source_good_to_date: goodTo,
      }));
    }
  }

  // Property 2: a claim whose thresholds have all gone by still deserves to be
  // heard from once. `offset_days` is the real number of days left, so the
  // email that goes out says something true rather than something convenient.
  const catchUpOffset = Math.min(...[...new Set(offsets)].filter((o) => o >= days));
  if (scheduledOffsets.length === 0 && Number.isFinite(catchUpOffset)) {
    for (const r of eligible) {
      rows.push(makeRow(membership, r, {
        alert_type: ALERT_TYPE.EXPIRY,
        offset_days: catchUpOffset,
        scheduled_for: today,
        source_good_to_date: goodTo,
      }));
    }
  }

  return rows;
}

/**
 * Alerts for a detected change.
 *
 * Only raised for changes the policy asks for, and never for a change detected
 * by an import run the guardrails did not trust — that filtering happens in
 * run.mjs, which knows the run's alerts_safe flag. This function's job is the
 * fan-out to recipients.
 */
export function planChangeAlerts(membership, changeEvent, recipients, policy, now = new Date()) {
  if (policy?.change_events_enabled === false) return [];
  if (membership.monitoring_enabled === false) return [];

  const eligible = recipients.filter((r) => r.receives_change_alerts !== false && !r.bounced_at);
  if (!eligible.length) return [];

  const isAbsence = changeEvent.event_type === 'TENURE_NO_LONGER_OBSERVED';
  return eligible.map((r) => makeRow(membership, r, {
    alert_type: isAbsence ? ALERT_TYPE.NOT_OBSERVED : ALERT_TYPE.CHANGE,
    offset_days: 0,
    scheduled_for: bcToday(now),
    source_good_to_date: null,
    change_event_id: changeEvent.id,
  }));
}

function makeRow(membership, recipient, fields) {
  return {
    portfolio_id: membership.portfolio_id,
    tenure_id: membership.tenure.id,
    recipient_id: recipient.id,
    status: 'pending',
    ...fields,
  };
}

/**
 * The identity of an alert, matching the database's unique index exactly.
 *
 * Kept in one function so a change to the constraint has exactly one place to
 * be mirrored. Nulls are coalesced the same way the index coalesces them —
 * Postgres treats NULLs as distinct in a unique index, which would silently
 * reopen the duplicate door if this disagreed.
 */
export function alertKey(row) {
  return [
    row.portfolio_id,
    row.tenure_id,
    row.recipient_id,
    row.alert_type,
    row.offset_days,
    row.source_good_to_date || '1900-01-01',
    row.change_event_id || '00000000-0000-0000-0000-000000000000',
  ].join('|');
}

/**
 * Reconcile the plan against what is already scheduled.
 *
 * `existing` must include ALREADY-SENT rows, not just pending ones. The unique
 * index spans every status, so a sent alert whose key is still in the plan
 * must not be re-proposed — it would collide on every run forever, and worse,
 * a scheduler that "fixed" that collision by relaxing the key would start
 * sending the same deadline twice.
 *
 * Only PENDING rows are ever superseded. A sent alert is history; a failed one
 * is an administrator's to retry.
 *
 * SUPPRESSED ROWS MUST BE REVIVED, and this is the only place that can do it.
 * A held alert keeps its key, so the clause above correctly declines to insert
 * a duplicate — but the dispatcher only ever loads `pending`, so without a
 * third bucket a suppressed alert is stranded: the pause lifts, the sync comes
 * back clean, and the reminder still never goes out. That is the precise
 * failure this whole feature exists to prevent, arrived at from the inside.
 *
 * Revival is unconditional rather than conditional on the block having
 * cleared. The scheduler would have to re-derive "is the portfolio still
 * paused, was the last import trustworthy" to decide, and it would be deriving
 * it from the same inputs the dispatcher is about to evaluate anyway. So it
 * re-offers the alert and lets `maySend` be the single authority: if the block
 * still stands, dispatch simply holds it again the same day. A permanently
 * paused portfolio churns one UPDATE per alert per run, which is a cheap price
 * for having exactly one place that decides whether a reminder may go out.
 *
 * A suppressed row whose key has LEFT the plan is not revived — a good-to-date
 * that moved makes the old reminder wrong, not overdue.
 *
 * @param {object[]} planned   from planExpiryAlerts / planChangeAlerts
 * @param {object[]} existing  rows already in the database, with `status`
 * @returns {{toInsert: object[], toSupersede: string[], toRevive: string[]}}
 */
const REVIVABLE = new Set(['suppressed', 'cancelled', 'superseded']);

export function reconcileAlerts(planned, existing, now = new Date()) {
  const plannedByKey = new Map(planned.map((p) => [alertKey(p), p]));
  const existingKeys = new Set(existing.map(alertKey));
  const today = bcToday(now);

  // OVERDUE IS NOT OBSOLETE. A threshold whose day passed before it was sent
  // (a skipped cron day, a provider outage, a pause that lifted) drops out of
  // the plan, because the planner never schedules into the past. If the
  // deadline it was computed from is still the planned deadline, the reminder
  // is late, not wrong: keep it so the dispatcher sends it now, with the real
  // days remaining. Only the latest overdue threshold per deadline is kept;
  // one late email is enough.
  const deadlineOf = (r) => [r.portfolio_id, r.tenure_id, r.recipient_id, r.source_good_to_date].join('|');
  const liveDeadlines = new Set(planned.filter((p) => p.alert_type === ALERT_TYPE.EXPIRY).map(deadlineOf));
  const overdue = new Map();
  for (const e of existing) {
    if (!['pending', 'suppressed', undefined].includes(e.status)) continue;
    if (e.alert_type !== ALERT_TYPE.EXPIRY || plannedByKey.has(alertKey(e))) continue;
    if (!e.scheduled_for || e.scheduled_for > today || !liveDeadlines.has(deadlineOf(e))) continue;
    const kept = overdue.get(deadlineOf(e));
    if (!kept || e.offset_days < kept.offset_days) overdue.set(deadlineOf(e), e);
  }
  const keptOverdue = new Set([...overdue.values()].map((e) => e.id));

  const toInsert = [...plannedByKey.entries()]
    .filter(([key]) => !existingKeys.has(key))
    .map(([, row]) => row);

  // A pending alert the plan no longer contains is obsolete. In practice this
  // is almost always a good-to-date that moved: the old rows carry the old
  // source_good_to_date, so their keys stop matching and they are retired
  // instead of being sent with a deadline the province has since changed.
  const toSupersede = existing
    .filter((e) => (e.status === undefined || e.status === 'pending'))
    .filter((e) => !plannedByKey.has(alertKey(e)) && !keptOverdue.has(e.id))
    .map((e) => e.id);

  // Never-sent rows whose key the plan wants again come back to pending.
  // Without this the unique index (which spans every status) blocks the
  // re-planned row forever: remove and re-add a claim (cancelled), or a
  // good-to-date that went null for a night and returned (superseded), and
  // that claim never got another reminder.
  const toRevive = existing
    .filter((e) => REVIVABLE.has(e.status))
    .filter((e) => plannedByKey.has(alertKey(e)) || keptOverdue.has(e.id))
    .map((e) => e.id);

  return { toInsert, toSupersede, toRevive };
}

/**
 * Alerts due to go out today.
 *
 * `scheduled_for <= today` rather than `=`: GitHub Actions runners are not
 * punctual and a scheduled job can be skipped entirely. Catching up on
 * anything overdue means a missed day delays a reminder rather than losing it.
 */
export function dueNow(pending, now = new Date()) {
  const today = bcToday(now);
  return pending.filter((a) => a.scheduled_for <= today);
}

/**
 * Whether a given alert may be sent right now.
 *
 * THE SUPPRESSION RULE, and the reasoning behind its asymmetry:
 *
 *   CHANGE and NOT_OBSERVED notices are claims about what the province did.
 *   If the last import was not trustworthy, we do not actually know that
 *   anything happened, so they wait.
 *
 *   EXPIRY reminders are arithmetic on a good-to-date that was already read
 *   from a SUCCESSFUL import. A later failed sync does not make yesterday's
 *   date wrong. Withholding these would mean going quiet about a real deadline
 *   because of a problem at our end — the worse of the two failures. They go
 *   out, carrying the honest timestamp of the last successful sync.
 *
 * @returns {{send: boolean, reason?: string}}
 */
export function maySend(alert, { alertsSafe, portfolioPaused, globalPause }) {
  if (globalPause) return { send: false, reason: 'alerts paused globally by an administrator' };
  if (portfolioPaused) return { send: false, reason: 'alerts paused for this portfolio' };
  if (alert.alert_type === ALERT_TYPE.EXPIRY) return { send: true };
  if (!alertsSafe) {
    return {
      send: false,
      reason: 'the most recent government data import was incomplete, so change '
        + 'notices are held until a clean run',
    };
  }
  return { send: true };
}

/**
 * Keep a portfolio's reminders within the owner's CURRENT plan.
 *
 * Limits are checked when tenures, portfolios and recipients are added, but a
 * downgrade does not remove anything, so the scheduler applies them again
 * (docs/state-machines.md, BILL-4). Nothing is deleted: the extra rows stay in
 * the account and their pending reminders are superseded, and an upgrade
 * plans them again (superseded rows are revived, see reconcileAlerts).
 *
 * Oldest first: the portfolios, tenures and recipients the owner had first are
 * the ones that keep working.
 *
 * @param {object|null} limits   tenure_plan_limits_for(owner); null = unknown (unchanged)
 * @param {{portfolios:number, tenures:number}} used  running totals for the owner
 */
export function limitPortfolio({ limits, used, memberships, recipients, offsets }) {
  if (!limits) return { memberships, recipients, offsets };
  const byDate = (key) => (a, b) => String(a[key] || '').localeCompare(String(b[key] || ''));
  if (limits.max_portfolios != null && used.portfolios >= limits.max_portfolios) {
    return { memberships: [], recipients: [], offsets: [] };
  }
  used.portfolios += 1;
  const room = limits.max_monitored_tenures == null ? Infinity : Math.max(0, limits.max_monitored_tenures - used.tenures);
  const kept = [...memberships].sort(byDate('added_at')).slice(0, room);
  used.tenures += kept.length;
  const maxRecipients = limits.max_alert_recipients == null ? Infinity : limits.max_alert_recipients;
  const allowed = new Set(limits.alert_offsets || []);
  return {
    memberships: kept,
    recipients: [...recipients].sort(byDate('created_at')).slice(0, maxRecipients),
    offsets: offsets.filter((o) => allowed.has(o)),
  };
}
