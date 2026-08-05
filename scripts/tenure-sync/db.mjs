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
export async function interruptedRun(sb, { source }) {
  const { data, error } = await sb
    .from('tenure_import_runs')
    .select('id, started_at, mode, error_summary')
    .eq('status', 'failed')
    .eq('source', source)
    .not('promotion_started_at', 'is', null)
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

export async function stageRows(sb, runId, entries) {
  if (!entries.length) return;
  const rows = entries.map((e) => ({
    import_run_id: runId,
    source_record_id: e.tenure.source_record_id,
    payload: { tenure: e.tenure, owners: e.owners },
  }));
  for (const chunk of chunked(rows, BATCH_SIZE)) {
    const { error } = await sb.from('tenure_import_staging').insert(chunk);
    if (error) throw new Error(`Staging insert failed: ${error.message}`);
  }
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
export async function upsertTenures(sb, rows) {
  const ids = new Map();
  for (const chunk of chunked(rows, BATCH_SIZE)) {
    const { data, error } = await sb
      .from('tenures')
      .upsert(chunk, { onConflict: 'jurisdiction,source,source_record_id' })
      .select('id, source_record_id');
    if (error) throw new Error(`Tenure upsert failed: ${error.message}`);
    for (const row of data || []) ids.set(row.source_record_id, row.id);
  }
  return ids;
}

export async function upsertOwners(sb, rows) {
  if (!rows.length) return;
  for (const chunk of chunked(rows, BATCH_SIZE)) {
    const { error } = await sb
      .from('tenure_owners')
      .upsert(chunk, { onConflict: 'tenure_id,normalized_owner_name' });
    if (error) throw new Error(`Owner upsert failed: ${error.message}`);
  }
}

/**
 * Remove owner rows that this run did not re-observe for the given tenures.
 *
 * Scoped to tenures the run actually touched, and only ever run after the
 * guardrails passed — so a page that failed to arrive can never be read as
 * "this claim has no owners any more".
 */
export async function pruneOwners(sb, tenureIds, observedAt) {
  if (!tenureIds.length) return 0;
  let removed = 0;
  for (const chunk of chunked(tenureIds, 200)) {
    const { data, error } = await sb
      .from('tenure_owners')
      .delete()
      .in('tenure_id', chunk)
      .lt('last_observed_at', observedAt)
      .select('id');
    if (error) throw new Error(`Owner prune failed: ${error.message}`);
    removed += (data || []).length;
  }
  return removed;
}

// ── History ────────────────────────────────────────────────────────────────

export async function insertSnapshots(sb, rows) {
  if (!rows.length) return;
  for (const chunk of chunked(rows, BATCH_SIZE)) {
    const { error } = await sb.from('tenure_snapshots').insert(chunk);
    if (error) throw new Error(`Snapshot insert failed: ${error.message}`);
  }
}

export async function insertChangeEvents(sb, rows) {
  if (!rows.length) return;
  for (const chunk of chunked(rows, BATCH_SIZE)) {
    const { error } = await sb.from('tenure_change_events').insert(chunk);
    if (error) throw new Error(`Change-event insert failed: ${error.message}`);
  }
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
  const apiKey = credential('RESEND_API_KEY');
  const to = process.env.TENURE_ADMIN_EMAIL || 'coltongriffith@live.ca';
  const from = process.env.TENURE_ALERT_FROM
    || 'Exploration Maps <notifications@explorationmaps.com>';
  if (!apiKey) {
    console.warn('[tenure-sync] RESEND_API_KEY not set — administrator email skipped.');
    return false;
  }
  try {
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
