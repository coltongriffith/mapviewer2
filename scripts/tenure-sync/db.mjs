// Supabase access for the tenure importer.
//
// Service-role only — this module runs in GitHub Actions, never in a browser.
// The service role bypasses RLS, which is exactly why every function here is
// narrow and named after the one thing it does: there is no "run arbitrary
// SQL" helper to reach for.
//
// The single hard rule this file exists to keep: NOTHING DELETES A TENURE.
// Rows are upserted and counters are incremented; absence is recorded, never
// acted upon destructively. If the province has a bad night, the worst that
// happens to a customer's portfolio is that it stops getting fresher.

import { createClient } from '@supabase/supabase-js';
import { credential, supabaseCredentials } from '../lib/env.mjs';

/** Rows per write. Matches the batch size the Quebec loader settled on. */
export const BATCH_SIZE = Number(process.env.TENURE_SYNC_BATCH_SIZE) || 500;

/**
 * Smallest batch worth retrying. Below this, a timeout is a real problem —
 * a missing index or a lock — and splitting further only turns one clear
 * failure into forty slow ones.
 */
const MIN_CHUNK = 25;

/** How long a failed run stays eligible for an automatic resume. */
export const RESUME_MAX_AGE_HOURS = Number(process.env.TENURE_SYNC_RESUME_MAX_AGE_HOURS) || 24;

/**
 * Postgres cancels a statement that outruns `statement_timeout` with SQLSTATE
 * 57014. It reaches us as a PostgREST error whose message is the Postgres one.
 */
export function isStatementTimeout(error) {
  if (!error) return false;
  if (error.code === '57014') return true;
  return /statement timeout/i.test(String(error.message || ''));
}

/**
 * Write rows in batches, halving a batch that times out rather than failing.
 *
 * The importer runs as `service_role`, and PostgREST applies the settings of
 * the role it impersonates. `anon` and `authenticated` have explicit timeouts;
 * `service_role` never did, so it inherited the authenticator default of EIGHT
 * SECONDS — a ceiling meant for interactive browser requests, applied to a
 * 42,000-record provincial import. Three consecutive nightly failures came from
 * that and nothing else.
 *
 * supabase/migrations/20260807000003 raises it to 60s, which is the actual fix.
 * This is the belt to that braces: batch cost is not uniform (a page of claims
 * held by one owner writes far more owner rows than a page of sole-owner
 * claims), so a fixed batch size will always eventually meet a slow one. Halving
 * on 57014 and only on 57014 means a transient slow batch costs a retry instead
 * of a night, while a genuine error still surfaces immediately and unchanged.
 */
async function writeChunk(chunk, write, { label, log }, out) {
  const { data, error } = await write(chunk);
  if (!error) {
    if (out && data) out.push(...data);
    return;
  }
  if (!isStatementTimeout(error) || chunk.length <= MIN_CHUNK) {
    throw new Error(`${label} failed: ${error.message}`);
  }
  const half = Math.ceil(chunk.length / 2);
  log?.(`  [tenure-sync] ${label}: ${chunk.length} rows hit the statement timeout — `
    + `retrying as ${half}-row halves.`);
  for (const sub of chunked(chunk, half)) {
    await writeChunk(sub, write, { label, log }, out);
  }
}

/**
 * @param rows   the full set to write
 * @param write  (chunk) => PostgREST result — must NOT throw; return {data,error}
 * @returns      the concatenated `data` of every successful write
 */
export async function writeInChunks(rows, write, { label, size = BATCH_SIZE, log } = {}) {
  const out = [];
  for (const chunk of chunked(rows, size)) {
    await writeChunk(chunk, write, { label, log }, out);
  }
  return out;
}

