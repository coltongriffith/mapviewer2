import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SourceUnavailableError, judgeOutage, maxStaleDays, describeOutage, announceSkippedRun,
  TENURE_MAX_STALE_DAYS, QC_MAX_STALE_DAYS,
} from '../scripts/lib/sourceOutage.mjs';
import { fetchJsonWithRetry } from '../scripts/tenure-sync/bcSource.mjs';
import {
  downloadActive, isSourceOutage, concludeSourceOutage, publishOverPostgres, publishOverRest,
  publishRows, isRestTimeout, SOURCE_URL,
} from '../scripts/update-qc-claims.js';

// A provincial server having a bad night is not our failure: DataBC answered
// nothing on 2026-10-14 and GESTIM refused connections on 2026-10-13, and each
// turned the job red and emailed the owner. Now an unreachable source is a
// warning — until the data we hold gets old enough to matter.

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-21T12:00:00Z');

describe('when an outage is worth failing over', () => {
  it('stays quiet while the data is fresh and fails once it is stale', () => {
    expect(judgeOutage({ lastSuccessAt: new Date(NOW - 1 * DAY), maxStaleDays: 3, now: NOW }))
      .toEqual({ stale: false, ageDays: 1 });
    expect(judgeOutage({ lastSuccessAt: new Date(NOW - 4 * DAY), maxStaleDays: 3, now: NOW }).stale).toBe(true);
    // Nothing ever loaded is as stale as it gets.
    expect(judgeOutage({ lastSuccessAt: null, maxStaleDays: 3, now: NOW })).toEqual({ stale: true, ageDays: null });
  });

  it('keeps each threshold a constant the environment can override', () => {
    expect(TENURE_MAX_STALE_DAYS).toBe(3);
    expect(QC_MAX_STALE_DAYS).toBe(21);
    expect(maxStaleDays('X', 3, { X: '7' })).toBe(7);
    expect(maxStaleDays('X', 3, { X: '' })).toBe(3);
    expect(maxStaleDays('X', 3, { X: '-1' })).toBe(3);
  });

  it('says how old the data is either way', () => {
    const err = new Error('fetch failed');
    expect(describeOutage('DataBC', err, { stale: false, ageDays: 1.2 }, 3)).toMatch(/1\.2 days old \(limit 3 days\), so this run is skipped/);
    expect(describeOutage('DataBC', err, { stale: true, ageDays: 5 }, 3)).toMatch(/5\.0 days old, past the 3-day limit/);
  });

  it('annotates the run and writes the step summary', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'outage-')), 'summary.md');
    const log = vi.fn();
    announceSkippedRun('Source unreachable', 'down\nagain', { env: { GITHUB_STEP_SUMMARY: file }, log });
    expect(log).toHaveBeenCalledWith('::warning title=Source unreachable::down again');
    expect(readFileSync(file, 'utf8')).toMatch(/\*\*Source unreachable\.\*\* down/);
  });
});

