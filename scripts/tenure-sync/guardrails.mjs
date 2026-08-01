// The circuit breaker between a bad government response and a customer's
// portfolio.
//
// PURE. Given the statistics of a run and the baseline of the last good one,
// decide whether this data may replace what we already trust.
//
// WHY THIS IS THE MOST IMPORTANT FILE IN THE IMPORTER
//   A partial WFS response is indistinguishable, row by row, from a province
//   in which thousands of claims were dropped overnight. Without a run-level
//   check, one truncated page turns into "your 40 monitored claims are no
//   longer in the dataset" — forty false alarms about mineral rights, sent by
//   email, at 08:00, to people who will act on them. Every threshold below
//   exists because the failure it prevents is worse than a skipped sync.
//
// The default posture is therefore: when in doubt, ABORT and keep yesterday's
// data. A stale portfolio with an honest "last synced" timestamp is a working
// product. A portfolio corrupted by a bad import is not.

export const DEFAULTS = {
  /** Reject the run if it returned less than this share of the last good run. */
  minRecordRatio: 0.7,
  /** Reject if more than this share of received records failed normalization. */
  maxRejectRatio: 0.02,
  /** Reject if more than this share had unusable geometry. */
  maxGeometryFailRatio: 0.02,
  /** Any run returning fewer than this is not a credible province-wide pull. */
  minAbsoluteRecords: 1000,
};

export const VERDICT = { OK: 'ok', ABORT: 'abort' };

/**
 * Read thresholds from the environment so an operator can loosen them during a
 * known provincial data event without editing and redeploying code.
 */
export function thresholdsFromEnv(env = process.env) {
  const n = (key, fallback) => {
    const v = Number(env[key]);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    minRecordRatio: n('TENURE_SYNC_MIN_RECORD_RATIO', DEFAULTS.minRecordRatio),
    maxRejectRatio: n('TENURE_SYNC_MAX_REJECT_RATIO', DEFAULTS.maxRejectRatio),
    maxGeometryFailRatio: n('TENURE_SYNC_MAX_GEOMETRY_FAIL_RATIO', DEFAULTS.maxGeometryFailRatio),
    minAbsoluteRecords: n('TENURE_SYNC_MIN_ABSOLUTE_RECORDS', DEFAULTS.minAbsoluteRecords),
  };
}

/**
 * Evaluate a completed fetch.
 *
 * @param {object} stats
 * @param {number} stats.recordsReceived    features the source returned
 * @param {number} stats.recordsRejected    features normalization refused
 * @param {number} stats.geometryFailures   subset rejected for bad geometry
 * @param {boolean} stats.truncated         paging ended early / a page failed
 * @param {string} stats.schemaFingerprint  hash of the resolved field list
 * @param {string} [stats.mode]             'full' | 'targeted'
 * @param {object|null} baseline            last successful run, or null
 * @param {object} [thresholds]
 * @returns {{verdict: string, alertsSafe: boolean, reasons: string[], report: object}}
 */
