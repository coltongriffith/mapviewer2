#!/usr/bin/env node
// B.C. mineral tenure importer — orchestration.
//
//   node scripts/tenure-sync/run.mjs --discover     print the live schema, write nothing
//   node scripts/tenure-sync/run.mjs                nightly full reconciliation
//   node scripts/tenure-sync/run.mjs --mode=targeted  refresh monitored tenures only
//   node scripts/tenure-sync/run.mjs --dry-run      fetch + evaluate, promote nothing
//
// Scheduled by .github/workflows/tenure-sync.yml. Reads SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY from the environment.
//
// THE SHAPE OF A RUN
//   1. resolve the layer's real field names, or stop                (schema gate)
//   2. stream every page into staging                               (flat memory)
//   3. judge the whole run against the last good one                (guardrails)
//   4. ABORT → clear staging, email the operator, touch nothing else
//      OK    → promote staging in batches: diff, upsert, snapshot, record events
//   5. reconcile absences, but only after a clean, complete, full run
//
// Step 4 is the entire point. Every other part of this file exists to make
// sure that when the province has a bad night, the answer is "we did not sync
// today" rather than "forty of your claims disappeared".
//
// WHAT "TOUCH NOTHING ELSE" ACTUALLY GUARANTEES
//   Up to and including step 3, this is a pure reader: the only writes go to
//   tenure_import_staging. Any failure there — a dropped connection, a renamed
//   field, a guardrail verdict — really does leave every trusted row alone.
//
//   Promotion is not atomic, and pretending otherwise would be the dangerous
//   kind of comment. PostgREST cannot hold one transaction across the many
//   round trips a province-sized promotion takes, so a crash at batch 7 of 40
//   leaves batches 1-6 committed. That case is handled rather than denied:
//   promotion_started_at marks the boundary, the staged rows are KEPT instead
//   of cleared, the administrator is told what actually happened, and the next
//   run finishes the promotion before staging anything of its own.
//
//   Re-applying a batch that already landed is a no-op, which is what makes
//   the resume safe: promoteStaging diffs the stored row against the staged
//   row, so an already-promoted batch compares equal and emits no change event
//   and no snapshot. See resumeInterruptedPromotion.

import {
  SOURCE_ID, SOURCE_METADATA, fetchSampleFeature, streamFeatures, tenureNumberFilter,
} from './bcSource.mjs';
import { resolveFields, describeResolution, SchemaError } from './resolveFields.mjs';
import { normalizeFeature, geometryHash } from './normalize.mjs';
import {
  detectChanges, shouldSnapshot, notObservedEvent, reappearedEvent,
} from './changeDetect.mjs';
import {
  evaluateRun, thresholdsFromEnv, mayReconcile, summarize, VERDICT,
} from './guardrails.mjs';
import {
  createServiceClient, startRun, finishRun, lastSuccessfulRun, loadExisting,
  upsertTenures, upsertOwners, pruneOwners, insertSnapshots, insertChangeEvents,
  reconcile, monitoredTenureNumbers, notifyAdmin, stageRows, readStaged, clearStaging,
  markPromotionStarted, interruptedRun,
  BATCH_SIZE, chunked,
} from './db.mjs';

const JURISDICTION = 'BC';

