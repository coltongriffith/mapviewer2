// Disk headroom guard shared by the two scheduled registry imports.
//
// WHAT HAPPENED
//   2026-10-20: GitHub delivered the Tuesday 11:00 UTC Quebec refresh and the
//   11:00 UTC B.C. full sync four and a half hours late, in the same second.
//   The Quebec job staged 253,107 titles (a second copy of qc_claims, as jsonb)
//   and began publishing a third copy while the B.C. job was rewriting every
//   tenure row. The database ran out of disk at 15:38, crash-looped, and took
//   sign-in down with it. Neither job had any idea the other existed, or how
//   much room was left.
//
// WHAT THIS DOES
//   Before an import writes, and again before its largest write, it asks the
//   database (public.import_headroom(), service_role only) how big it is, how
//   big the tables the import rewrites are, and whether the other import is
//   mid-run. It refuses — before writing, so nothing needs undoing — when:
//     * the database plus what this import is expected to add would pass the
//       ceiling (IMPORT_DB_SIZE_CEILING_MB, default 70% of an 8 GB disk), or
//     * the other bulk import is writing right now.
//   An import is a scheduled job: skipping a night costs a night. Filling the
//   disk costs the whole product.
//
// PURE apart from the injected snapshot reader, so the thresholds are tested
// directly (tests/import-headroom.test.js).

/** 70% of the 8 GB disk the Supabase Pro plan starts with. */
export const DEFAULT_CEILING_MB = Math.round(8192 * 0.7);

/**
 * How many copies of the tables an import rewrites it can add before it is
 * finished, by phase. Deliberately rounded up: dead tuples and WAL are not
 * counted separately, and the whole point is to stop early.
 *
 *   qc.preflight     staging (jsonb, ~1 copy of qc_claims) + the new copy that
 *                    publish_qc_import writes while the old one is still held
 *   qc.publish       just that new copy
 *   tenure.preflight staging (~half a copy) + one rewritten version of every
 *                    tenure and owner row, dead until autovacuum reclaims it
 *   tenure.promote   just the rewrite
 *
 * A targeted tenure run touches a few dozen rows and is treated as zero.
 */
export const GROWTH_FACTORS = {
  qc: { preflight: 2, publish: 1 },
  tenure: { preflight: 2, promote: 1 },
  // us.preflight/publish: same shape as Quebec (jsonb staging + the new copy).
  us: { preflight: 2, publish: 1 },
};

/**
 * How long the OTHER importer's in-progress marker counts as live, in minutes.
 * Each is a little over that workflow's timeout-minutes, so a marker orphaned
 * by a killed job (the 2026-10-20 B.C. run is still recorded as `running`)
 * stops blocking once that job cannot possibly still be alive.
 */
export const LIVE_WINDOW_MINUTES = { qc: 30, tenure: 75, us: 70 };

const LABEL = { qc: 'Quebec claims refresh', tenure: 'B.C. tenure full sync', us: 'U.S. claims mirror refresh' };

// Snapshot keys: the size an import rewrites, and its in-progress marker.
const BASE_KEY = { qc: 'qc_claims_bytes', tenure: 'tenure_bytes', us: 'us_claims_bytes' };
const STARTED_KEY = { qc: 'qc_import_started_at', tenure: 'tenure_full_run_started_at', us: 'us_import_started_at' };

export function ceilingBytesFromEnv(env = process.env) {
  const mb = Number(env.IMPORT_DB_SIZE_CEILING_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_CEILING_MB) * 1024 * 1024;
}

/** Bytes this import may still add, from the sizes in the snapshot. */
// `minBaseBytes`: the importer's own estimate of the table it writes, for a
// first load into an empty table (the U.S. mirror), which would otherwise size
// itself at zero and pass any ceiling.
export function expectedGrowthBytes(snapshot, { importer, phase, mode = 'full', minBaseBytes = 0 }) {
  if (importer === 'tenure' && mode !== 'full') return 0;
  const factor = GROWTH_FACTORS[importer]?.[phase] ?? 0;
  const measured = Number(snapshot?.[BASE_KEY[importer]]);
  const bytes = Math.max(Number.isFinite(measured) ? measured : 0, Number(minBaseBytes) || 0);
  return bytes > 0 ? factor * bytes : 0;
}

/**
 * Judge a public.import_headroom() snapshot.
 *
 * @param {object} snapshot
 * @param {object} opts
 * @param {'qc'|'tenure'} opts.importer  the import asking
 * @param {string} opts.phase            key into GROWTH_FACTORS
 * @param {string} [opts.mode]           tenure run mode
 * @param {number} [opts.ceilingBytes]
 * @returns {{ok: boolean, reasons: string[], report: object}}
 */
export function evaluateHeadroom(snapshot, {
  importer, phase, mode = 'full', ceilingBytes = ceilingBytesFromEnv(), minBaseBytes = 0,
}) {
  const reasons = [];
  const used = Number(snapshot?.database_bytes);
  const growth = expectedGrowthBytes(snapshot, { importer, phase, mode, minBaseBytes });

  if (!Number.isFinite(used) || used <= 0) {
    reasons.push('The database size could not be read, so there is no way to know the import fits.');
  } else if (used + growth > ceilingBytes) {
    reasons.push(
      `The database is ${mb(used)} MB and this import is expected to add up to ${mb(growth)} MB, `
      + `which would pass the ${mb(ceilingBytes)} MB ceiling (IMPORT_DB_SIZE_CEILING_MB).`,
    );
  }

  // Only a bulk import can collide with another one. A targeted tenure refresh
  // writes a few dozen rows, and the Quebec job ignores those too: the source
  // of tenure_full_run_started_at is full runs only.
  const bulk = importer !== 'tenure' || mode === 'full';
  const now = Date.parse(snapshot?.checked_at) || Date.now();
  let otherStarted = null;
  for (const other of Object.keys(STARTED_KEY)) {
    if (other === importer) continue;
    const started = snapshot?.[STARTED_KEY[other]];
    const startedMs = Date.parse(started);
    if (started && !otherStarted) otherStarted = started;
    if (bulk && Number.isFinite(startedMs)
      && now - startedMs < LIVE_WINDOW_MINUTES[other] * 60_000) {
      reasons.push(
        `The ${LABEL[other]} has been writing since ${started}. Two bulk imports at once `
        + 'is what filled the disk on 2026-10-20; this one will run on its next schedule.',
      );
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    report: {
      phase,
      database_bytes: Number.isFinite(used) ? used : null,
      expected_growth_bytes: growth,
      ceiling_bytes: ceilingBytes,
      other_import_started_at: otherStarted,
    },
  };
}

/**
 * Read a snapshot and judge it. Never throws: a guard that cannot read the
 * database refuses, because "could not check" must not mean "go ahead".
 *
 * @param {() => Promise<object>} readSnapshot  calls public.import_headroom()
 */
export async function checkImportHeadroom(readSnapshot, opts) {
  let snapshot;
  try {
    snapshot = await readSnapshot();
  } catch (e) {
    return {
      ok: false,
      reasons: [
        `Could not check database headroom: ${e?.message || e}. If import_headroom() is `
        + 'missing, apply supabase/migrations/20261020160000_import_disk_guard.sql.',
      ],
      report: { phase: opts?.phase, error: String(e?.message || e) },
    };
  }
  return evaluateHeadroom(snapshot, opts);
}

export function describeRefusal(evaluation) {
  return `Import refused to protect database disk. ${evaluation.reasons.join(' ')}`;
}

function mb(bytes) {
  return Math.round(bytes / (1024 * 1024));
}
