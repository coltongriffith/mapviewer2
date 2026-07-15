// Pure analytics helpers for the admin dashboard v2. No React, no I/O — every
// function here is unit-tested (tests/admin-metrics.test.js). The event-set
// constants and the activation/classifier logic MIRROR the SQL predicates in
// supabase/migrations/20260713000001_admin_dashboard_v2.sql
// (em_is_active_event / em_is_value_event / em_is_activation_event + the
// classifyUser CASE). Keep the two in sync — they are one definition in two
// languages, cross-referenced by comment.

export const SMALL_N = 8; // below this, show absolute change / no percentage

export const ACTIVE_EVENTS = new Set([
  'editor_opened', 'first_layer_added', 'export_completed', 'share_created',
  'share_forked', 'signup_completed', 'onboarding_step', 'project_created',
  'project_saved', 'project_opened', 'registry_claims_imported', 'layer_added',
  'element_added',
]);

export const VALUE_EVENTS = new Set([
  'project_created', 'project_saved', 'export_completed', 'share_created',
  'registry_claims_imported',
]);

// ── formatting ───────────────────────────────────────────────────────────────

export function fmtNum(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-CA');
}

export function fmtDate(d) {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function relTime(d) {
  if (!d) return '';
  const then = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - then.getTime();
  if (Number.isNaN(diff)) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ── F4: small-number honesty ────────────────────────────────────────────────

/**
 * Delta between a current and prior window count. Returns null when there's
 * nothing to show (both zero), else a descriptor the DeltaChip renders:
 *   { kind, text, tone: 'good'|'bad'|'neutral', title }
 * Never produces a percentage off a prior < SMALL_N, or off zero.
 */
export function formatDelta(cur, prior, goodDirection = 'up') {
  cur = Number(cur) || 0;
  prior = Number(prior) || 0;
  const title = `${cur} vs ${prior} prior period`;
  if (cur === 0 && prior === 0) return null;
  if (cur === prior) return { kind: 'flat', text: '— flat', tone: 'neutral', title };

  const rose = cur > prior;
  const tone = rose === (goodDirection === 'up') ? 'good' : 'bad';

  if (prior === 0) {
    // New activity where there was none — always framed positive.
    return { kind: 'new', text: `+${cur} new`, tone: goodDirection === 'up' ? 'good' : 'neutral', title };
  }
  if (prior < SMALL_N) {
    const diff = cur - prior;
    return { kind: 'abs', text: `${diff > 0 ? '+' : ''}${diff} (was ${prior})`, tone: 'neutral', title };
  }
  const pctVal = Math.round(((cur - prior) / prior) * 100);
  return { kind: 'pct', text: `${rose ? '▲' : '▼'} ${Math.abs(pctVal)}%`, tone, title };
}

/** "X of N", with "(P%)" appended only when N ≥ SMALL_N. Never NaN%. */
export function formatRate(n, of) {
  n = Number(n) || 0;
  of = Number(of) || 0;
  if (of === 0) return { text: '—', title: 'No users in this cohort yet' };
  const base = `${n} of ${of}`;
  if (of < SMALL_N) return { text: base, title: `${base} (too few to show a percentage)` };
  const pctVal = Math.round((n / of) * 100);
  return { text: `${base} (${pctVal}%)`, title: `${base} = ${pctVal}%` };
}

// ── user status classifier (mirrors the SQL CASE) ────────────────────────────

/**
 * @param {object} u  { activated, created_at, last_event_at, active_days_30, value_14 }
 * @param {number} nowMs  reference time (default Date.now())
 */
export function classifyUser(u, nowMs = Date.now()) {
  const created = new Date(u.created_at).getTime();
  const ageDays = (nowMs - created) / 86400000;
  const lastEvent = u.last_event_at ? new Date(u.last_event_at).getTime() : null;
  const daysSinceEvent = lastEvent == null ? Infinity : (nowMs - lastEvent) / 86400000;

  if (!u.activated && ageDays < 7) return 'new';
  if (!u.activated) return 'never_activated';
  if ((u.active_days_30 ?? 0) >= 3) return 'power';
  if ((u.value_14 ?? 0) >= 1) return 'active';
  if (daysSinceEvent >= 14) return 'dormant';
  return 'active';
}

export const STATUS_LABEL = {
  new: 'New', never_activated: 'Never activated', power: 'Power',
  active: 'Active', dormant: 'Dormant',
};

// ── timezone-aware day bucketing (server pre-buckets, this is for client fills) ─

/** 'YYYY-MM-DD' Pacific (or any tz) calendar date for an instant. */
export function toPacificDate(instant, tz = 'America/Vancouver') {
  const dt = typeof instant === 'string' ? new Date(instant) : instant;
  // en-CA short date is YYYY-MM-DD; timeZone converts the instant to that zone.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(dt);
}

/**
 * Zero-fill a daily series between two 'YYYY-MM-DD' dates (inclusive), mapping
 * rows keyed by a Pacific date string to their value. Returns an ordered array
 * of { d, value }. Used to render sparklines/columns from RPC day arrays with
 * no gaps even when a day had no activity.
 */
export function bucketDays(rows, startDateStr, endDateStr, key = 'd', valueKey = 'value') {
  const byDate = new Map(rows.map((r) => [String(r[key]).slice(0, 10), Number(r[valueKey]) || 0]));
  const out = [];
  const cur = new Date(`${startDateStr}T00:00:00Z`);
  const end = new Date(`${endDateStr}T00:00:00Z`);
  // Iterate on UTC midnight anchors (date-only, tz-neutral) to avoid DST drift.
  while (cur <= end) {
    const ds = cur.toISOString().slice(0, 10);
    out.push({ d: ds, value: byDate.get(ds) ?? 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// ── tooltip dictionary (one source of truth for metric definitions) ──────────

export const METRIC_DEFS = {
  active_today: 'Signed-in users who did something in the editor today, Pacific time — opened it, added data or annotations, saved, exported, shared, or imported claims. Excludes your own admin account and passive impressions. Anonymous visitors are counted as sessions on the Acquisition tab.',
  new_signups: 'Accounts created in this window, from auth.users. Excludes admin accounts.',
  activated: 'Of accounts old enough to judge (signed up 7–35 days ago), how many reached first value within 7 days: exported, shared a map, imported claims, uploaded their own data, or placed map annotations. Loading demo data or autosave alone doesn\'t count. Newer signups are "pending", not failures.',
  meaningful_actions: 'Value moments: projects created or worked on (a project counts once per editing session — autosave can\'t inflate this), completed exports, shares created, and claim imports. One user doing five things counts five times; the users figure deduplicates.',
  maps_exports: 'Cloud projects created and worked on (each project counts once per editing session), plus completed exports by format. Failed exports are shown separately — a failure is a support signal, not usage. Project tracking began at the migration date; earlier history is estimated from project timestamps.',
  returning: 'Active users this window who had already used the app on an earlier day — not brand-new and not single-visit. The honest retention signal at small scale.',
  retention_ladder: 'Every registered user, bucketed by how recently they did a meaningful action. A cohort grid needs hundreds of users to be readable; this ladder is exact at any size.',
  cohorts: 'Of users who signed up N+ days ago, how many came back on a later day within N days. Dashes mean the cohort is too young to judge — never zero.',
  activation_funnel: 'New signups moving from account creation to first value. Each stage counts a user only if they reached it within 7 days of signing up. Click a stage to see who is stuck there.',
};
