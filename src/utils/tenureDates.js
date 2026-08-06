// Date arithmetic for B.C. mineral tenure deadlines.
//
// WHY THIS FILE EXISTS AT ALL: a mineral claim's good-to-date is a legal
// deadline in British Columbia, not in the user's browser. Somebody checking
// their portfolio from London at 08:00 on the 1st is still looking at
// yesterday in Vancouver, and "1 day remaining" vs "0 days remaining" is the
// difference between acting and losing ground. Every date decision in Tenure
// Monitor — days remaining, urgency band, when an alert fires — resolves
// through this module in America/Vancouver, never through `new Date()`
// formatting in local time.
//
// The other half of the rule: the B.C. source publishes GOOD_TO_DATE as a
// DATE, with no time component. We store it as a bare `date` and we do NOT
// invent a government timestamp for it. Anything that needs a "moment" (an
// alert firing time) derives that from OUR schedule, not from a fabricated
// reading of the registry's intent. The UI explains the deadline in MTO's
// terms and points at MTO for the authoritative answer.
//
// Everything here is pure and dependency-free so the browser bundle, the
// Vitest suite, and the Node cron jobs under scripts/ all share one
// implementation.

/** The IANA zone every B.C. tenure deadline is evaluated in. */
export const BC_TIMEZONE = 'America/Vancouver';

/** ISO date pattern we accept and emit everywhere: YYYY-MM-DD. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Today's calendar date in British Columbia, as 'YYYY-MM-DD'.
 *
 * Uses Intl rather than any offset arithmetic so Pacific Daylight Time and
 * Pacific Standard Time are both handled by the platform's tz database
 * instead of by a hand-rolled -7/-8 guess that is wrong twice a year.
 *
 * @param {Date} [now] Injectable clock, for tests.
 * @returns {string} 'YYYY-MM-DD'
 */
export function bcToday(now = new Date()) {
  return formatInBc(now);
}

/**
 * Format an instant as the calendar date it falls on in British Columbia.
 * @param {Date|string|number} instant
 * @returns {string|null} 'YYYY-MM-DD', or null when the input isn't a date.
 */
export function formatInBc(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  // 'en-CA' yields YYYY-MM-DD, which is exactly the shape we store.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Coerce a source value to a bare ISO date string, or null.
 *
 * Government feeds hand us dates in several shapes — '2027-03-14',
 * '2027-03-14T00:00:00Z', and epoch milliseconds all appear across BC/ArcGIS
 * services. A value carrying a time is truncated to its UTC calendar date
 * rather than its Vancouver date: WFS emits midnight-UTC stamps for what are
 * really plain dates, so converting to Pacific would silently walk every
 * good-to-date back by one day.
 *
 * @param {unknown} value
 * @returns {string|null} 'YYYY-MM-DD' or null
 */
export function toIsoDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s) return null;
  if (ISO_DATE.test(s)) return isRealCalendarDate(s) ? s : null;
  // ISO-8601 with a time part: keep the UTC calendar date (see above).
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ── Placeholder dates ──────────────────────────────────────────────────────
//
// The B.C. feed carries sentinel dates in place of missing ones. Three
// application rows in the current mirror have 1900-01-01 in BOTH ISSUE_DATE and
// GOOD_TO_DATE — that is a placeholder the province left in the feed, not a
// date from 1900, and rendering it as one puts "46,000 days ago" on a dashboard
// whose entire job is to be trusted about dates.
//
// Treated as "no date published" rather than as an old date. That is the
// honest reading and it is also the safe one: daysRemaining returns null, the
// urgency band becomes "Date unavailable — verify in MTO", and planExpiryAlerts
// declines to schedule anything off a date we do not actually have.
//
// The set is exact values, not a cutoff. B.C.'s oldest genuine issue date in
// the mirror is 1891-07-29 and its oldest genuine good-to-date is 1991, so a
// "before 1950" heuristic would have discarded real records to catch three
// fake ones.
const PLACEHOLDER_DATES = new Set(['1900-01-01', '0001-01-01', '9999-12-31']);

/**
 * Whether a government date is a placeholder standing in for a missing value.
 * @param {string|null|undefined} value
 */
export function isPlaceholderDate(value) {
  return PLACEHOLDER_DATES.has(String(value ?? '').slice(0, 10));
}

/** Reject impossible dates that still match the pattern (2027-02-31). */
function isRealCalendarDate(iso) {
  const m = ISO_DATE.exec(iso);
  if (!m) return false;
  const [, y, mo, da] = m;
  const d = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(da)));
  return d.getUTCFullYear() === Number(y)
    && d.getUTCMonth() === Number(mo) - 1
    && d.getUTCDate() === Number(da);
}

/** Days between two ISO dates (b - a), using UTC noon to dodge DST entirely. */
function diffDays(aIso, bIso) {
  const a = utcNoon(aIso);
  const b = utcNoon(bIso);
  if (a == null || b == null) return null;
  return Math.round((b - a) / 86_400_000);
}

function utcNoon(iso) {
  const m = ISO_DATE.exec(String(iso || ''));
  if (!m) return null;
  // Noon, not midnight: a 12-hour cushion means no daylight-saving shift can
  // ever push the value across a date boundary during the subtraction.
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
}

/**
 * Calendar days from today (in B.C.) until a good-to-date.
 *
 * 0  → the deadline is today
 * <0 → the date has passed
 * null → no usable date (the caller must say "date unavailable", never "0")
 *
 * @param {string|null|undefined} goodToDate 'YYYY-MM-DD'
 * @param {Date} [now] Injectable clock, for tests.
 */
