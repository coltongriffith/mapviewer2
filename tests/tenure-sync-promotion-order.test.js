import { describe, it, expect, vi, beforeEach } from 'vitest';

// Promotion order and run bookkeeping (docs/state-machines.md, TEN-5..7).
const db = vi.hoisted(() => ({
  calls: [], finished: [], tenureRows: [], recordedEvents: [], ownerFailures: 0, dryRun: false,
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
  streamFeatures: async ({ onPage }) => { await onPage([]); return { received: 1000, truncated: false }; },
  tenureNumberFilter: () => null,
}));

const prev = { id: 't1', source_record_id: 's1', tenure_number: '1', good_to_date: '2027-01-01', status: 'GOOD', missing_run_count: 2 };
const staged = { tenure: { source_record_id: 's1', tenure_number: '1', good_to_date: '2028-01-01', status: 'GOOD', geometry: null }, owners: [] };

vi.mock('../scripts/tenure-sync/db.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  const chain = (table) => {
    const api = { select: () => api, eq: () => api, in: () => api,
      then: (resolve) => resolve({ data: table === 'tenure_change_events' ? db.recordedEvents : [], error: null }) };
    return api;
  };
  return {
    ...actual,
    createServiceClient: () => ({ from: chain }),
    startRun: async () => ({ id: 'run-1', started_at: '2026-08-07T20:00:00Z' }),
    lastSuccessfulRun: async () => ({ records_processed: 1000, schema_fingerprint: null }),
    finishRun: async (_sb, runId, patch) => { db.finished.push({ runId, ...patch }); },
    markPromotionStarted: async () => {},
    interruptedRun: async () => null,
    clearStaging: async () => {},
    clearStaleStaging: async () => 0,
    importHeadroom: async () => ({ checked_at: new Date().toISOString(), database_bytes: 1, qc_claims_bytes: 0, tenure_bytes: 0 }),
    stageRows: async () => {},
    readStaged: async function* readStaged() { yield [structuredClone(staged)]; },
    reconcile: async () => ({ missing_total: 0, reobserved_total: 0, missing: [], reobserved: [] }),
    notifyAdmin: async () => {},
    monitoredTenureNumbers: async () => [],
    loadExisting: async () => new Map([['s1', structuredClone(prev)]]),
    upsertTenures: async (_sb, rows) => { db.calls.push('upsertTenures'); db.tenureRows.push(...rows); return new Map([['s1', 't1']]); },
    upsertOwners: async () => {
      db.calls.push('upsertOwners');
      if (db.ownerFailures > 0) { db.ownerFailures -= 1; throw new Error('canceling statement due to statement timeout'); }
    },
    pruneOwners: async () => 0,
    insertSnapshots: async () => { db.calls.push('insertSnapshots'); },
    insertChangeEvents: async (_sb, rows) => { db.calls.push(`insertChangeEvents:${rows.length}`); },
  };
});

async function run(args = []) {
  vi.resetModules();
  const argv = process.argv;
  process.argv = [argv[0], argv[1], ...args];
  try {
    const { main } = await import('../scripts/tenure-sync/run.mjs');
    await main();
  } finally { process.argv = argv; }
}

describe('tenure sync promotion', () => {
  beforeEach(() => {
    Object.assign(db, { calls: [], finished: [], tenureRows: [], recordedEvents: [], ownerFailures: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  it('TEN-7: records change events before the tenure rows move, so a crash cannot lose them', async () => {
    db.ownerFailures = 1;
    await run().catch(() => {}); // the owner upsert dies mid-batch
    expect(db.calls).toContain('upsertOwners');
    const events = db.calls.findIndex((c) => c.startsWith('insertChangeEvents:') && c !== 'insertChangeEvents:0');
    expect(events).toBeGreaterThanOrEqual(0);
    expect(events).toBeLessThan(db.calls.indexOf('upsertTenures'));
    process.exitCode = undefined;
  });

  it('TEN-7: a resume of the same run does not record the events twice', async () => {
    await run();
    expect(db.calls).toContain('insertChangeEvents:1');
    db.calls = [];
    db.recordedEvents = [{ tenure_id: 't1' }];
    await run();
    expect(db.calls).not.toContain('insertChangeEvents:1');
  });

  it('TEN-6: promotion keeps the missing-run count for reconcile to read', async () => {
    await run();
    expect(db.tenureRows.length).toBeGreaterThan(0);
    for (const row of db.tenureRows) expect(row).not.toHaveProperty('missing_run_count');
  });

  it('TEN-5: a dry run is recorded as a dry run, not a successful sync', async () => {
    await run(['--dry-run']);
    expect(db.finished.at(-1).status).toBe('dry_run');
    expect(db.calls).not.toContain('upsertTenures');
  });
});