export function evaluateRun(stats, baseline, thresholds = DEFAULTS) {
  const reasons = [];
  const received = num(stats.recordsReceived);
  const rejected = num(stats.recordsRejected);
  const geomFails = num(stats.geometryFailures);
  const isTargeted = stats.mode === 'targeted';

  const rejectRatio = received > 0 ? rejected / received : 0;
  const geometryFailRatio = received > 0 ? geomFails / received : 0;
  const baselineCount = baseline ? num(baseline.records_processed) : null;
  const recordRatio = baselineCount ? received / baselineCount : null;

  // 1. Nothing at all. Always fatal — there is no reading of an empty response
  //    that justifies replacing a province.
  if (received === 0) {
    reasons.push('The source returned zero records.');
  }

  // 2. Paging did not complete. Partial data looks exactly like mass deletion.
  if (stats.truncated) {
    reasons.push('Pagination did not complete — the result set is partial.');
  }

  // 3. Too small in absolute terms. Only meaningful for a full pull; a targeted
  //    refresh of 40 monitored tenures is supposed to be small.
  if (!isTargeted && received > 0 && received < thresholds.minAbsoluteRecords) {
    reasons.push(
      `Only ${received} records received; a province-wide pull should exceed `
      + `${thresholds.minAbsoluteRecords}.`,
    );
  }

  // 4. Sharp drop against the last good run. THE canonical "the endpoint is
  //    half-broken today" signal.
  if (!isTargeted && recordRatio != null && recordRatio < thresholds.minRecordRatio) {
    reasons.push(
      `Record count fell to ${(recordRatio * 100).toFixed(1)}% of the last successful run `
      + `(${received} vs ${baselineCount}); the floor is `
      + `${(thresholds.minRecordRatio * 100).toFixed(0)}%.`,
    );
  }

  // 5. Too many records we could not parse — usually a schema change that
  //    resolveFields did not catch because the field still exists but changed
  //    shape.
  if (rejectRatio > thresholds.maxRejectRatio) {
    reasons.push(
      `${(rejectRatio * 100).toFixed(1)}% of records were rejected; the ceiling is `
      + `${(thresholds.maxRejectRatio * 100).toFixed(0)}%.`,
    );
  }

  // 6. Geometry specifically. Called out separately from (5) because it points
  //    at a projection or SRS change rather than an attribute change, and the
  //    fix is different.
  if (geometryFailRatio > thresholds.maxGeometryFailRatio) {
    reasons.push(
      `${(geometryFailRatio * 100).toFixed(1)}% of records had unusable geometry; the ceiling is `
      + `${(thresholds.maxGeometryFailRatio * 100).toFixed(0)}%.`,
    );
  }

  // 7. The field list moved. Not fatal on its own — a NEW field appearing
  //    changes the fingerprint and breaks nothing — but the run is marked
  //    unsafe for change alerts and an administrator is told, because a
  //    fingerprint change is exactly how a silent schema migration announces
  //    itself.
  const fingerprintChanged = Boolean(
    baseline?.schema_fingerprint
    && stats.schemaFingerprint
    && baseline.schema_fingerprint !== stats.schemaFingerprint,
  );

  const verdict = reasons.length ? VERDICT.ABORT : VERDICT.OK;

  return {
    verdict,
    // alertsSafe gates CHANGE and NOT_OBSERVED notices only. Expiry reminders
    // are computed from data that already passed a clean import, so a later
    // bad run does not make yesterday's good-to-date wrong — and staying
    // silent about a real deadline is the worse failure.
    alertsSafe: verdict === VERDICT.OK && !stats.truncated && !fingerprintChanged,
    reasons,
    report: {
      records_received: received,
      records_rejected: rejected,
      geometry_failures: geomFails,
      reject_ratio: round4(rejectRatio),
      geometry_fail_ratio: round4(geometryFailRatio),
      baseline_records: baselineCount,
      record_ratio: recordRatio == null ? null : round4(recordRatio),
      truncated: Boolean(stats.truncated),
      schema_fingerprint: stats.schemaFingerprint || null,
      schema_fingerprint_changed: fingerprintChanged,
      thresholds,
    },
  };
}

/**
 * Reconciliation is only allowed to conclude anything about absent tenures
 * after a run that was clean AND complete AND province-wide. A targeted run
 * covers a handful of tenure numbers by design, so "not seen in this run"
 * carries no information at all.
 */
export function mayReconcile(evaluation, mode) {
  return evaluation.verdict === VERDICT.OK
    && evaluation.alertsSafe
    && mode === 'full';
}

/** Human summary for the import-run row, admin tools, and the alert email. */
export function summarize(evaluation) {
  if (evaluation.verdict === VERDICT.OK) {
    return evaluation.alertsSafe
      ? 'Run passed all guardrails.'
      : 'Run passed, but change alerts are withheld: '
        + (evaluation.report.schema_fingerprint_changed
          ? 'the source field list changed.'
          : 'the result set was incomplete.');
  }
  return `Run aborted without writing. ${evaluation.reasons.join(' ')}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function round4(n) {
  return Number.isFinite(n) ? Number(n.toFixed(4)) : null;
}