export function createServiceClient() {
  // Trimmed and checked before use — a credential saved with a trailing
  // newline otherwise surfaces as "Headers.set: ... is an invalid header
  // value" from inside supabase-js, which names neither the variable nor the
  // problem. See scripts/lib/env.mjs.
  const { url, key } = supabaseCredentials();
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Import runs ────────────────────────────────────────────────────────────

export async function startRun(sb, { mode, source, jurisdiction = 'BC' }) {
  const { data, error } = await sb
    .from('tenure_import_runs')
    .insert({ mode, source, jurisdiction, status: 'running', alerts_safe: false })
    .select('id, started_at')
    .single();
  if (error) throw new Error(`Could not open an import run: ${error.message}`);
  return data;
}

export async function finishRun(sb, runId, patch) {
  const { error } = await sb
    .from('tenure_import_runs')
    .update({ ...patch, completed_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) throw new Error(`Could not close import run ${runId}: ${error.message}`);
}

/**
 * Mark the moment this run stops being a pure reader.
 *
 * Everything before this point writes only to tenure_import_staging, so a
 * failure genuinely leaves the trusted tables alone. After it, batches are
 * landing one round trip at a time and a crash can leave the promotion
 * half-done — which is a different situation and has to be reported as one.
 */
export async function markPromotionStarted(sb, runId) {
  const { error } = await sb
    .from('tenure_import_runs')
    .update({ promotion_started_at: new Date().toISOString() })
    .eq('id', runId);
  // Not fatal: failing to record the marker must not stop a promotion that is
  // otherwise fine. It only costs us the automatic resume.
  if (error) console.warn(`[tenure-sync] could not mark promotion start: ${error.message}`);
}

/**
 * A previous run that died part-way through promotion and still holds staging.
 *
 * Its rows were deliberately NOT cleared, because they are the input the resume
 * needs. Re-promoting them is a no-op for every batch that already landed.
 */
export async function interruptedRun(sb, { source, maxAgeHours = RESUME_MAX_AGE_HOURS }) {
  // Age-bounded on purpose. A resume re-promotes the whole province before the
  // run does any of its own work, so a promotion that cannot complete would
  // otherwise burn several minutes at the head of EVERY subsequent run, for
  // ever. Past the cut-off the staged pull is stale enough that tonight's fresh
  // one supersedes it anyway, and clearStaleStaging sweeps the rows on the next
  // success.
  const cutoff = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
  const { data, error } = await sb
    .from('tenure_import_runs')
    .select('id, started_at, mode, error_summary')
    .eq('status', 'failed')
    .eq('source', source)
    .not('promotion_started_at', 'is', null)
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not check for an interrupted run: ${error.message}`);
  if (!data) return null;

  // A failed run whose staging has since been cleared by hand is finished, not
  // interrupted. Confirm there is actually something left to promote.
  const { count, error: countErr } = await sb
    .from('tenure_import_staging')
    .select('id', { count: 'exact', head: true })
    .eq('import_run_id', data.id);
  if (countErr) throw new Error(`Could not size the retained staging: ${countErr.message}`);
  return count > 0 ? { ...data, staged: count } : null;
}

/** The baseline the guardrails compare against. */
export async function lastSuccessfulRun(sb, { source, mode = 'full' }) {
  const { data, error } = await sb
    .from('tenure_import_runs')
    .select('id, completed_at, records_processed, schema_fingerprint')
    .eq('status', 'succeeded')
    .eq('source', source)
    .eq('mode', mode)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the last successful run: ${error.message}`);
  return data || null;
}

// ── Staging ────────────────────────────────────────────────────────────────
//
// Every fetched page lands in staging first. Nothing in the trusted tables
// moves until the guardrails have seen the whole run — see the long note on
// tenure_import_staging in migration 20260801000001.

export async function stageRows(sb, runId, entries, { log } = {}) {
  if (!entries.length) return;
  const rows = entries.map((e) => ({
    import_run_id: runId,
    source_record_id: e.tenure.source_record_id,
    payload: { tenure: e.tenure, owners: e.owners },
  }));
  await writeInChunks(rows, (chunk) => sb.from('tenure_import_staging').insert(chunk),
    { label: 'Staging insert', log });
}

/**
 * Read staged rows back in id order, one batch at a time.
 *
 * Keyset pagination on the identity column rather than offset/limit: the
 * promotion pass reads a table it is not modifying, but offsets over hundreds
 * of thousands of rows get slower with every page and this loop should not.
 */
export async function* readStaged(sb, runId, batchSize = BATCH_SIZE) {
  let after = 0;
  for (;;) {
    const { data, error } = await sb
      .from('tenure_import_staging')
      .select('id, payload')
      .eq('import_run_id', runId)
      .gt('id', after)
      .order('id', { ascending: true })
      .limit(batchSize);
    if (error) throw new Error(`Could not read staged rows: ${error.message}`);
    if (!data || data.length === 0) return;
    yield data.map((r) => r.payload);
    after = data[data.length - 1].id;
    if (data.length < batchSize) return;
  }
}

/** Always called, on both the success and the abort path. */
export async function clearStaging(sb, runId) {
  const { error } = await sb.from('tenure_import_staging').delete().eq('import_run_id', runId);
  if (error) console.warn(`[tenure-sync] could not clear staging for run ${runId}: ${error.message}`);
}

/**
 * Drop staging rows left behind by runs that will never be resumed.
 *
 * A failed run KEEPS its staging on purpose, so the next run can finish the
 * promotion it started. But clearStaging only ever deletes the CURRENT run's
 * rows, so each failure left ~42,000 behind permanently — two consecutive
 * failures had grown the table to 84,641 rows, none of which any future run
 * would look at.
 *
 * Called only after a run SUCCEEDS. At that point the mirror is fully
 * promoted, so every earlier run's staging is definitionally dead: there is
 * nothing left for it to recover. Anything staged for a LATER run (a
 * concurrent job, however unlikely) is untouched.
 */
export async function clearStaleStaging(sb, runId, runStartedAt) {
  const { data: stale, error: findErr } = await sb
    .from('tenure_import_runs')
    .select('id')
    .lt('started_at', runStartedAt)
    .neq('id', runId);
  if (findErr) {
    console.warn(`[tenure-sync] could not look for stale staging: ${findErr.message}`);
    return 0;
  }
  const ids = (stale || []).map((r) => r.id);
  if (!ids.length) return 0;

  let removed = 0;
  // Chunked for the same reason loadOwnersFor is: these are UUIDs, and a
  // whole run history in one `.in()` builds a URL the edge refuses.
  for (const chunk of chunked(ids, 200)) {
    const { data, error } = await sb
      .from('tenure_import_staging')
      .delete()
      .in('import_run_id', chunk)
      .select('id');
    if (error) {
      console.warn(`[tenure-sync] could not clear stale staging: ${error.message}`);
      return removed;
    }
    removed += (data || []).length;
  }
  return removed;
}

// ── Tenures ────────────────────────────────────────────────────────────────

/**
 * Load the rows we already hold for a set of source ids.
 *
 * Deliberately does NOT select `geometry`: change detection compares
 * `geometry_hash`, so pulling the province's polygons back out of the database
 * every night would be megabytes of transfer to answer a question a 8-byte
 * string already answers.
 */
export async function loadExisting(sb, sourceRecordIds, { jurisdiction, source }) {
  const out = new Map();
  for (const chunk of chunked(sourceRecordIds, 500)) {
    const { data, error } = await sb
      .from('tenures')
      .select('id, source_record_id, tenure_number, tenure_name, tenure_type, tenure_subtype, '
        + 'status, issue_date, good_to_date, termination_date, area_hectares, geometry_hash, '
        + 'missing_run_count, source_updated_at')
      .eq('jurisdiction', jurisdiction)
      .eq('source', source)
      .in('source_record_id', chunk);
    if (error) throw new Error(`Could not read existing tenures: ${error.message}`);
    for (const row of data || []) out.set(row.source_record_id, row);
  }
  return out;
}

/**
 * Upsert a page of tenures.
 *
 * `first_observed_at` and `created_at` are absent from the payload on purpose:
 * omitted columns are neither inserted nor updated, so a new row takes the
 * column default and an existing row keeps the date we first saw it. That
 * column is how the product can later say "we have been watching this title
 * since March" — overwriting it every night would quietly destroy that.
 */
export async function upsertTenures(sb, rows, { log } = {}) {
  const written = await writeInChunks(rows, (chunk) => sb
    .from('tenures')
    .upsert(chunk, { onConflict: 'jurisdiction,source,source_record_id' })
    .select('id, source_record_id'), { label: 'Tenure upsert', log });
  const ids = new Map();
  for (const row of written) ids.set(row.source_record_id, row.id);
  return ids;
}

export async function upsertOwners(sb, rows, { log } = {}) {
  if (!rows.length) return;
  await writeInChunks(rows, (chunk) => sb
    .from('tenure_owners')
    .upsert(chunk, { onConflict: 'tenure_id,normalized_owner_name' }),
  { label: 'Owner upsert', log });
}

/**
 * Remove owner rows that this run did not re-observe for the given tenures.
 *
 * Scoped to tenures the run actually touched, and only ever run after the
 * guardrails passed — so a page that failed to arrive can never be read as
 * "this claim has no owners any more".
 */
export async function pruneOwners(sb, tenureIds, observedAt, { log } = {}) {
  if (!tenureIds.length) return 0;
  // Chunk of 200, not BATCH_SIZE: these are UUIDs in a query string. See the
  // note on loadOwnersFor in run.mjs.
  const removed = await writeInChunks(tenureIds, (chunk) => sb
    .from('tenure_owners')
    .delete()
    .in('tenure_id', chunk)
    .lt('last_observed_at', observedAt)
    .select('id'), { label: 'Owner prune', size: 200, log });
  return removed.length;
}

// ── History ────────────────────────────────────────────────────────────────

export async function insertSnapshots(sb, rows, { log } = {}) {
  if (!rows.length) return;
  await writeInChunks(rows, (chunk) => sb.from('tenure_snapshots').insert(chunk),
    { label: 'Snapshot insert', log });
}

export async function insertChangeEvents(sb, rows, { log } = {}) {
  if (!rows.length) return;
  await writeInChunks(rows, (chunk) => sb.from('tenure_change_events').insert(chunk),
    { label: 'Change-event insert', log });
}

export async function reconcile(sb, { runId, runStarted, jurisdiction, source }) {
  const { data, error } = await sb.rpc('tenure_reconcile_run', {
    p_run_id: runId,
    p_run_started: runStarted,
    p_jurisdiction: jurisdiction,
    p_source: source,
  });
  if (error) throw new Error(`Reconciliation failed: ${error.message}`);
  return data;
}

/** Tenure numbers currently in somebody's portfolio — the targeted-run scope. */
export async function monitoredTenureNumbers(sb) {
  const { data, error } = await sb
    .from('monitored_portfolio_tenures')
    .select('tenures!inner(tenure_number)')
    .is('removed_at', null)
    .eq('monitoring_enabled', true);
  if (error) throw new Error(`Could not read monitored tenures: ${error.message}`);
  const numbers = new Set();
  for (const row of data || []) {
    const n = row?.tenures?.tenure_number;
    if (n) numbers.add(String(n));
  }
  return [...numbers];
}

// ── Administrator notification ─────────────────────────────────────────────

/**
 * Tell the operator when a sync aborts.
 *
 * Best-effort by design: a Resend outage must not turn a failed import into a
 * failed *job*, because the job's exit code is what CI alerts on. The failure
 * is already durably recorded in tenure_import_runs and visible in Admin →
 * Tenure; this is the push half of that.
 */
export async function notifyAdmin(sb, { subject, body }) {
  // No personal address as the default: a fallback in source is a permanent
  // record in every clone. TENURE_ADMIN_EMAIL is the way to route these
  // somewhere specific; support@ is the address the site already publishes.
  const to = process.env.TENURE_ADMIN_EMAIL || 'support@explorationmaps.com';
  const from = process.env.TENURE_ALERT_FROM
    || 'Exploration Maps <notifications@explorationmaps.com>';
  try {
    // INSIDE the try, because credential() throws on a malformed key and this
    // function is documented best-effort. The abort path awaits it without a
    // catch straight after writing status='aborted', so a throw here landed in
    // the outer handler, rewrote the run as 'failed', and replaced the real
    // guardrail reason with an email-configuration error — hiding exactly the
    // message the operator needed.
    const apiKey = credential('RESEND_API_KEY');
    if (!apiKey) {
      console.warn('[tenure-sync] RESEND_API_KEY not set — administrator email skipped.');
      return false;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html: body }),
    });
    if (!res.ok) {
      console.warn(`[tenure-sync] administrator email rejected: ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[tenure-sync] administrator email failed: ${e?.message}`);
    return false;
  }
}

export function* chunked(items, size) {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
