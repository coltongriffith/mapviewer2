// When the GOVERNMENT server is down, the run is skipped, not failed.
//
// WHY
//   Both registry imports pull from a provincial server that has bad nights:
//   DataBC answered nothing on 2026-10-14 ("fetch failed", five attempts) and
//   the Quebec GESTIM host refused connections on 2026-10-13. Each turned the
//   job red and emailed the owner about something nobody here can fix, and
//   that the next scheduled run fixes by itself. Alerts that cry wolf every
//   week are alerts that stop being read.
//
// THE RULE
//   A source that cannot be reached before the import has written anything is
//   a warning — a `::warning::` annotation and a step-summary line — and the
//   job exits 0. UNLESS the data we already hold is getting old: past the
//   threshold below, an unreachable source is exactly what the owner needs to
//   hear about, and the job fails as before, saying how old the data is.
//   Everything else — a 4xx (we asked the wrong question), bad data, a
//   guardrail or disk-guard abort, a database error — still fails the job.

import { appendFileSync } from 'node:fs';

/** Thrown only once retries are exhausted on a network fault, timeout, 429 or 5xx. */
export class SourceUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'SourceUnavailableError';
  }
}

/** By name, not instanceof, so a second copy of this module still recognises it. */
export function isSourceUnavailable(e) {
  return e?.name === 'SourceUnavailableError';
}

/** Past this age, an outage fails the job. Nightly full sync, so three missed nights. */
export const TENURE_MAX_STALE_DAYS = 3;
/** Weekly refresh, so three missed weeks. */
export const QC_MAX_STALE_DAYS = 21;

export function maxStaleDays(envKey, fallback, env = process.env) {
  const v = Number(env[envKey]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * @param {object} opts
 * @param {string|Date|null} opts.lastSuccessAt  when the data we hold was last refreshed
 * @param {number} opts.maxStaleDays
 * @param {number} [opts.now]
 * @returns {{stale: boolean, ageDays: number|null}}
 */
export function judgeOutage({ lastSuccessAt, maxStaleDays: limit, now = Date.now() }) {
  const at = lastSuccessAt ? new Date(lastSuccessAt).getTime() : NaN;
  // No successful run on record is as stale as it gets.
  if (!Number.isFinite(at)) return { stale: true, ageDays: null };
  const ageDays = (now - at) / 86_400_000;
  return { stale: ageDays > limit, ageDays };
}

/** One line for the log, the run record, and the email. */
export function describeOutage(source, error, { stale, ageDays }, limit) {
  const age = ageDays == null
    ? 'there is no successful load on record'
    : `the data we hold is ${ageDays.toFixed(1)} days old`;
  const cause = String(error?.message || error).slice(0, 200);
  return stale
    ? `${source} could not be reached (${cause}) and ${age}, past the ${limit}-day limit.`
    : `${source} could not be reached (${cause}); ${age} (limit ${limit} days), so this run is `
      + 'skipped and the next scheduled run will retry.';
}

/**
 * Surface a skipped run in GitHub Actions without failing the job: an
 * annotation on the run page and a line in the step summary.
 */
export function announceSkippedRun(title, summary, { env = process.env, log = console.log } = {}) {
  log(`::warning title=${title}::${summary.replace(/\r?\n/g, ' ')}`);
  if (!env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `\n**${title}.** ${summary}\n`);
  } catch {
    // The summary is a convenience; the annotation above already carries it.
  }
}