export function daysRemaining(goodToDate, now = new Date()) {
  const target = toIsoDate(goodToDate);
  // A placeholder is a missing date wearing a date's clothes. Answering null
  // routes it to the "date unavailable — verify in MTO" band, which is what we
  // actually know, instead of counting down from 1900.
  if (!target || isPlaceholderDate(target)) return null;
  return diffDays(bcToday(now), target);
}

/**
 * Add (or subtract) whole days from an ISO date, staying in calendar space.
 * @returns {string|null} 'YYYY-MM-DD'
 */
export function addDays(iso, days) {
  const base = utcNoon(toIsoDate(iso));
  if (base == null || !Number.isFinite(days)) return null;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

// ── Urgency bands ──────────────────────────────────────────────────────────
//
// Both a colour AND a label/icon are carried here, because urgency must never
// be communicated by colour alone (WCAG 1.4.1). The table view renders the
// label, the map renders colour + pattern + the same label in its legend.

export const URGENCY_BANDS = [
  {
    id: 'expired',
    label: 'Expired or inactive',
    shortLabel: 'Expired',
    icon: '■',
    color: '#7f1d1d',
    textColor: '#ffffff',
    description: 'The good-to-date has passed, or the title is not active.',
  },
  {
    id: 'critical',
    label: '0–7 days',
    shortLabel: '0–7 d',
    icon: '▲',
    color: '#dc2626',
    textColor: '#ffffff',
    description: 'Reaches its good-to-date within a week.',
  },
  {
    id: 'urgent',
    label: '8–30 days',
    shortLabel: '8–30 d',
    icon: '▲',
    color: '#ea580c',
    textColor: '#ffffff',
    description: 'Reaches its good-to-date within a month.',
  },
  {
    id: 'soon',
    label: '31–90 days',
    shortLabel: '31–90 d',
    icon: '●',
    color: '#d97706',
    textColor: '#ffffff',
    description: 'Reaches its good-to-date within three months.',
  },
  {
    id: 'watch',
    label: '91–180 days',
    shortLabel: '91–180 d',
    icon: '●',
    color: '#65a30d',
    textColor: '#ffffff',
    description: 'Reaches its good-to-date within six months.',
  },
  {
    id: 'ok',
    label: 'More than 180 days',
    shortLabel: '180+ d',
    icon: '○',
    color: '#16a34a',
    textColor: '#ffffff',
    description: 'No deadline inside the next six months.',
  },
  {
    id: 'unknown',
    label: 'Date unavailable — verify in MTO',
    shortLabel: 'No date',
    icon: '?',
    color: '#64748b',
    textColor: '#ffffff',
    description: 'The B.C. source did not publish a usable good-to-date for this title.',
  },
];

const BAND_BY_ID = new Map(URGENCY_BANDS.map((b) => [b.id, b]));

/**
 * Classify a tenure by urgency.
 *
 * `status` is consulted as well as the date: a title the registry no longer
 * reports as active belongs in the "expired or inactive" band even if its
 * printed good-to-date is still in the future, because the date is no longer
 * the thing that governs it.
 *
 * @param {number|null} days       from daysRemaining()
 * @param {string|null} [status]   government status string
 * @returns {object} an entry from URGENCY_BANDS
 */
export function urgencyBand(days, status = null) {
  if (status && !isActiveStatus(status)) return BAND_BY_ID.get('expired');
  if (days == null || !Number.isFinite(days)) return BAND_BY_ID.get('unknown');
  if (days < 0) return BAND_BY_ID.get('expired');
  if (days <= 7) return BAND_BY_ID.get('critical');
  if (days <= 30) return BAND_BY_ID.get('urgent');
  if (days <= 90) return BAND_BY_ID.get('soon');
  if (days <= 180) return BAND_BY_ID.get('watch');
  return BAND_BY_ID.get('ok');
}

/**
 * Whether a government status string means "this title is in good standing".
 *
 * Deliberately conservative and deny-by-default on unrecognised wording: an
 * unknown status is NOT treated as active, because presenting a lapsed title
 * as held is worse than showing an extra "verify in MTO" prompt.
 */
export function isActiveStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return false;
  return s === 'good' || s === 'active' || s.startsWith('good standing')
    || s.includes('good standing');
}

/** Human "in 30 days" / "3 days ago" / "today" for a days-remaining number. */
export function formatDaysRemaining(days) {
  if (days == null || !Number.isFinite(days)) return 'Date unavailable';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return '1 day ago';
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `${days} days`;
}

/**
 * Display a stored government date. Returns the ISO string unchanged — the
 * product shows B.C. dates in ISO everywhere on purpose, because a localized
 * "03/04/2027" is read as March 4th by half the audience and April 3rd by the
 * other half, and this is a deadline.
 */
export function formatGovernmentDate(iso) {
  const value = toIsoDate(iso);
  if (!value || isPlaceholderDate(value)) return 'Not published in the B.C. source';
  return value;
}

/**
 * The date an expiry alert for `offsetDays` before `goodToDate` should fire.
 * @returns {string|null} 'YYYY-MM-DD'
 */
export function alertDateFor(goodToDate, offsetDays) {
  return addDays(goodToDate, -Math.abs(Number(offsetDays) || 0));
}

/** Timestamp → "2026-08-01 14:32 PDT", for last-sync lines. */
export function formatSyncTimestamp(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return 'never';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BC_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZoneName: 'short',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${get('timeZoneName')}`;
}