function parseArgs(argv) {
  const args = new Set(argv);
  const modeArg = argv.find((a) => a.startsWith('--mode='));
  return {
    discover: args.has('--discover'),
    dryRun: args.has('--dry-run'),
    mode: modeArg ? modeArg.split('=')[1] : 'full',
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = (...a) => console.log(...a);

  log(`[tenure-sync] source: ${SOURCE_METADATA.layer}`);
  log(`[tenure-sync] ${SOURCE_METADATA.attribution}`);

  // ── 1. Schema gate ───────────────────────────────────────────────────────
  // Deliberately before any database work: if the layer has changed shape, the
  // right outcome is a loud failure with the real field list in the log, not a
  // half-written import.
  const sample = await fetchSampleFeature({ log });
  let resolution;
  try {
    resolution = resolveFields(sample.properties);
  } catch (e) {
    if (e instanceof SchemaError && !opts.discover) {
      await reportSchemaFailure(e, opts);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  if (opts.discover) {
    log('');
    log(describeResolution(resolution, sample.properties));
    log('');
    log('Sample geometry type: ' + (sample.geometry?.type || '(none)'));
    log('Paste the block above into docs/tenure-monitor.md § Verified field list.');
    return;
  }

  const sb = createServiceClient();
  const thresholds = thresholdsFromEnv();
  const baseline = await lastSuccessfulRun(sb, { source: SOURCE_ID, mode: opts.mode });
  const run = await startRun(sb, { mode: opts.mode, source: SOURCE_ID, jurisdiction: JURISDICTION });
  const runStarted = run.started_at || new Date().toISOString();
  log(`[tenure-sync] run ${run.id} (${opts.mode}) started at ${runStarted}`);

  const stats = {
    recordsReceived: 0,
    recordsRejected: 0,
    geometryFailures: 0,
    truncated: false,
    schemaFingerprint: resolution.fingerprint,
    mode: opts.mode,
  };
  const rejectSamples = [];
  let promotionStarted = false;

  try {
    // ── 1b. Finish anything a previous run left half-written ───────────────
    // Before this run stages a single row, an earlier interrupted promotion is
    // completed, so the diff below is taken against a settled dataset rather
    // than one that is part old and part new.
    await resumeInterruptedPromotion(sb, { log });

    // ── 2. Stream into staging ─────────────────────────────────────────────
    let cqlFilter = null;
    if (opts.mode === 'targeted') {
      const numbers = await monitoredTenureNumbers(sb);
      if (!numbers.length) {
        log('[tenure-sync] no monitored tenures — nothing to refresh.');
        await finishRun(sb, run.id, {
          status: 'succeeded', alerts_safe: true, records_received: 0, records_processed: 0,
          schema_fingerprint: resolution.fingerprint, resolved_fields: resolution.fields,
          error_summary: 'No monitored tenures; targeted run had nothing to do.',
        });
        return;
      }
      cqlFilter = tenureNumberFilter(resolution.fields.tenureNumber, numbers);
      log(`[tenure-sync] targeted run over ${numbers.length} monitored tenure numbers`);
    }

    const observedAt = new Date().toISOString();
    const streamResult = await streamFeatures({
      sortField: resolution.fields.sourceRecordId,
      cqlFilter,
      log,
      onPage: async (features) => {
        const ok = [];
        for (const f of features) {
          const result = normalizeFeature(f, resolution.fields, {
            observedAt, jurisdiction: JURISDICTION, source: SOURCE_ID,
          });
          if (result.ok) {
            ok.push(result);
          } else {
            stats.recordsRejected += 1;
            if (result.reason.includes('geometry')) stats.geometryFailures += 1;
            if (rejectSamples.length < 20) {
              rejectSamples.push({ id: result.sourceRecordId, reason: result.reason });
            }
          }
        }
        if (ok.length) await stageRows(sb, run.id, ok);
      },
    });
    stats.recordsReceived = streamResult.received + stats.recordsRejected;
    stats.truncated = streamResult.truncated;

    // ── 3. Judge ───────────────────────────────────────────────────────────
    const evaluation = evaluateRun(stats, baseline, thresholds);
    log(`[tenure-sync] guardrails: ${summarize(evaluation)}`);

    if (evaluation.verdict === VERDICT.ABORT || opts.dryRun) {
      // ── 4a. Abort path. Staging goes; nothing trusted is touched. ────────
      await clearStaging(sb, run.id);
      const aborted = evaluation.verdict === VERDICT.ABORT;
      await finishRun(sb, run.id, {
        status: aborted ? 'aborted' : 'succeeded',
        alerts_safe: false,
        records_received: stats.recordsReceived,
        records_processed: 0,
        records_rejected: stats.recordsRejected,
        schema_fingerprint: resolution.fingerprint,
        resolved_fields: resolution.fields,
        guardrail_report: { ...evaluation.report, reject_samples: rejectSamples },
        error_summary: opts.dryRun && !aborted
          ? 'Dry run — evaluated but promoted nothing.'
          : summarize(evaluation),
      });
      if (aborted) {
        await notifyAdmin(sb, {
          subject: 'Tenure Monitor: B.C. sync aborted — stored data left untouched',
          body: abortEmail(run.id, evaluation, stats, rejectSamples),
        });
        process.exitCode = 1;
      }
      log(aborted
        ? '[tenure-sync] ABORTED. Existing tenure records are unchanged.'
        : '[tenure-sync] dry run complete; nothing promoted.');
      return;
    }

    // ── 4b. Promote ────────────────────────────────────────────────────────
    // Past this line the run is no longer a pure reader, so a failure can no
    // longer claim stored records are untouched. The marker is what lets the
    // catch block below tell the two cases apart.
    promotionStarted = true;
    await markPromotionStarted(sb, run.id);
    const promoted = await promoteStaging(sb, run.id, {
      observedAt, log, alertsSafe: evaluation.alertsSafe,
    });

    // ── 5. Reconcile ───────────────────────────────────────────────────────
    let reconciliation = null;
    if (mayReconcile(evaluation, opts.mode)) {
      reconciliation = await reconcile(sb, {
        runId: run.id, runStarted, jurisdiction: JURISDICTION, source: SOURCE_ID,
      });
      const extra = await recordAbsenceEvents(sb, run.id, reconciliation);
      promoted.changeEvents += extra;
      log(`[tenure-sync] reconciliation: ${reconciliation.missing_total} not seen, `
        + `${reconciliation.reobserved_total} back after an absence`);
    } else {
      log('[tenure-sync] reconciliation skipped — not a clean, complete, full run.');
    }

    await clearStaging(sb, run.id);
    await finishRun(sb, run.id, {
      status: 'succeeded',
      alerts_safe: evaluation.alertsSafe,
      records_received: stats.recordsReceived,
      records_processed: promoted.processed,
      records_rejected: stats.recordsRejected,
      records_created: promoted.created,
      records_updated: promoted.updated,
      material_changes_detected: promoted.changeEvents,
      schema_fingerprint: resolution.fingerprint,
      resolved_fields: resolution.fields,
      guardrail_report: {
        ...evaluation.report,
        reject_samples: rejectSamples,
        reconciliation,
      },
      error_summary: evaluation.alertsSafe ? null : summarize(evaluation),
    });

    log(`[tenure-sync] done: ${promoted.processed} processed, ${promoted.created} new, `
      + `${promoted.updated} updated, ${promoted.changeEvents} change events, `
      + `${stats.recordsRejected} rejected.`);

    if (!evaluation.alertsSafe) {
      await notifyAdmin(sb, {
        subject: 'Tenure Monitor: B.C. sync completed with change alerts withheld',
        body: `<p>${escapeHtml(summarize(evaluation))}</p>`
          + `<p>Run <code>${run.id}</code>. Expiry reminders are unaffected; change and `
          + 'not-observed notices are held until the next clean run.</p>',
      });
    }
  } catch (e) {
    const detail = String(e?.message || e);

    // Two different failures, and they must not be reported as one.
    //
    // Before promotion the only writes went to staging, so "stored records are
    // unchanged" is simply true and staging is dropped. During promotion it is
    // not true — batches already committed — and clearing staging would throw
    // away the one input a resume needs. So the rows stay, and the next run
    // finishes the job before starting its own.
    if (promotionStarted) {
      await finishRun(sb, run.id, {
        status: 'failed',
        alerts_safe: false,
        records_received: stats.recordsReceived,
        records_rejected: stats.recordsRejected,
        schema_fingerprint: resolution?.fingerprint || null,
        error_summary: `Interrupted during promotion — some records were updated before the `
          + `failure. Staging retained for the next run to finish. ${detail}`.slice(0, 2000),
      }).catch(() => {});
      await notifyAdmin(sb, {
        subject: 'Tenure Monitor: B.C. sync interrupted part-way through writing',
        body: `<p>Run <code>${run.id}</code> failed <strong>after</strong> it had begun promoting `
          + 'records, so some tenures were updated and some were not.</p>'
          + `<pre>${escapeHtml(detail)}</pre>`
          + '<p>Its staged rows have been kept on purpose. The next sync finishes this '
          + 'promotion before starting its own, and re-applying a batch that already landed '
          + 'produces no duplicate change events. No reminder is sent off a run in this state.</p>'
          + '<p>Nothing was deleted. If you would rather discard it, clear '
          + '<code>tenure_import_staging</code> for this run id and the next sync will '
          + 'simply re-read the province.</p>',
      }).catch(() => {});
    } else {
      await clearStaging(sb, run.id).catch(() => {});
      await finishRun(sb, run.id, {
        status: 'failed',
        alerts_safe: false,
        records_received: stats.recordsReceived,
        records_rejected: stats.recordsRejected,
        schema_fingerprint: resolution?.fingerprint || null,
        error_summary: detail.slice(0, 2000),
      }).catch(() => {});
      await notifyAdmin(sb, {
        subject: 'Tenure Monitor: B.C. sync failed',
        body: `<p>Run <code>${run.id}</code> failed before it wrote anything.</p>`
          + `<pre>${escapeHtml(detail)}</pre>`
          + '<p>Stored tenure records are unchanged.</p>',
      }).catch(() => {});
    }
    throw e;
  }
}

/**
 * Complete a promotion an earlier run died in the middle of.
 *
 * Safe to re-run over rows that already landed, and that is the whole reason
 * this works: promoteStaging diffs the STORED row against the STAGED row, so a
 * batch that already promoted compares equal — no change event, no snapshot,
 * and the tenure upsert is keyed on (jurisdiction, source, source_record_id)
 * so it rewrites the same values. Only the batches that never made it do
 * anything.
 *
 * Deliberately does not reconcile. Reconciliation concludes things about
 * titles that were ABSENT from a dataset, and the retained staging is a
 * dataset we already know is incompletely applied. The next full run draws
 * that conclusion, from a complete pull.
 */
async function resumeInterruptedPromotion(sb, { log }) {
  let prior;
  try {
    prior = await interruptedRun(sb, { source: SOURCE_ID });
  } catch (e) {
    // Never let recovery bookkeeping stop tonight's sync from running.
    log(`[tenure-sync] could not check for an interrupted run: ${e.message}`);
    return;
  }
  if (!prior) return;

  log(`[tenure-sync] resuming interrupted run ${prior.id} — ${prior.staged} staged rows retained.`);
  const promoted = await promoteStaging(sb, prior.id, {
    observedAt: new Date().toISOString(), log, alertsSafe: false,
  });
  await clearStaging(sb, prior.id);
  await finishRun(sb, prior.id, {
    error_summary: `${prior.error_summary || 'Interrupted during promotion.'} `
      + `Resumed and completed: ${promoted.processed} records applied, `
      + `${promoted.changeEvents} change events.`.slice(0, 2000),
  }).catch(() => {});
  log(`[tenure-sync] resume complete: ${promoted.processed} applied, `
    + `${promoted.changeEvents} change events.`);
}

/**
 * Read staging back, diff each batch against what we hold, and write.
 *
 * Batch-at-a-time so memory is bounded by BATCH_SIZE regardless of how large
 * the province is.
 */
async function promoteStaging(sb, runId, { observedAt, log, alertsSafe }) {
  let processed = 0;
  let created = 0;
  let updated = 0;
  let changeEvents = 0;

  for await (const batch of readStaged(sb, runId, BATCH_SIZE)) {
    const sourceIds = batch.map((b) => b.tenure.source_record_id);
    const existing = await loadExisting(sb, sourceIds, {
      jurisdiction: JURISDICTION, source: SOURCE_ID,
    });

    const tenureRows = [];
    const diffs = [];

    for (const { tenure, owners } of batch) {
      const prev = existing.get(tenure.source_record_id) || null;
      const row = {
        ...tenure,
        geometry_hash: geometryHash(tenure.geometry),
        last_import_run_id: runId,
        missing_run_count: 0,
        updated_at: observedAt,
      };
      tenureRows.push(row);
      diffs.push({ prev, row, owners });
      if (prev) updated += 1; else created += 1;
    }

    // Owners we held BEFORE this batch is promoted. Loaded once per batch, in
    // one query, and loaded BEFORE the owner upsert below — otherwise the
    // "previous" set would already be the new one and no transfer could ever be
    // detected. A title changing hands with no other attribute change is a
    // realistic and important case (it is one of the headline reasons to
    // monitor at all), so this cannot be conditional on some other field
    // having moved first.
    const existingIds = diffs.map((d) => d.prev?.id).filter(Boolean);
    const previousOwnersByTenure = await loadOwnersFor(sb, existingIds);

    const idBySourceId = await upsertTenures(sb, tenureRows);

    const ownerRows = [];
    const touchedTenureIds = [];
    const snapshots = [];
    const events = [];

    for (const { prev, row, owners } of diffs) {
      const tenureId = idBySourceId.get(row.source_record_id) || prev?.id;
      if (!tenureId) continue;
      touchedTenureIds.push(tenureId);

      for (const o of owners) ownerRows.push({ ...o, tenure_id: tenureId });

      if (!prev) continue;

      const all = detectChanges(prev, row, {
        previousOwners: previousOwnersByTenure.get(prev.id) || [],
        currentOwners: owners,
      });
      if (!all.length) continue;

      for (const e of all) {
        events.push({
          tenure_id: tenureId,
          event_type: e.event_type,
          previous_value: e.previous_value == null ? null : String(e.previous_value).slice(0, 500),
          current_value: e.current_value == null ? null : String(e.current_value).slice(0, 500),
          severity: e.severity,
          metadata: e.metadata || null,
          import_run_id: runId,
        });
      }

      if (shouldSnapshot(all)) {
        // The snapshot records what we believed BEFORE this run, so the history
        // reads as a sequence of states rather than a sequence of diffs.
        snapshots.push({
          tenure_id: tenureId,
          snapshot_data: prev,
          geometry: null,   // geometry history lives in the hash + the change event
          source_updated_at: prev.source_updated_at || null,
          observed_at: observedAt,
          import_run_id: runId,
        });
      }
    }

    await upsertOwners(sb, ownerRows);
    await insertSnapshots(sb, snapshots);
    await insertChangeEvents(sb, events);
    // Only prune owners on a run we trust; on an unsafe run an owner missing
    // from the response is far more likely to be a truncated field than a
    // transfer of title.
    if (alertsSafe) await pruneOwners(sb, touchedTenureIds, observedAt);

    processed += batch.length;
    changeEvents += events.length;
    log(`  [tenure-sync] promoted ${processed} (${events.length} events this batch)`);
  }

  return { processed, created, updated, changeEvents };
}

/**
 * Owner rows for a batch of tenure ids, grouped by tenure.
 *
 * CHUNKED, and the chunk size is not cosmetic. PostgREST puts `.in()` values
 * in the query string, and these are UUIDs: 36 characters plus a separator
 * each. A full BATCH_SIZE of 500 builds an ~18 KB URL, which the edge rejects
 * before the request is served — surfacing as `TypeError: fetch failed`
 * rather than as a PostgREST error, because nothing ever reached PostgREST.
 *
 * This took down the 2026-08-06 full sync at `records_processed = 0`, and it
 * would have taken down every full sync after it. It hid until then for a
 * reason worth remembering: `existingIds` holds only tenures that were ALREADY
 * in the mirror, so on the very first full run — when every record was new —
 * the list was empty, this function returned before issuing a request, and the
 * import passed. The bug arrived the moment the run stopped being the first
 * one.
 *
 * 200 matches pruneOwners, which chunks the same kind of id list. Every other
 * bulk id query in db.mjs was already chunked; this one was the exception, and
 * it was the exception because it lives here rather than beside them.
 */
const OWNER_LOOKUP_CHUNK = 200;

async function loadOwnersFor(sb, tenureIds) {
  const byTenure = new Map();
  if (!tenureIds.length) return byTenure;
  for (const chunk of chunked(tenureIds, OWNER_LOOKUP_CHUNK)) {
    const { data, error } = await sb
      .from('tenure_owners')
      .select('tenure_id, normalized_owner_name, owner_name, ownership_percentage')
      .in('tenure_id', chunk);
    if (error) throw new Error(`Could not read existing owners: ${error.message}`);
    for (const row of data || []) {
      if (!byTenure.has(row.tenure_id)) byTenure.set(row.tenure_id, []);
      byTenure.get(row.tenure_id).push(row);
    }
  }
  return byTenure;
}

/**
 * Turn reconciliation output into change events.
 *
 * Fires exactly at the two-miss threshold, so each tenure produces one notice
 * rather than one every night for the rest of its life.
 */
async function recordAbsenceEvents(sb, runId, reconciliation) {
  const events = [];
  for (const t of reconciliation?.newly_missing || []) {
    const e = notObservedEvent(t.misses);
    events.push({
      tenure_id: t.id,
      event_type: e.event_type,
      previous_value: e.previous_value,
      current_value: e.current_value,
      severity: e.severity,
      metadata: e.metadata,
      import_run_id: runId,
    });
  }
  for (const t of reconciliation?.reappeared || []) {
    const e = reappearedEvent(t.previous_misses);
    events.push({
      tenure_id: t.id,
      event_type: e.event_type,
      previous_value: e.previous_value,
      current_value: e.current_value,
      severity: e.severity,
      metadata: e.metadata,
      import_run_id: runId,
    });
  }
  await insertChangeEvents(sb, events);
  return events.length;
}

async function reportSchemaFailure(e, opts) {
  console.error(`\n[tenure-sync] SCHEMA FAILURE\n${e.message}\n`);
  try {
    const sb = createServiceClient();
    const run = await startRun(sb, { mode: opts.mode, source: SOURCE_ID, jurisdiction: JURISDICTION });
    await finishRun(sb, run.id, {
      status: 'aborted',
      alerts_safe: false,
      error_summary: e.message.slice(0, 2000),
      guardrail_report: { missing_required_fields: e.missing },
    });
    await notifyAdmin(sb, {
      subject: 'Tenure Monitor: B.C. layer schema changed — sync stopped',
      body: `<p>The importer stopped before writing anything.</p><pre>${escapeHtml(e.message)}</pre>`
        + '<p>Run <code>node scripts/tenure-sync/run.mjs --discover</code> to see the current '
        + 'field list, then update FIELD_CANDIDATES in scripts/tenure-sync/resolveFields.mjs.</p>',
    });
  } catch (inner) {
    console.error(`[tenure-sync] could not record the schema failure: ${inner?.message}`);
  }
}

function abortEmail(runId, evaluation, stats, rejectSamples) {
  const rows = evaluation.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  const samples = rejectSamples.slice(0, 10)
    .map((s) => `<li><code>${escapeHtml(String(s.id))}</code> — ${escapeHtml(s.reason)}</li>`)
    .join('');
  return `
    <p>The B.C. tenure sync was stopped before it could replace any stored records.
    Existing tenure data, portfolios and alerts are unchanged.</p>
    <p><strong>Why:</strong></p><ul>${rows}</ul>
    <p><strong>Run:</strong> <code>${escapeHtml(runId)}</code><br/>
    Received ${stats.recordsReceived}, rejected ${stats.recordsRejected},
    geometry failures ${stats.geometryFailures}${stats.truncated ? ', pagination incomplete' : ''}.</p>
    ${samples ? `<p><strong>Sample rejected records:</strong></p><ul>${samples}</ul>` : ''}
    <p>Expiry reminders continue from the last good dataset and will state its
    timestamp honestly. Change and not-observed notices are withheld until a
    clean run.</p>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

main().catch((err) => {
  console.error(`\n[tenure-sync] failed: ${err?.message || err}`);
  process.exit(1);
});