describe('B.C. source: which failures count as an outage', () => {
  const quiet = { sleepImpl: async () => {}, log: () => {} };

  it('calls exhausted retries on a network fault an outage', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const e = await fetchJsonWithRetry('u', { ...quiet, attempts: 3, fetchImpl }).catch((x) => x);
    expect(e).toBeInstanceOf(SourceUnavailableError);
    expect(e.message).toBe('fetch failed');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not call a 400 an outage: that is a question we asked wrongly', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400, text: async () => 'bad CQL' }));
    const e = await fetchJsonWithRetry('u', { ...quiet, attempts: 3, fetchImpl }).catch((x) => x);
    expect(e).not.toBeInstanceOf(SourceUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('Quebec source: which failures count as an outage', () => {
  const pause = async () => {};
  const curlFails = (code, stderr) => vi.fn(async () => { throw Object.assign(new Error('Command failed: curl'), { code, stderr }); });

  it('treats an unreachable or erroring server as an outage', async () => {
    await expect(downloadActive(SOURCE_URL, { run: curlFails(7, "curl: (7) Failed to connect to diffusion.mern.gouv.qc.ca port 443\n"), pause }))
      .rejects.toThrow(SourceUnavailableError);
    expect(isSourceOutage({ code: 22, stderr: 'curl: (22) The requested URL returned error: 503' })).toBe(true);
  });

  it('treats a missing dataset or a non-ZIP body as a real failure', async () => {
    expect(isSourceOutage({ code: 22, stderr: 'curl: (22) The requested URL returned error: 404' })).toBe(false);
    const html = vi.fn(async () => ({ stdout: Buffer.from('<html>') }));
    const e = await downloadActive(SOURCE_URL, { run: html, pause }).catch((x) => x);
    expect(e).not.toBeInstanceOf(SourceUnavailableError);
    expect(e.message).toMatch(/not a ZIP/);
  });

  it('skips quietly while the titles are fresh, fails once they are three weeks old', async () => {
    const log = vi.fn();
    const recent = new Date(Date.now() - 6 * DAY).toISOString().slice(0, 10);
    await expect(concludeSourceOutage(new SourceUnavailableError('Failed to connect'), async () => recent, { log })).resolves.toMatchObject({ stale: false });
    expect(log.mock.calls[0][0]).toMatch(/^::warning title=Quebec claims source unreachable::/);
    await expect(concludeSourceOutage(new SourceUnavailableError('Failed to connect'), async () => '2026-09-15'))
      .rejects.toThrow(/past the 21-day limit/);
  });
});

describe('Quebec publication outlives the REST timeout', () => {
  const RUN = '6854388f-4b51-4a50-87f7-90942258a973';
  const URL = 'postgresql://postgres.ref:s3cret@pooler.example:5432/postgres';

  it('runs publish_qc_import through psql with its own timeout, in one transaction, without a shell', async () => {
    const run = vi.fn(async () => ({ stdout: '258397\n' }));
    expect(await publishOverPostgres(URL, RUN, { run })).toBe(258397);
    const [bin, args] = run.mock.calls[0];
    expect(bin).toBe('psql');
    expect(args[0]).toBe(URL);
    expect(args).toEqual(expect.arrayContaining(['-1', '-v', 'ON_ERROR_STOP=1']));
    expect(args.join(' ')).toMatch(/set local statement_timeout = '10min'.*select public\.publish_qc_import\('6854388f-4b51-4a50-87f7-90942258a973'::uuid\)/);
  });

  it('refuses a run id that is not a uuid, and never repeats the connection string in an error', async () => {
    const run = vi.fn();
    await expect(publishOverPostgres(URL, "x'); drop table qc_claims; --", { run })).rejects.toThrow(/not a uuid/);
    expect(run).not.toHaveBeenCalled();
    const failing = vi.fn(async () => { throw Object.assign(new Error(`Command failed: psql ${URL}`), { code: 3, stderr: 'ERROR:  Publication validation failed\n' }); });
    const e = await publishOverPostgres(URL, RUN, { run: failing }).catch((x) => x);
    expect(e.message).toMatch(/Publication validation failed/);
    expect(e.message).not.toMatch(/s3cret/);
  });

  it('turns a REST statement timeout into one line asking for SUPABASE_DB_URL', async () => {
    const rpc = async () => { throw new Error('publish_qc_import: HTTP 500: {"code":"57014","message":"canceling statement due to statement timeout"}'); };
    await expect(publishOverRest(rpc, RUN)).rejects.toThrow(/add the SUPABASE_DB_URL repository secret/);
    expect(isRestTimeout(new Error('publish_qc_import: HTTP 504: upstream request timeout'))).toBe(true);
    expect(isRestTimeout(new Error('publish_qc_import: HTTP 500: Publication validation failed'))).toBe(false);
  });

  it('aborts staging when the chosen publisher fails', async () => {
    const row = { tag_number: '1', status: 'Active', geometry: { type: 'Polygon', coordinates: [[[-70, 50], [-70.1, 50], [-70.1, 50.1], [-70, 50]]] } };
    const rpc = vi.fn(async (name) => (name === 'begin_qc_import' ? RUN : 1000));
    const publish = vi.fn(async () => { throw new Error('psql timed out'); });
    await expect(publishRows(Array(100000).fill(row), rpc, { publish })).rejects.toThrow(/psql timed out/);
    expect(publish).toHaveBeenCalledWith(RUN);
    expect(rpc.mock.calls.at(-1)).toEqual(['abort_qc_import', { p_run_id: RUN }]);
  });
});
