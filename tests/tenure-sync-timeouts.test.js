import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { writeInChunks, isStatementTimeout } from '../scripts/tenure-sync/db.mjs';

// The B.C. sync failed three nights running, and all three failures were the
// same shape: a batch statement issued through PostgREST as `service_role`,
// which inherits the authenticator default of an EIGHT SECOND statement
// timeout because nobody ever set one for it.
//
//   2026-08-06  Could not read existing owners (18 KB URL — covered separately)
//   2026-08-07  Reconciliation failed: canceling statement due to statement timeout
//   2026-08-07  Owner upsert failed: canceling statement due to statement timeout
//
// The ceiling is raised in migration 20260807000003. These tests cover the two
// code-side consequences: a batch that runs long should cost a retry rather
// than a night, and a failure AFTER promotion completes must not be reported as
// a promotion that was interrupted part-way.

describe('isStatementTimeout', () => {
  it('recognises the cancellation by SQLSTATE and by message', () => {
    expect(isStatementTimeout({ code: '57014' })).toBe(true);
    expect(isStatementTimeout({
      message: 'canceling statement due to statement timeout',
    })).toBe(true);
  });

  it('does not claim unrelated failures are timeouts', () => {
    // This matters more than the positive case. Halving and retrying a batch
    // that failed for a real reason — a constraint violation, a bad column —
    // turns one clear error into a slow cascade of identical ones.
    expect(isStatementTimeout({ message: 'duplicate key value violates unique constraint' })).toBe(false);
    expect(isStatementTimeout({ message: 'column "foo" does not exist' })).toBe(false);
    expect(isStatementTimeout({ message: 'TypeError: fetch failed' })).toBe(false);
    expect(isStatementTimeout(null)).toBe(false);
  });
});

describe('writeInChunks', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ i }));

  it('writes everything exactly once when nothing times out', async () => {
    const seen = [];
    await writeInChunks(rows(1200), (chunk) => {
      seen.push(chunk.length);
      return { data: chunk, error: null };
    }, { label: 'test', size: 500 });
    expect(seen).toEqual([500, 500, 200]);
  });

  it('returns the concatenated data, so upsertTenures can map ids back', async () => {
    const out = await writeInChunks(rows(7), (chunk) => ({
      data: chunk.map((r) => ({ id: `id-${r.i}` })), error: null,
    }), { label: 'test', size: 3 });
    expect(out.map((r) => r.id)).toEqual([
      'id-0', 'id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6',
    ]);
  });

  it('halves a timed-out batch and still writes every row exactly once', async () => {
    // The 2026-08-07 16:42 failure: 42,695 of 42,704 owner rows had landed when
    // one 500-row batch ran long. Retrying it smaller is the difference between
    // a slower run and no run.
    const written = [];
    let firstBatch = true;
    await writeInChunks(rows(500), (chunk) => {
      if (firstBatch && chunk.length === 500) {
        firstBatch = false;
        return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
      }
      written.push(...chunk.map((r) => r.i));
      return { data: chunk, error: null };
    }, { label: 'Owner upsert', size: 500 });

    expect(written.sort((a, b) => a - b)).toEqual(rows(500).map((r) => r.i));
  });

  it('keeps halving when the halves are still too slow', async () => {
    const sizes = [];
    await writeInChunks(rows(400), (chunk) => {
      sizes.push(chunk.length);
      if (chunk.length > 100) {
        return { data: null, error: { message: 'canceling statement due to statement timeout' } };
      }
      return { data: chunk, error: null };
    }, { label: 'test', size: 400 });

    expect(sizes).toEqual([400, 200, 100, 100, 200, 100, 100]);
  });

  it('gives up rather than splitting to nothing', async () => {
    // A 25-row batch that still times out is not a big batch; it is a missing
    // index or a lock. Splitting further would turn one legible failure into
    // forty slow ones and bury the cause.
    let calls = 0;
    await expect(writeInChunks(rows(50), () => {
      calls += 1;
      return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    }, { label: 'Owner upsert', size: 50 })).rejects.toThrow(/Owner upsert failed/);
    expect(calls).toBeLessThan(10);
  });

  it('surfaces a non-timeout error immediately and unchanged', async () => {
    let calls = 0;
    await expect(writeInChunks(rows(500), () => {
      calls += 1;
      return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
    }, { label: 'Tenure upsert', size: 500 })).rejects.toThrow(/duplicate key value/);
    expect(calls).toBe(1);
  });
});

// ── Failure classification ─────────────────────────────────────────────────
//
// run.mjs used to know only "before promotion" and "during promotion". A
// reconciliation failure landed in the second bucket, which produced a run
// recorded as `failed` / records_processed: 0 / "Interrupted during promotion"
// when in fact all 42,323 records had been promoted. It then kept 42,000
// staging rows for a resume with nothing to finish — and because a failing
// resume also killed the run attempting it, every following run died at
// records_received: 0 before fetching anything.

