import { describe, it, expect, vi, beforeEach } from 'vitest';

// The B.C. tenure sync's share of the 2026-10-20 disk incident: it ran
// alongside the Quebec refresh with no idea how much room was left, and the
// run that died left ~42,000 staging rows (77 MB) behind. These pin the three
// things that now stop that: a headroom check before anything is written, a
// second one before promotion, and staging that is actually cleared — in
// batches, at the start of a run as well as after a success.

const MB = 1024 * 1024;

const db = vi.hoisted(() => ({
  finished: [],
  clearedStaging: [],
  swept: [],
  staged: 0,
  promotionMarked: false,
  headroom: [],
  interrupted: null,
  resumeError: null,
  emails: [],
}));

vi.mock('../scripts/tenure-sync/bcSource.mjs', () => ({
  SOURCE_ID: 'test-source',
  SOURCE_METADATA: { layer: 'test', attribution: 'test' },
  fetchSampleFeature: async () => ({
    properties: {
      TENURE_NUMBER_ID: 1, TAG_NUMBER: 'A', CLAIM_NAME: 'n', OWNER_NAME: 'o',
      AREA_IN_HECTARES: 1, GOOD_TO_DATE: '2027-01-01', ISSUE_DATE: '2020-01-01',
      TENURE_TYPE_DESCRIPTION: 't', TITLE_TYPE_DESCRIPTION: 'tt', MAP_UNIT_NO: 'm',
    },
    geometry: { type: 'Polygon', coordinates: [] },
  }),
  streamFeatures: async ({ onPage }) => {
    await onPage([]);
    return { received: 1000, truncated: false };
  },
  tenureNumberFilter: () => null,
}));

vi.mock('../scripts/tenure-sync/db.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createServiceClient: () => ({}),
    startRun: async () => ({ id: 'run-new', started_at: '2026-10-20T15:36:18Z' }),
    lastSuccessfulRun: async () => ({ records_processed: 1000, schema_fingerprint: null }),
    finishRun: async (_sb, runId, patch) => { db.finished.push({ runId, ...patch }); },
    markPromotionStarted: async () => { db.promotionMarked = true; },
    interruptedRun: async () => db.interrupted,
    clearStaging: async (_sb, runId) => { db.clearedStaging.push(runId); return 0; },
    clearStaleStaging: async (_sb, runId, _started, opts) => { db.swept.push({ runId, keep: opts?.keep || [] }); return 0; },
    stageRows: async () => { db.staged += 1; },
    readStaged: async function* readStaged(_sb, runId) {
      if (runId === 'run-prior' && db.resumeError) throw new Error(db.resumeError);
      yield* [];
    },
    reconcile: async () => ({ missing_total: 0, reobserved_total: 0 }),
    notifyAdmin: async (_sb, mail) => { db.emails.push(mail); },
    importHeadroom: async () => db.headroom.shift(),
    upsertTenures: async () => new Map(),
    upsertOwners: async () => {},
    pruneOwners: async () => 0,
    insertSnapshots: async () => {},
    insertChangeEvents: async () => {},
    loadExisting: async () => new Map(),
  };
});

const roomy = () => ({
  checked_at: new Date().toISOString(), database_bytes: 576 * MB, qc_claims_bytes: 202 * MB, tenure_bytes: 198 * MB,
});

