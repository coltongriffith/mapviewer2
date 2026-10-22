import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { claimStates, serialOffice, legalDescriptionStates } from '../shared/usClaimStates.js';
import {
  rowFromFeature, simplifyRing, simplifyGeometry, idRanges, fetchRange, loadAll, validateLoad,
  publishRows, fetchBlmJson, SourceMovedError, abortStaleImport,
} from '../scripts/update-us-claims.mjs';
import { evaluateHeadroom, expectedGrowthBytes } from '../scripts/lib/importHeadroom.mjs';

// The U.S. claims mirror: shared state placement, the weekly loader (against
// mocked BLM pages), the migration's import functions (in PGlite), and the
// /api/claims read path that prefers the mirror when it is fresh.

const rect = (x = -116, y = 40, d = 0.01) => ({ type: 'Polygon', coordinates: [[[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]]] });
const blmFeature = (oid, over = {}, geometry = rect()) => ({
  type: 'Feature',
  geometry,
  properties: {
    OBJECTID: oid, CSE_NR: `NV10${5000000 + oid}`, LEG_CSE_NR: '', CSE_NAME: `GOLDIE #${oid}`, BLM_PROD: 'Lode Claim',
    CSE_DISP: 'Active', CSE_TYPE_NR: '384101', RCRD_ACRS: 20.66, LOC_DT: null, GEO_STATE: null,
    CSE_META: 'NV 21 0330N 0510E 033 A SE', ...over,
  },
});

describe('shared state placement (shared/usClaimStates.js)', () => {
  it('prefers GEO_STATE, then the legal description, then the serial office', () => {
    expect(claimStates({ geoState: 'AZ', legalDescription: 'NV 21 …', serial: 'NV1' })).toMatchObject({ states: ['AZ'], source: 'geo_state' });
    expect(claimStates({ geoState: null, legalDescription: 'NV 21 0330N|CA 21 0100N', serial: 'NV1' })).toMatchObject({ states: ['NV', 'CA'], source: 'legal_description' });
    expect(claimStates({ geoState: '', legalDescription: '', serial: 'UT106763746' })).toMatchObject({ states: ['UT'], source: 'serial_prefix', office: 'UT' });
  });

  it('never places an Oregon/Washington-office claim by its serial', () => {
    expect(claimStates({ serial: 'OR105000001' })).toEqual({ states: [], source: 'none', office: 'OR' });
    expect(claimStates({ serial: 'OR105000001', legalDescription: 'WA 33 0300N 0400E 001 A NE' }).states).toEqual(['WA']);
  });

  it('reads legacy office prefixes longest first (NMMC is New Mexico, NMC is Nevada)', () => {
    expect(serialOffice('', 'NMMC123')).toBe('NM');
    expect(serialOffice('', 'NMC112112')).toBe('NV');
    expect(serialOffice('', 'CAMC289561')).toBe('CA');
    expect(serialOffice('', 'ORMC1')).toBe('OR');
    expect(serialOffice('ES1', '')).toBeNull();
  });

  it('handles the " | " separator BLM uses on multi-aliquot claims', () => {
    expect(legalDescriptionStates('CA 21 0080N 0150E 009 NENE | CA 21 0080N 0150E 009 NENW')).toEqual(['CA']);
  });
});

describe('loader: rows and geometry', () => {
  it('maps a BLM feature to a row with its states and how they were known', () => {
    const row = rowFromFeature(blmFeature(1, { LEG_CSE_NR: 'nmc1', LOC_DT: Date.UTC(2020, 4, 6) }), '2026-10-22');
    expect(row).toMatchObject({
      serial: 'NV105000001', legacy_serial: 'NMC1', claim_name: 'GOLDIE #1', states: ['NV'], state_source: 'legal_description',
      admin_office: 'NV', claim_type: 'Lode Claim', disposition: 'Active', acres: 20.66, location_date: '2020-05-06', source_updated_at: '2026-10-22',
    });
    expect(row.geometry.type).toBe('Polygon');
  });

  it('skips claims outside the eleven states, and rows with no serial or geometry', () => {
    expect(rowFromFeature(blmFeature(1, { CSE_NR: 'AK1', CSE_META: 'AK 01 …' }), 'd').skip).toBe('out_of_scope');
    expect(rowFromFeature(blmFeature(1, { CSE_NR: '' }), 'd').skip).toBe('no_serial');
    expect(rowFromFeature(blmFeature(1, {}, null), 'd').skip).toBe('no_geometry');
    expect(rowFromFeature(blmFeature(1, {}, rect(-80, 40)), 'd').skip).toBe('outside_envelope');
  });

  it('keeps an unlocated Oregon/Washington-office claim, with no state', () => {
    const row = rowFromFeature(blmFeature(1, { CSE_NR: 'OR105000001', CSE_META: null }, rect(-120, 44)), 'd');
    expect(row).toMatchObject({ states: [], state_source: 'none', admin_office: 'OR' });
  });

  it('simplifies collinear vertices along a section line without moving a corner', () => {
    const ring = [[-116, 40], [-116, 40.005], [-116, 40.01], [-115.995, 40.01], [-115.99, 40.01], [-115.99, 40], [-116, 40]];
    expect(simplifyRing(ring)).toEqual([[-116, 40], [-116, 40.01], [-115.99, 40.01], [-115.99, 40], [-116, 40]]);
    // A real notch (far more than 1 m) survives.
    const notched = [[-116, 40], [-116, 40.01], [-115.995, 40.005], [-115.99, 40.01], [-115.99, 40], [-116, 40]];
    expect(simplifyRing(notched)).toHaveLength(6);
    expect(simplifyGeometry({ type: 'MultiPolygon', coordinates: [rect().coordinates] }).type).toBe('Polygon');
  });
});