const db = vi.hoisted(() => ({
  finished: [],
  clearedStaging: [],
  reconcileError: null,
  resumeError: null,
  interrupted: null,
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
    startRun: async () => ({ id: 'run-new', started_at: '2026-08-07T20:00:00Z' }),
    lastSuccessfulRun: async () => ({ records_processed: 1000, schema_fingerprint: null }),
    finishRun: async (_sb, runId, patch) => { db.finished.push({ runId, ...patch }); },
    markPromotionStarted: async () => {},
    interruptedRun: async () => db.interrupted,
    clearStaging: async (_sb, runId) => { db.clearedStaging.push(runId); },
    clearStaleStaging: async () => 0,
    stageRows: async () => {},
    // The current run's promotion sees no batches. A resume of the PRIOR run
    // fails, which is the situation under test: on 2026-08-07 the resume got
    // within nine rows of finishing and then hit the statement timeout.
    readStaged: async function* readStaged(_sb, runId) {
      if (runId === 'run-prior' && db.resumeError) throw new Error(db.resumeError);
      yield* [];
    },
    reconcile: async () => {
      if (db.reconcileError) throw new Error(db.reconcileError);
      return { missing_total: 0, reobserved_total: 0, missing: [], reobserved: [] };
    },
    notifyAdmin: async () => {},
    monitoredTenureNumbers: async () => [],
    upsertTenures: async () => new Map(),
    upsertOwners: async () => {},
    pruneOwners: async () => 0,
    insertSnapshots: async () => {},
    insertChangeEvents: async () => {},
    loadExisting: async () => new Map(),
  };
});

describe('a failure after promotion is not a failure during promotion', () => {
  let main;

  beforeEach(async () => {
    db.finished = [];
    db.clearedStaging = [];
    db.reconcileError = null;
    db.resumeError = null;
    db.interrupted = null;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    ({ main } = await import('../scripts/tenure-sync/run.mjs'));
  });

  it('records a clean run as succeeded', async () => {
    await main();
    const run = db.finished.find((f) => f.runId === 'run-new');
    expect(run.status).toBe('succeeded');
  });

  it('does not claim the promotion was interrupted when reconciliation fails', async () => {
    db.reconcileError = 'canceling statement due to statement timeout';
    await main();

    const run = db.finished.find((f) => f.runId === 'run-new');
    // The real defect: this run promoted the entire province and was recorded
    // as an interrupted promotion.
    expect(run.error_summary).not.toMatch(/Interrupted during promotion/);
    expect(run.error_summary).toMatch(/reconciliation failed/i);
    // And its staging must be released — there is nothing left to resume, so
    // retaining it only queues a pointless re-promotion at the head of the
    // next run. Two failures had leaked 84,641 rows this way.
    expect(db.clearedStaging).toContain('run-new');
  });

  it('still reports the run as succeeded when only reconciliation failed', async () => {
    // Reconciliation only ADDS absence bookkeeping, is a single RPC (so a
    // timeout rolls it back whole), and needs two consecutive clean runs before
    // it concludes anything. Losing one night costs a night. Marking the run
    // failed cost the alert engine its baseline, since it reads the last
    // `succeeded` run.
    db.reconcileError = 'canceling statement due to statement timeout';
    await main();

    const run = db.finished.find((f) => f.runId === 'run-new');
    expect(run.status).toBe('succeeded');
    expect(run.records_received).toBeGreaterThan(0);
  });
});

describe('a failing resume does not take down the run that attempts it', () => {
  let main;

  beforeEach(async () => {
    db.finished = [];
    db.clearedStaging = [];
    db.reconcileError = null;
    db.resumeError = null;
    db.interrupted = null;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();
    ({ main } = await import('../scripts/tenure-sync/run.mjs'));
  });

  it('completes tonight\'s sync even when the previous run cannot be recovered', async () => {
    // The wedge. resumeInterruptedPromotion ran bare inside the caller's try,
    // so a throw ended the run at records_received: 0 — before a single feature
    // was fetched — while leaving the prior run's staging in place and still
    // flagged interrupted. The next run then attempted the identical resume and
    // died the identical way, for ever.
    db.interrupted = {
      id: 'run-prior', started_at: '2026-08-07T11:50:00Z', staged: 42323, error_summary: 'x',
    };
    db.resumeError = 'canceling statement due to statement timeout';

    await main();

    const run = db.finished.find((f) => f.runId === 'run-new');
    expect(run.status).toBe('succeeded');
    expect(run.records_received).toBeGreaterThan(0);
  });
});
