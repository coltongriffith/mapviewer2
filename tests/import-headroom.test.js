import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  DEFAULT_CEILING_MB, ceilingBytesFromEnv, evaluateHeadroom, expectedGrowthBytes,
  checkImportHeadroom, describeRefusal,
} from '../scripts/lib/importHeadroom.mjs';
import { publishRows, abortStaleImport } from '../scripts/update-qc-claims.js';

// 2026-10-20: the Quebec refresh and the B.C. full tenure sync ran at the same
// time and filled the database disk. These pin the guard both importers now
// consult before they write (scripts/lib/importHeadroom.mjs).

const MB = 1024 * 1024;
const NOW = '2026-10-20T15:36:00Z';
const healthy = {
  checked_at: NOW,
  database_bytes: 576 * MB,
  qc_claims_bytes: 202 * MB,
  tenure_bytes: 198 * MB,
  qc_import_started_at: null,
  tenure_full_run_started_at: null,
};
const ceilingBytes = 5734 * MB;

describe('disk headroom guard', () => {
  it('defaults the ceiling to 70% of an 8 GB disk and honours the override', () => {
    expect(DEFAULT_CEILING_MB).toBe(5734);
    expect(ceilingBytesFromEnv({})).toBe(5734 * MB);
    expect(ceilingBytesFromEnv({ IMPORT_DB_SIZE_CEILING_MB: '2000' })).toBe(2000 * MB);
    expect(ceilingBytesFromEnv({ IMPORT_DB_SIZE_CEILING_MB: 'nonsense' })).toBe(5734 * MB);
  });

  it('lets a normal import through on today\'s database', () => {
    for (const [importer, phase] of [['qc', 'preflight'], ['qc', 'publish'], ['tenure', 'preflight'], ['tenure', 'promote']]) {
      expect(evaluateHeadroom(healthy, { importer, phase, ceilingBytes }).ok).toBe(true);
    }
  });

  it('refuses when the import itself would carry the database past the ceiling', () => {
    // 5,400 MB + 2 x 202 MB of Quebec staging and new copy > 5,734 MB.
    const nearlyFull = { ...healthy, database_bytes: 5400 * MB };
    const qc = evaluateHeadroom(nearlyFull, { importer: 'qc', phase: 'preflight', ceilingBytes });
    expect(qc.ok).toBe(false);
    expect(qc.reasons.join(' ')).toMatch(/5400 MB.*404 MB.*5734 MB ceiling/);
    // Publishing only adds the new copy, which still fits.
    expect(evaluateHeadroom(nearlyFull, { importer: 'qc', phase: 'publish', ceilingBytes }).ok).toBe(true);
    expect(evaluateHeadroom({ ...healthy, database_bytes: 6000 * MB }, {
      importer: 'tenure', phase: 'preflight', mode: 'targeted', ceilingBytes,
    }).ok).toBe(false);
  });

  it('treats a targeted tenure refresh as adding nothing', () => {
    expect(expectedGrowthBytes(healthy, { importer: 'tenure', phase: 'preflight', mode: 'targeted' })).toBe(0);
    expect(expectedGrowthBytes(healthy, { importer: 'tenure', phase: 'preflight', mode: 'full' })).toBe(396 * MB);
  });

  it('refuses to run alongside the other bulk import, but not behind a dead marker', () => {
    const tenureRunning = { ...healthy, tenure_full_run_started_at: '2026-10-20T15:30:00Z' };
    expect(evaluateHeadroom(tenureRunning, { importer: 'qc', phase: 'preflight', ceilingBytes }).reasons.join(' '))
      .toMatch(/B\.C\. tenure full sync has been writing/);
    // A job killed mid-run leaves its row 'running' for ever.
    const orphan = { ...healthy, tenure_full_run_started_at: '2026-10-20T13:00:00Z' };
    expect(evaluateHeadroom(orphan, { importer: 'qc', phase: 'preflight', ceilingBytes }).ok).toBe(true);

    const qcRunning = { ...healthy, qc_import_started_at: '2026-10-20T15:35:00Z' };
    expect(evaluateHeadroom(qcRunning, { importer: 'tenure', phase: 'preflight', ceilingBytes }).ok).toBe(false);
    // A targeted refresh writes a few dozen rows and is not held up.
    expect(evaluateHeadroom(qcRunning, {
      importer: 'tenure', phase: 'preflight', mode: 'targeted', ceilingBytes,
    }).ok).toBe(true);
  });

  it('fails closed when the database cannot be asked', async () => {
    const result = await checkImportHeadroom(async () => { throw new Error('Could not find the function public.import_headroom'); }, {
      importer: 'qc', phase: 'preflight', ceilingBytes,
    });
    expect(result.ok).toBe(false);
    expect(describeRefusal(result)).toMatch(/import_disk_guard\.sql/);
    expect(evaluateHeadroom(null, { importer: 'qc', phase: 'preflight', ceilingBytes }).ok).toBe(false);
  });
});