describe('loader: paging BLM', () => {
  it('cuts sorted ids into OBJECTID ranges', () => {
    expect(idRanges([5, 1, 9, 3, 7], 2)).toEqual([[1, 3], [5, 7], [9, 9]]);
  });

  it('splits a range that comes back full, so no row is cut off', async () => {
    const calls = [];
    const getJson = async (url) => {
      const where = new URL(url).searchParams.get('where');
      const [, lo, hi] = where.match(/OBJECTID >= (\d+) AND OBJECTID <= (\d+)/).map(Number);
      calls.push([lo, hi]);
      const n = hi - lo + 1;
      return { type: 'FeatureCollection', features: Array.from({ length: Math.min(n, 4) }, (_, i) => blmFeature(lo + i)) };
    };
    const features = await fetchRange(1, 6, { getJson, maxRecordCount: 4 });
    expect(features.map((f) => f.properties.OBJECTID)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(calls[0]).toEqual([1, 6]);
  });

  it('loads every page in parallel, deduplicates, and reports what it skipped', async () => {
    const ids = Array.from({ length: 600 }, (_, i) => 1000 + i);
    const urls = [];
    const getJson = async (url) => {
      urls.push(url);
      const q = new URL(url).searchParams;
      if (q.get('returnIdsOnly')) return { objectIdFieldName: 'OBJECTID', objectIds: ids };
      const [, lo, hi] = q.get('where').match(/OBJECTID >= (\d+) AND OBJECTID <= (\d+)/).map(Number);
      const out = ids.filter((id) => id >= lo && id <= hi).map((id) => blmFeature(id, id === 1001 ? { CSE_NR: 'AK9', CSE_META: 'AK x' } : {}));
      return { type: 'FeatureCollection', features: lo === 1000 ? [...out, out[0]] : out };   // a duplicate row
    };
    const { rows, stats } = await loadAll({ getJson, retrieved: '2026-10-22', log: () => {} });
    expect(stats.pages).toBe(3);
    expect(rows).toHaveLength(599);
    expect(stats.skipped).toEqual({ out_of_scope: 1 });
    const page = urls.find((u) => /OBJECTID/.test(u));
    expect(page).toMatch(/geometryPrecision=6/);
    expect(page).toMatch(/outFields=OBJECTID%2CCSE_NR/);
    expect(page).not.toMatch(/resultOffset/);
  });

  it('refuses a load that is too small, too broken, or incomplete', () => {
    const rows = [rowFromFeature(blmFeature(1), 'd')];
    expect(() => validateLoad(rows, { fetched: 1, skipped: {} })).toThrow(/Unexpected active-claim count/);
    const many = Array(10).fill(rows[0]);
    expect(() => validateLoad(many, { fetched: 100, skipped: { no_serial: 3 } }, { minRows: 1 })).toThrow(/layer changed/);
    // Unmapped claims (no geometry at BLM) are normal at ~2.4%; past 6% the geometry broke.
    expect(validateLoad(many, { fetched: 100, skipped: { no_geometry: 3 } }, { minRows: 1 }).rows).toBe(10);
    expect(() => validateLoad(many, { fetched: 100, skipped: { no_geometry: 7 } }, { minRows: 1 })).toThrow(/no usable geometry/);
    expect(() => validateLoad(many, { fetched: 10, idsKnown: 20, skipped: {} }, { minRows: 1 })).toThrow(/incomplete download/);
    expect(validateLoad(many, { fetched: 10, idsKnown: 10, skipped: {} }, { minRows: 1 })).toEqual({ rows: 10, distinctSerials: 1 });
  });

  it('refuses a moved service and retries transient failures with backoff', async () => {
    const moved = vi.fn(async () => ({ status: 301, ok: false, headers: new Map([['location', 'https://x/arcgis/rest']]) }));
    await expect(fetchBlmJson('https://blm/x', { fetchImpl: moved, pause: async () => {} })).rejects.toBeInstanceOf(SourceMovedError);
    expect(moved).toHaveBeenCalledTimes(1);

    let n = 0;
    const pauses = [];
    const flaky = vi.fn(async () => {
      n += 1;
      if (n === 1) return { status: 503, ok: false };
      if (n === 2) return { status: 200, ok: true, json: async () => ({ error: { code: 500 } }) };
      return { status: 200, ok: true, json: async () => ({ ok: 1 }) };
    });
    expect(await fetchBlmJson('https://blm/x', { fetchImpl: flaky, pause: async (ms) => pauses.push(ms) })).toEqual({ ok: 1 });
    expect(pauses).toEqual([2000, 4000]);

    const notFound = vi.fn(async () => ({ status: 404, ok: false }));
    await expect(fetchBlmJson('https://blm/x', { fetchImpl: notFound, pause: async () => {} })).rejects.toThrow(/404/);
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});

describe('loader: publish', () => {
  const row = rowFromFeature(blmFeature(1), '2026-10-22');

  it('stages in batches of 1000, publishes once, and aborts staging on failure', async () => {
    const calls = [];
    const rpc = vi.fn(async (name, args) => {
      calls.push([name, args?.p_batch_no]);
      if (name === 'begin_us_import') return 'run';
      if (name === 'publish_us_import') return 2500;
      return 1000;
    });
    await publishRows(Array(2500).fill(row), rpc, { log: () => {} });
    expect(calls.map((c) => c[0])).toEqual(['begin_us_import', 'stage_us_import_batch', 'stage_us_import_batch', 'stage_us_import_batch', 'publish_us_import']);
    expect(calls.filter((c) => c[0] === 'stage_us_import_batch').map((c) => c[1])).toEqual([0, 1, 2]);

    const failing = vi.fn(async (name) => {
      if (name === 'begin_us_import') return 'run';
      if (name === 'stage_us_import_batch') throw new Error('network');
      return true;
    });
    await expect(publishRows(Array(10).fill(row), failing, { log: () => {} })).rejects.toThrow('network');
    expect(failing.mock.calls.map((c) => c[0])).toEqual(['begin_us_import', 'stage_us_import_batch', 'abort_us_import']);
  });

  it('discards the staging of an interrupted run', async () => {
    const rpc = vi.fn(async () => true);
    expect(await abortStaleImport(rpc, async () => 'run-1', { log: () => {} })).toBe(true);
    expect(rpc).toHaveBeenCalledWith('abort_us_import', { p_run_id: 'run-1' });
    expect(await abortStaleImport(rpc, async () => null, { log: () => {} })).toBe(false);
  });
});

describe('disk guard knows the third import', () => {
  const MB = 1024 * 1024;
  it('sizes a first load from the loader estimate, not the empty table', () => {
    const snap = { checked_at: '2026-10-22T06:00:00Z', database_bytes: 570 * MB, us_claims_bytes: 0 };
    expect(expectedGrowthBytes(snap, { importer: 'us', phase: 'preflight', minBaseBytes: 600 * MB })).toBe(1200 * MB);
    expect(evaluateHeadroom(snap, { importer: 'us', phase: 'preflight', minBaseBytes: 600 * MB, ceilingBytes: 1500 * MB }).ok).toBe(false);
    expect(evaluateHeadroom(snap, { importer: 'us', phase: 'preflight', minBaseBytes: 600 * MB, ceilingBytes: 5734 * MB }).ok).toBe(true);
  });

  it('keeps all three bulk imports apart', () => {
    const now = '2026-10-22T06:10:00Z';
    const usRunning = { checked_at: now, database_bytes: 600 * MB, us_import_started_at: '2026-10-22T06:00:00Z' };
    expect(evaluateHeadroom(usRunning, { importer: 'qc', phase: 'preflight', ceilingBytes: 5734 * MB }).reasons.join(' ')).toMatch(/U\.S\. claims mirror/);
    expect(evaluateHeadroom(usRunning, { importer: 'tenure', phase: 'preflight', ceilingBytes: 5734 * MB }).ok).toBe(false);
    const qcRunning = { checked_at: now, database_bytes: 600 * MB, qc_import_started_at: '2026-10-22T06:00:00Z' };
    expect(evaluateHeadroom(qcRunning, { importer: 'us', phase: 'preflight', ceilingBytes: 5734 * MB }).ok).toBe(false);
  });
});

// ── The migration, in real PostgreSQL (PGlite) ─────────────────────────────

describe('us_claims migration', () => {
  it('imports atomically, validates, keeps the live copy on failure, and is read-only to anon', async () => {
    const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
    const db = new PGlite({ extensions: { pg_trgm } });
    try {
      // PostGIS is not bundled in PGlite: geometry becomes jsonb, the spatial
      // predicates are stubbed, and the GiST index is left out. Transactions,
      // staging validation, RLS, privileges and rollback run in real Postgres.
      let sql = readFileSync('supabase/migrations/20261031100000_us_claims_mirror.sql', 'utf8')
        .replace(/create extension if not exists postgis;/, '')
        .replace(/geometry\(Geometry, 4326\)/g, 'jsonb')
        .replace(/returns geometry\n/, 'returns jsonb\n')
        .replace(/create index if not exists us_claims_geom_gist[^;]*;/, '')
        .replace(/'tenure_full_run_started_at', \(select max\(started_at\) from public\.tenure_import_runs\s+where status = 'running' and mode = 'full'\),/, "'tenure_full_run_started_at', null,");
      await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
        create function st_geomfromgeojson(text) returns jsonb language sql immutable as $$select $1::jsonb$$;
        create function st_setsrid(jsonb, integer) returns jsonb language sql immutable as $$select $1$$;
        create function st_makeenvelope(float8,float8,float8,float8,integer) returns jsonb language sql immutable as $$select jsonb_build_array($1,$2,$3,$4)$$;
        create function st_coveredby(jsonb,jsonb) returns boolean language sql immutable as $$select coalesce($1->>'invalid','false')<>'true'$$;
        create operator && (leftarg = jsonb, rightarg = jsonb, function = st_coveredby);
        create table qc_import_state(singleton boolean primary key default true, run_id uuid, started_at timestamptz);`);
      await db.exec(sql);
      await db.exec(`insert into us_claims(serial, states, state_source, geometry, source_updated_at)
        values ('OLD1', '{NV}', 'legal_description', '{"type":"Polygon","coordinates":[]}', '2026-10-15');`);
      await db.exec('set role service_role;');

      const row = { serial: 'NV1', legacy_serial: '', claim_name: 'GOLDIE', states: ['NV'], state_source: 'legal_description', admin_office: 'NV',
        claim_type: 'Lode Claim', disposition: 'Active', case_type_nr: '384101', acres: 20.66, location_date: null,
        geometry: { type: 'Polygon', coordinates: [[[-116, 40], [-116, 40.01], [-115.99, 40.01], [-116, 40]]] }, source_updated_at: '2026-10-22' };
      await expect(db.query('select begin_us_import(1000)')).rejects.toThrow(/Unexpected active-claim count/);
      const { rows: [{ id }] } = await db.query('select begin_us_import(300000) as id');
      await expect(db.query('select begin_us_import(300000)')).rejects.toThrow(/already running/);
      await expect(db.query('select publish_us_import($1)', [id])).rejects.toThrow(/Incomplete/);
      await expect(db.query('select stage_us_import_batch($1,0,$2)', [id, JSON.stringify(Array(1000).fill({ ...row, serial: '' }))])).rejects.toThrow(/unidentified/);
      await expect(db.query('select stage_us_import_batch($1,0,$2)', [id, JSON.stringify(Array(999).fill(row))])).rejects.toThrow(/batch size/);
      expect((await db.query('select stage_us_import_batch($1,0,$2) as n', [id, JSON.stringify(Array(1000).fill(row))])).rows[0].n).toBe(1000);

      // Fill the rest directly (300 batches through the RPC is slow in PGlite),
      // with one invalid geometry: publication must fail and keep the old copy.
      const bad = JSON.stringify(Array(1000).fill({ ...row, geometry: { ...row.geometry, invalid: true } }));
      await db.query('insert into us_import_batches select $1, i, $2::jsonb from generate_series(1, 299) i', [id, bad]);
      await expect(db.query('select publish_us_import($1)', [id])).rejects.toThrow(/validation failed/);
      expect((await db.query('select serial from us_claims')).rows).toEqual([{ serial: 'OLD1' }]);

      await db.query('update us_import_batches set rows = $1::jsonb', [JSON.stringify(Array(1000).fill(row))]);
      expect((await db.query('select publish_us_import($1) as n', [id])).rows[0].n).toBe(300000);
      expect((await db.query("select count(*)::int as n from us_claims where serial = 'OLD1'")).rows[0].n).toBe(0);
      expect((await db.query('select count(*)::int as n from us_import_batches')).rows[0].n).toBe(0);
      const stored = (await db.query('select states, legacy_serial, acres::float as acres from us_claims limit 1')).rows[0];
      expect(stored).toEqual({ states: ['NV'], legacy_serial: null, acres: 20.66 });
      // A week later, a jump past 20% is refused rather than published.
      await expect(db.query('select begin_us_import(1000000)')).rejects.toThrow(/20 percent/);

      const snap = (await db.query('select import_headroom() as h')).rows[0].h;
      expect(snap).toHaveProperty('us_claims_bytes');
      expect(snap).toHaveProperty('us_import_started_at', null);

      await db.exec('reset role;');
      const can = async (q) => (await db.query(`select ${q} as ok`)).rows[0].ok;
      expect(await can("has_table_privilege('anon', 'public.us_claims', 'select')")).toBe(true);
      expect(await can("has_table_privilege('anon', 'public.us_claims', 'insert')")).toBe(false);
      expect(await can("has_table_privilege('anon', 'public.us_import_batches', 'select')")).toBe(false);
      expect(await can("has_function_privilege('anon', 'public.publish_us_import(uuid)', 'execute')")).toBe(false);
      expect(await can("has_function_privilege('anon', 'public.import_headroom()', 'execute')")).toBe(false);
      expect(await can("has_function_privilege('anon', 'public.us_claims_in_bbox(double precision, double precision, double precision, double precision, text, integer)', 'execute')")).toBe(true);
      expect(await can("(select relrowsecurity from pg_class where oid = 'public.us_claims'::regclass)")).toBe(true);

      await db.exec('set role anon;');
      const bbox = await db.query("select count(*)::int as n from us_claims_in_bbox(-117, 39, -115, 41, 'nv', 5)");
      expect(bbox.rows[0].n).toBe(5);
      const none = await db.query("select count(*)::int as n from us_claims_in_bbox(-117, 39, -115, 41, 'AZ')");
      expect(none.rows[0].n).toBe(0);
    } finally {
      await db.close();
    }
  }, 120000);
});

// ── The read path ──────────────────────────────────────────────────────────

function mockRes() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}
let ipN = 0;
const req = (query) => ({ method: 'GET', query, url: '/api/claims', headers: { 'x-forwarded-for': `10.9.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}` } });
const json = (body, status = 200) => ({ ok: status < 300, status, headers: new Map([['content-type', 'application/json']]), json: async () => body, text: async () => JSON.stringify(body) });

const mirrorRow = (i, over = {}) => ({
  id: i, serial: `NV10${5000000 + i}`, legacy_serial: null, claim_name: `CHIVO ${i}`, states: ['NV'], state_source: 'legal_description',
  claim_type: 'Lode Claim', disposition: 'Active', case_type_nr: '384101', acres: 20.66, location_date: '2019-05-01',
  geometry: rect(), ...over,
});

describe('/api/claims US read path: mirror first, live fallback', () => {
  let mirrorDate;
  let mirrorRows;
  let mirrorUrls;
  let blmCalls;
  let mirrorDown;
  // The bbox RPC as PostgREST serves it: at most maxRows per response whatever
  // is asked, offset/limit applied to the function's result (which stops at
  // p_limit), and the total in Content-Range only for Prefer: count=exact.
  let maxRows;
  let rpcCalls;
  let rpcFailAt;
  let rpcNoTotal;
  let claimantRows;

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://stub.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    mirrorDate = new Date().toISOString().slice(0, 10);
    mirrorRows = [mirrorRow(1), mirrorRow(2)];
    mirrorUrls = [];
    blmCalls = 0;
    mirrorDown = false;
    maxRows = 1000;
    rpcCalls = [];
    rpcFailAt = null;
    rpcNoTotal = false;
    claimantRows = null;
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('/rest/v1/us_claims?select=source_updated_at')) return json(mirrorDate ? [{ source_updated_at: mirrorDate }] : []);
      if (u.includes('/rest/v1/us_claim_claimants')) {
        if (!claimantRows) return json([], 404);
        const off = Number(u.match(/offset=(\d+)/)?.[1] || 0);
        const lim = Math.min(Number(u.match(/limit=(\d+)/)?.[1] || Infinity), maxRows);
        return json(claimantRows.slice(off, off + lim));
      }
      if (u.includes('/rest/v1/rpc/us_claims_in_bbox')) {
        mirrorUrls.push(`rpc ${init.body}`);
        if (mirrorDown) return json({ message: 'boom' }, 500);
        const off = Number(u.match(/offset=(\d+)/)?.[1] || 0);
        const lim = Math.min(Number(u.match(/limit=(\d+)/)?.[1] || Infinity), maxRows);
        const count = /count=exact/.test(init.headers?.Prefer || '');
        rpcCalls.push({ offset: off, limit: lim, count, order: u.match(/order=([a-z_]+)/)?.[1], pLimit: JSON.parse(init.body).p_limit });
        if (rpcFailAt != null && off >= rpcFailAt) {
          return json({ code: '57014', message: 'canceling statement due to statement timeout' }, 500);
        }
        const result = [...mirrorRows].sort((a, b) => a.id - b.id).slice(0, JSON.parse(init.body).p_limit);
        const page = result.slice(off, off + lim);
        const res = json(page);
        const range = page.length ? `${off}-${off + page.length - 1}` : '*';
        res.headers.set('content-range', `${range}/${count && !rpcNoTotal ? result.length : '*'}`);
        return res;
      }
      if (u.includes('/rest/v1/us_claims?')) {
        mirrorUrls.push(u);
        if (mirrorDown) return json({ message: 'boom' }, 500);
        const off = Number(u.match(/offset=(\d+)/)?.[1] || 0);
        if (/serial\.in\./.test(u)) {
          const wanted = [...u.matchAll(/"([A-Z0-9]+)"/g)].map((m) => m[1]);
          return json(off ? [] : mirrorRows.filter((r) => wanted.includes(r.serial) || wanted.includes(r.legacy_serial)));
        }
        return json(off ? [] : mirrorRows);
      }
      // Live BLM: a minimal layer that answers ids-first with one claim.
      blmCalls += 1;
      if (/MapServer\/\d+\?f=json/.test(u)) {
        return json({ name: 'Active Mining Claims', maxRecordCount: 2000, fields: [
          { name: 'OBJECTID', type: 'esriFieldTypeOID' }, { name: 'CSE_NR', type: 'esriFieldTypeString' },
          { name: 'CSE_NAME', type: 'esriFieldTypeString' }, { name: 'CSE_META', type: 'esriFieldTypeString' },
        ] });
      }
      if (/returnIdsOnly=true/.test(u)) return json({ objectIdFieldName: 'OBJECTID', objectIds: [7] });
      if (/objectIds=/.test(u)) return json({ type: 'FeatureCollection', features: [blmFeature(7)] });
      throw new Error(`unexpected ${u}`);
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  });

  const run = async (query) => {
    const { default: handler } = await import('../api/claims.js');
    const res = mockRes();
    await handler(req(query), res);
    return res;
  };

  it('answers a claim-name search from a fresh mirror, state-scoped, and says so', async () => {
    const res = await run({ q: 'chivo', type: 'name', province: 'us-nv' });
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('mirror');
    expect(res.body.meta.mirrorRetrievedAt).toBe(mirrorDate);
    expect(res.body.meta.mirrorAgeDays).toBe(0);
    expect(res.body.meta.scopingMethod).toBe('legal_description');
    expect(res.body.features).toHaveLength(2);
    const p = res.body.features[0].properties;
    expect(p).toMatchObject({ TAG_NUMBER: 'NV105000001', CLAIM_NAME: 'CHIVO 1', CLAIM_TYPE: 'lode', US_STATE: 'NV', SOURCE_SYSTEM: 'BLM MLRS', STATUS: 'Active' });
    expect(p.AREA_IN_HECTARES).toBeCloseTo(8.36, 1);
    expect(mirrorUrls[0]).toMatch(/states=cs\.\{NV\}/);
    expect(mirrorUrls[0]).toMatch(/claim_name=ilike\.\*chivo\*/);
    expect(blmCalls).toBe(0);
  });

  it('looks up a serial exactly, and reads bare digits as this state\'s serial', async () => {
    const exact = await run({ q: 'nv 105-000-002', type: 'number', province: 'us-nv' });
    expect(exact.body.features.map((f) => f.properties.TAG_NUMBER)).toEqual(['NV105000002']);
    expect(exact.body.meta.relaxedFrom).toBeUndefined();

    vi.resetModules();
    const bare = await run({ q: '105000001', type: 'number', province: 'us-nv' });
    expect(bare.body.features.map((f) => f.properties.TAG_NUMBER)).toEqual(['NV105000001']);
    expect(bare.body.meta.relaxedTo).toBe('NV105000001');
    expect(blmCalls).toBe(0);
  });

  it('asks live BLM for a serial the mirror does not hold (unmapped or newly recorded)', async () => {
    const res = await run({ q: 'NV105000007', type: 'number', province: 'us-nv' });
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('live');
    expect(res.body.features.map((f) => f.properties.TAG_NUMBER)).toEqual(['NV105000007']);
    expect(mirrorUrls.length).toBeGreaterThan(0);
    expect(blmCalls).toBeGreaterThan(0);
  });

  it('answers a pasted list and names the missing numbers', async () => {
    const res = await run({ q: 'NV105000001, NV105999999', type: 'number', province: 'us-nv' });
    expect(res.body.meta.numberList.found).toEqual(['NV105000001']);
    expect(res.body.meta.numberList.missing).toEqual(['NV105999999']);
  });

  it('answers nearby claims through the bbox RPC with the state', async () => {
    const res = await run({ bbox: '-117.1,40.3,-116.8,40.5', province: 'us-nv' });
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('mirror');
    expect(res.body.features).toHaveLength(2);
    expect(JSON.parse(mirrorUrls[0].slice(4))).toMatchObject({ min_lng: -117.1, max_lat: 40.5, p_state: 'NV' });
    expect(res.body.meta).toMatchObject({ totalKnown: 2, returned: 2, truncated: false, pagesFetched: 1 });
  });

  // The production bug: PostgREST's max-rows (1000) cut a 1,207-claim box to
  // exactly 1,000 rows and the response said totalKnown 1000, truncated false.
  it('pages a bbox past the 1,000-row cap and returns every claim (1,207)', async () => {
    mirrorRows = Array.from({ length: 1207 }, (_, i) => mirrorRow(i + 1));
    const res = await run({ bbox: '-114.65,37.85,-114.25,38.1', province: 'us-nv' });
    expect(res.body.meta.source).toBe('mirror');
    expect(res.body.features).toHaveLength(1207);
    expect(new Set(res.body.features.map((f) => f.properties.TAG_NUMBER)).size).toBe(1207);
    expect(res.body.meta).toMatchObject({ totalKnown: 1207, returned: 1207, truncated: false, pagesFetched: 2 });
    expect(rpcCalls.map((c) => c.offset)).toEqual([0, 1000]);
    expect(rpcCalls[0]).toMatchObject({ count: true, order: 'id' });
    expect(rpcCalls[1].count).toBe(false);
    // Every page asks the function for the same ceiling, so the planner keeps
    // the envelope-index plan and the pages line up.
    expect(rpcCalls.map((c) => c.pLimit)).toEqual([10000, 10000]);
    expect(blmCalls).toBe(0);
  });

  it('steps by the rows a page actually held, so a lower cap still reads everything', async () => {
    maxRows = 400;
    mirrorRows = Array.from({ length: 1207 }, (_, i) => mirrorRow(i + 1));
    const res = await run({ bbox: '-114.65,37.85,-114.25,38.1', province: 'us-nv' });
    expect(res.body.features).toHaveLength(1207);
    expect(res.body.meta).toMatchObject({ totalKnown: 1207, truncated: false, pagesFetched: 4 });
    expect(rpcCalls.map((c) => c.offset)).toEqual([0, 400, 800, 1200]);
  });

  it('marks a box with more claims than one response carries as truncated, total unknown', async () => {
    // The function stops at p_limit (10,000): the count it reports is "at least".
    mirrorRows = Array.from({ length: 12000 }, (_, i) => mirrorRow(i + 1));
    const res = await run({ bbox: '-117.5,40.0,-116.5,40.7', province: 'us-nv' });
    expect(res.body.features).toHaveLength(10000);
    expect(res.body.meta).toMatchObject({ totalKnown: null, returned: 10000, truncated: true, pagesFetched: 10 });
    expect(Math.max(...rpcCalls.map((c) => c.offset))).toBe(9000);
  });

  it('keeps the pages that arrived and says truncated when a later page times out', async () => {
    mirrorRows = Array.from({ length: 2500 }, (_, i) => mirrorRow(i + 1));
    rpcFailAt = 2000;   // the anon role's 3 s statement timeout on the third page
    const res = await run({ bbox: '-114.65,37.85,-114.25,38.1', province: 'us-nv' });
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('mirror');
    expect(res.body.features).toHaveLength(2000);
    expect(res.body.meta).toMatchObject({ totalKnown: 2500, returned: 2000, truncated: true });
  });

  it('hands the box to live BLM when the first page times out', async () => {
    mirrorRows = Array.from({ length: 2500 }, (_, i) => mirrorRow(i + 1));
    rpcFailAt = 0;
    const res = await run({ bbox: '-114.65,37.85,-114.25,38.1', province: 'us-nv' });
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('live');
  });

  it('walks until a short page when no total is disclosed', async () => {
    rpcNoTotal = true;
    mirrorRows = Array.from({ length: 2300 }, (_, i) => mirrorRow(i + 1));
    const res = await run({ bbox: '-114.65,37.85,-114.25,38.1', province: 'us-nv' });
    expect(res.body.features).toHaveLength(2300);
    expect(res.body.meta).toMatchObject({ totalKnown: 2300, truncated: false, pagesFetched: 3 });
  });

  it('pages the claimant store past 1,000 rows and joins every serial', async () => {
    const n = 2300;
    claimantRows = Array.from({ length: n }, (_, i) => ({
      serial: `NV10${5000000 + i + 1}`, claimant_name: 'AWESOME GOLD NEVADA LLC', claimant_role: 'owner of record',
      state: 'NV', source: 'mlrs_report_120', snapshot_date: '2026-07-01',
    }));
    mirrorRows = Array.from({ length: n }, (_, i) => mirrorRow(i + 1));
    const res = await run({ q: 'Awesome Gold Nevada LLC', type: 'company', province: 'us-nv' });
    expect(res.body.resolution).toMatchObject({ status: 'resolved', resolvedAgainst: 'claimant', serialsMatched: n });
    expect(res.body.features).toHaveLength(n);
    expect(res.body.meta).toMatchObject({ totalKnown: n, truncated: false });
  });

  it('says truncated when the claimant store holds more rows than are read', async () => {
    claimantRows = Array.from({ length: 5200 }, (_, i) => ({
      serial: `NV10${5000000 + i + 1}`, claimant_name: 'AWESOME GOLD NEVADA LLC', claimant_role: 'owner of record',
      state: 'NV', source: 'mlrs_report_120', snapshot_date: '2026-07-01',
    }));
    mirrorRows = Array.from({ length: 5200 }, (_, i) => mirrorRow(i + 1));
    const res = await run({ q: 'Awesome Gold Nevada LLC', type: 'company', province: 'us-nv' });
    expect(res.body.resolution.serialsMatched).toBe(5000);
    expect(res.body.features).toHaveLength(5000);
    expect(res.body.meta).toMatchObject({ totalKnown: null, truncated: true });
  });

  it('resolves a company through the alias ladder on claim names, labelled as such', async () => {
    mirrorRows = [mirrorRow(1, { claim_name: 'AWESOME GOLD NEVADA LLC 1' })];
    const res = await run({ q: 'Awesome Gold Corp.', type: 'company', province: 'us-nv' });
    expect(res.body.resolution).toMatchObject({ status: 'resolved', resolvedAgainst: 'claim_name' });
    expect(res.body.features).toHaveLength(1);
  });

  it('declares serial-prefix placement as degraded', async () => {
    mirrorRows = [mirrorRow(1), mirrorRow(2, { state_source: 'serial_prefix' })];
    const res = await run({ q: 'chivo', type: 'name', province: 'us-nv' });
    expect(res.body.meta.scopingMethod).toBe('serial_prefix');
    expect(res.body.meta.scopingDegraded).toBe(true);
    expect(res.body.meta.scopingNote).toMatch(/^1 of 2 claims/);
  });

  it('falls back to live BLM when the mirror is stale, empty, or failing', async () => {
    mirrorDate = '2026-01-01';
    let res = await run({ q: 'goldie', type: 'name', province: 'us-nv' });
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('live');
    expect(blmCalls).toBeGreaterThan(0);

    vi.resetModules();
    mirrorDate = null;
    res = await run({ q: 'goldie', type: 'name', province: 'us-nv' });
    expect(res.body.meta.source).toBe('live');

    vi.resetModules();
    mirrorDate = new Date().toISOString().slice(0, 10);
    mirrorDown = true;
    res = await run({ q: 'goldie', type: 'name', province: 'us-nv' });
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('live');
    vi.resetModules();
    res = await run({ bbox: '-117.1,40.3,-116.8,40.5', province: 'us-nv' });
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('live');
  });

  it('can be switched off with US_CLAIMS_MIRROR=off', async () => {
    process.env.US_CLAIMS_MIRROR = 'off';
    try {
      const res = await run({ q: 'goldie', type: 'name', province: 'us-nv' });
      expect(res.body.meta.source).toBe('live');
      expect(mirrorUrls).toHaveLength(0);
    } finally {
      delete process.env.US_CLAIMS_MIRROR;
    }
  });
});
