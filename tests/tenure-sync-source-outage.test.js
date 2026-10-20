import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourceUnavailableError } from '../scripts/lib/sourceOutage.mjs';

// 2026-10-14: DataBC answered nothing for five attempts and the sync failed,
// emailing the owner about an outage the next run fixed by itself. An
// unreachable source is now recorded and skipped with a warning, unless the
// last good full sync is more than three days old.

const DAY = 86_400_000;

const db = vi.hoisted(() => ({
  finished: [], started: 0, emails: [], lastFullAt: null, sampleError: null, pageError: null,
}));

vi.mock('../scripts/tenure-sync/bcSource.mjs', () => ({
  SOURCE_ID: 'test-source',
  SOURCE_METADATA: { layer: 'test', attribution: 'test' },
  fetchSampleFeature: async () => {
    if (db.sampleError) throw db.sampleError;
    return {
      properties: {
        TENURE_NUMBER_ID: 1, TAG_NUMBER: 'A', CLAIM_NAME: 'n', OWNER_NAME: 'o',
        AREA_IN_HECTARES: 1, GOOD_TO_DATE: '2027-01-01', ISSUE_DATE: '2020-01-01',
        TENURE_TYPE_DESCRIPTION: 't', TITLE_TYPE_DESCRIPTION: 'tt', MAP_UNIT_NO: 'm',
      },
      geometry: { type: 'Polygon', coordinates: [] },
    };
  },
  streamFeatures: async () => {
    if (db.pageError) throw db.pageError;
    return { received: 1000, truncated: false };
  },
  tenureNumberFilter: () => null,
}));

vi.mock('../scripts/tenure-sync/db.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createServiceClient: () => ({}),
    startRun: async () => { db.started += 1; return { id: 'run-new', started_at: new Date().toISOString() }; },
    lastSuccessfulRun: async () => (db.lastFullAt ? { completed_at: db.lastFullAt, records_processed: 1000 } : null),
    finishRun: async (_sb, runId, patch) => { db.finished.push({ runId, ...patch }); },
    interruptedRun: async () => null,
    clearStaging: async () => 0,
    clearStaleStaging: async () => 0,
    importHeadroom: async () => ({ checked_at: new Date().toISOString(), database_bytes: 1, qc_claims_bytes: 0, tenure_bytes: 0 }),
    notifyAdmin: async (_sb, mail) => { db.emails.push(mail); },
  };
});

describe('an unreachable B.C. source', () => {
  let main;
  let log;

  beforeEach(async () => {
    Object.assign(db, { finished: [], started: 0, emails: [], lastFullAt: null, sampleError: null, pageError: null });
    process.exitCode = undefined;
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.mockClear();
    vi.resetModules();
    ({ main } = await import('../scripts/tenure-sync/run.mjs'));
  });

  const warnings = () => log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('::warning'));

  it('is recorded and skipped with a warning while the data is fresh', async () => {
    db.sampleError = new SourceUnavailableError('fetch failed');
    db.lastFullAt = new Date(Date.now() - 1 * DAY).toISOString();
    await main();

    expect(db.started).toBe(1);
    const run = db.finished.find((f) => f.runId === 'run-new');
    expect(run.status).toBe('failed');
    expect(run.error_summary).toMatch(/could not be reached \(fetch failed\).*this run is skipped/);
    expect(db.emails).toHaveLength(0);
    expect(warnings()).toHaveLength(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('fails and emails once the last good full sync is older than three days', async () => {
    db.sampleError = new SourceUnavailableError('fetch failed');
    db.lastFullAt = new Date(Date.now() - 4 * DAY).toISOString();
    await main();

    expect(db.finished[0].error_summary).toMatch(/4\.0 days old, past the 3-day limit/);
    expect(db.emails[0].subject).toMatch(/stale/);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('is skipped the same way when the first page of the pull never arrives', async () => {
    db.pageError = new SourceUnavailableError('fetch failed');
    db.lastFullAt = new Date(Date.now() - 1 * DAY).toISOString();
    await expect(main()).resolves.toBeUndefined();
    expect(db.finished.find((f) => f.runId === 'run-new').status).toBe('failed');
    expect(warnings()).toHaveLength(1);
    expect(db.emails).toHaveLength(0);
  });

  it('still fails on anything that is not an outage', async () => {
    db.pageError = new Error('BC WFS responded 400: bad CQL');
    db.lastFullAt = new Date(Date.now() - 1 * DAY).toISOString();
    await expect(main()).rejects.toThrow(/400/);
    expect(warnings()).toHaveLength(0);
    expect(db.emails[0].subject).toMatch(/sync failed/);
  });
});