describe('Quebec import consults the guard inside its abort path', () => {
  const row = { tag_number: '123', status: 'Active', geometry: { type: 'Polygon', coordinates: [[[-70, 50], [-70.1, 50], [-70.1, 50.1], [-70, 50]]] } };

  it('discards staging and never publishes when the guard refuses before publication', async () => {
    const rpc = vi.fn(async (name) => (name === 'begin_qc_import' ? 'run' : 1000));
    const guard = vi.fn(async () => { throw new Error('Import refused to protect database disk.'); });
    await expect(publishRows(Array(100000).fill(row), rpc, { guard })).rejects.toThrow(/refused/);
    const names = rpc.mock.calls.map((c) => c[0]);
    expect(names).not.toContain('publish_qc_import');
    expect(names.at(-1)).toBe('abort_qc_import');
    // 100 batches: checked at batch 50, then refused there.
    expect(names.filter((n) => n === 'stage_qc_import_batch')).toHaveLength(50);
  });

  it('says so, instead of swallowing it, when the abort itself fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpc = vi.fn(async (name) => {
      if (name === 'begin_qc_import') return 'run';
      if (name === 'abort_qc_import') throw new Error('HTTP 503');
      throw new Error('publish_qc_import: HTTP 504: upstream request timeout');
    });
    await expect(publishRows(Array(100000).fill(row), rpc)).rejects.toThrow(/504/);
    expect(error.mock.calls.flat().join(' ')).toMatch(/abort_qc_import failed.*503/);
    error.mockRestore();
  });

  it('cleanup discards the staging of whichever import is recorded as in progress', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const rpc = vi.fn(async () => true);
    expect(await abortStaleImport(rpc, async () => 'stale-run')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('abort_qc_import', { p_run_id: 'stale-run' });
    rpc.mockClear();
    expect(await abortStaleImport(rpc, async () => null)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('import_disk_guard migration', () => {
  it('reports sizes and in-flight imports to service_role only, and still clears Quebec staging', async () => {
    const db = new PGlite();
    try {
      await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
        create table qc_claims(id bigint generated always as identity,tag_number text,owner_name text,status text,good_to_date date,area_hectares numeric,title_type text,geometry jsonb,source_updated_at date,geom jsonb generated always as(geometry) stored);
        create function st_makeenvelope(float8,float8,float8,float8,integer) returns jsonb language sql as $$select '{}'::jsonb$$;
        create function st_coveredby(jsonb,jsonb) returns boolean language sql as $$select true$$;
        create function truncate_qc_claims() returns void language sql as $$truncate qc_claims$$;
        create table tenure_import_runs(id uuid primary key default gen_random_uuid(), mode text, status text, started_at timestamptz default now());
        insert into tenure_import_runs(mode,status,started_at) values('full','running','2026-10-20T15:36:18Z'),('targeted','running',now()),('full','succeeded',now());`);
      for (const f of ['20260915160235_repair_qc_atomic_import.sql', '20260915160808_qc_import_continue_identity.sql', '20261020160000_import_disk_guard.sql']) {
        await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
      }
      await db.exec('grant all on qc_claims to service_role; grant usage,select on sequence qc_claims_id_seq to service_role; set role service_role;');

      const snap = async () => (await db.query('select import_headroom() as h')).rows[0].h;
      let h = await snap();
      expect(h.database_bytes).toBeGreaterThan(0);
      expect(h.qc_claims_bytes).toBeGreaterThan(0);
      expect(h.tenure_bytes).toBe(0); // tables absent here: reported as zero, not an error
      expect(h.qc_import_started_at).toBeNull();
      expect(new Date(h.tenure_full_run_started_at).toISOString()).toBe('2026-10-20T15:36:18.000Z');

      const { rows: [{ id }] } = await db.query('select begin_qc_import(100000) as id');
      expect((await snap()).qc_import_started_at).not.toBeNull();
      await db.query('insert into qc_import_batches values($1,0,$2::jsonb)', [id, '[]']);
      expect((await db.query('select abort_qc_import($1) as ok', [id])).rows[0].ok).toBe(true);
      expect((await db.query('select count(*)::int as n from qc_import_batches')).rows[0].n).toBe(0);
      h = await snap();
      expect(h.qc_import_started_at).toBeNull();

      for (const fn of ['public.import_headroom()', 'public.qc_discard_import_batches()']) {
        for (const role of ['anon', 'authenticated']) {
          const { rows: [{ allowed }] } = await db.query(`select has_function_privilege('${role}','${fn}','execute') as allowed`);
          expect(allowed, `${role} on ${fn}`).toBe(false);
        }
      }
    } finally { await db.close(); }
  }, 60000);
});