describe('the tenure sync stops before it can fill the disk', () => {
  let main;

  beforeEach(async () => {
    Object.assign(db, {
      finished: [], clearedStaging: [], swept: [], staged: 0, promotionMarked: false,
      headroom: [], interrupted: null, resumeError: null, emails: [],
    });
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();
    ({ main } = await import('../scripts/tenure-sync/run.mjs'));
  });

  it('refuses before staging anything while the Quebec import is writing', async () => {
    db.headroom = [{ ...roomy(), qc_import_started_at: new Date(Date.now() - 2 * 60_000).toISOString() }];
    await main();

    const run = db.finished.find((f) => f.runId === 'run-new');
    expect(run.status).toBe('aborted');
    expect(run.error_summary).toMatch(/Quebec claims refresh has been writing/);
    expect(db.staged).toBe(0);
    expect(db.swept).toHaveLength(0);
    expect(db.emails[0].subject).toMatch(/disk/);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('refuses before promotion when the disk has filled since it started, and drops its staging', async () => {
    db.headroom = [roomy(), { ...roomy(), database_bytes: 5700 * MB }];
    await main();

    const run = db.finished.find((f) => f.runId === 'run-new');
    expect(run.status).toBe('aborted');
    expect(run.guardrail_report.headroom.phase).toBe('promote');
    expect(db.promotionMarked).toBe(false);
    expect(db.clearedStaging).toContain('run-new');
    process.exitCode = undefined;
  });

  it('sweeps earlier runs\' staging before staging its own, keeping only a resume worth retrying', async () => {
    db.headroom = [roomy(), roomy()];
    db.interrupted = { id: 'run-prior', started_at: '2026-10-20T11:00:00Z', staged: 42323, error_summary: 'x' };
    db.resumeError = 'canceling statement due to statement timeout';
    await main();

    expect(db.swept[0]).toEqual({ runId: 'run-new', keep: ['run-prior'] });
    // A success makes every earlier run's staging dead weight, the retained one included.
    expect(db.swept.at(-1)).toEqual({ runId: 'run-new', keep: [] });
    expect(db.finished.find((f) => f.runId === 'run-new').status).toBe('succeeded');
  });
});

// A just-enough PostgREST stand-in over an in-memory staging table, recording
// how many rows each DELETE statement removed.
function fakeStaging(rows) {
  const deletes = [];
  const client = {
    from: () => {
      const q = { filters: [], mode: 'select' };
      const b = {
        select: () => b,
        delete: () => { q.mode = 'delete'; return b; },
        eq: (c, v) => { q.filters.push((r) => r[c] === v); return b; },
        lte: (c, v) => { q.filters.push((r) => r[c] <= v); return b; },
        lt: (c, v) => { q.filters.push((r) => r[c] < v); return b; },
        not: (c, _op, list) => {
          const out = list.slice(1, -1).split(',');
          q.filters.push((r) => !out.includes(r[c]));
          return b;
        },
        order: () => b,
        range: (from, to) => { q.range = [from, to]; return b; },
        limit: (n) => { q.range = [0, n - 1]; return b; },
        then: (resolve) => {
          const hit = rows.filter((r) => q.filters.every((f) => f(r))).sort((a, c) => a.id - c.id);
          if (q.mode === 'delete') {
            for (const r of hit) rows.splice(rows.indexOf(r), 1);
            deletes.push(hit.length);
            return resolve({ count: hit.length, error: null });
          }
          const [from, to] = q.range || [0, hit.length];
          return resolve({ data: hit.slice(from, to + 1), error: null });
        },
      };
      return b;
    },
  };
  return { client, deletes, rows };
}

describe('staging is cleared in bounded batches', () => {
  let clearStaging;
  let clearStaleStaging;

  beforeEach(async () => {
    ({ clearStaging, clearStaleStaging } = await vi.importActual('../scripts/tenure-sync/db.mjs'));
  });

  const stage = (runId, n, startId, created = '2026-10-20T15:00:00Z') => Array.from(
    { length: n }, (_, i) => ({ id: startId + i, import_run_id: runId, created_at: created }),
  );

  it('removes a province of staging without one statement deleting all of it', async () => {
    const { client, deletes, rows } = fakeStaging([...stage('a', 12_345, 1), ...stage('b', 10, 20_000)]);
    expect(await clearStaging(client, 'a', { batchSize: 5000 })).toBe(12_345);
    expect(deletes).toEqual([5000, 5000, 2345]);
    expect(rows.every((r) => r.import_run_id === 'b')).toBe(true);
  });

  it('sweeps every leftover run except this one, the kept one, and anything staged later', async () => {
    const { client, rows } = fakeStaging([
      ...stage('orphan', 30, 1), ...stage('prior', 20, 100), ...stage('older', 5, 200),
      ...stage('current', 10, 300), ...stage('later', 3, 400, '2026-10-20T16:00:00Z'),
    ]);
    const removed = await clearStaleStaging(client, 'current', '2026-10-20T15:36:18Z', { keep: ['prior'] });
    expect(removed).toBe(35);
    expect([...new Set(rows.map((r) => r.import_run_id))].sort()).toEqual(['current', 'later', 'prior']);
  });
});
