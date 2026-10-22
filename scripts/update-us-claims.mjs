#!/usr/bin/env node
// Weekly mirror of BLM's "Active Mining Claims" into Supabase (public.us_claims).
//
//   node scripts/update-us-claims.mjs                       # full load (needs service role)
//   node scripts/update-us-claims.mjs --dry-run --sample 20 # fetch 20 pages, print size stats, write nothing
//   node scripts/update-us-claims.mjs --dry-run --output rows.json
//   node scripts/update-us-claims.mjs --abort-stale         # discard staging of an interrupted run
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (writes), SUPABASE_DB_URL
// (optional; the publish runs over psql because it outlasts PostgREST's 60 s),
// BLM_MLRS_SERVICE_URL / BLM_MLRS_LAYER_ID (same overrides as api/claims.js),
// IMPORT_DB_SIZE_CEILING_MB (disk guard), US_CLAIMS_MAX_STALE_DAYS.
//
// HOW IT PAGES. BLM's layer is ~594k rows and offset paging on it is
// pathologically slow (~35 s per 500 rows). Instead: one returnIdsOnly call for
// every OBJECTID (≈7 s), sorted, cut into pages of PAGE_SIZE consecutive ids,
// and each page fetched as an OBJECTID RANGE (`OBJECTID >= a AND OBJECTID <=
// b`) — a primary-key range scan, ~1 s a page — PAGE_CONCURRENCY at a time,
// each with retries and exponential backoff. If the ids call itself fails, the
// loader falls back to fixed-width OBJECTID ranges over the min/max extent,
// splitting any range that comes back full.
//
// WHAT IS KEPT. Claims located in, or administered by, one of the eleven
// states the app serves (shared/usClaimStates.js). Each row stores the states
// it is in and how that was known, computed by the same function the live
// proxy uses, so the mirror and live BLM agree.
//
// HOW REMOVALS HAPPEN. Every load replaces the whole table in one transaction
// (stage → publish_us_import: TRUNCATE + INSERT), the Quebec pattern. A claim
// that closed since last week is simply not in the new copy; nothing is ever
// half-loaded, and a failed run leaves last week's copy serving.
//
// GEOMETRY is simplified (Douglas-Peucker, ~1 m) and rounded to 6 decimals.
// Claims are mostly 20-acre PLSS rectangles; this drops collinear vertices
// along section lines without moving a corner.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { claimStates, US_STATE_CODES } from '../shared/usClaimStates.js';
import { checkImportHeadroom, describeRefusal } from './lib/importHeadroom.mjs';

export const SERVICE = process.env.BLM_MLRS_SERVICE_URL
  || 'https://nlsdbpubgis.blm.gov/arcgis/rest/services/Mining_Claims/MiningClaims/MapServer';
export const LAYER_ID = /^\d+$/.test(String(process.env.BLM_MLRS_LAYER_ID ?? '').trim()) ? Number(process.env.BLM_MLRS_LAYER_ID) : 1;
export const LAYER_URL = `${SERVICE}/${LAYER_ID}`;
export const OUT_FIELDS = ['OBJECTID', 'CSE_NR', 'LEG_CSE_NR', 'CSE_NAME', 'BLM_PROD', 'CSE_DISP', 'CSE_TYPE_NR',
  'RCRD_ACRS', 'LOC_DT', 'GEO_STATE', 'CSE_META'];
export const PAGE_SIZE = 250;
export const PAGE_CONCURRENCY = 6;
export const BATCH_SIZE = 1000;            // rows per stage_us_import_batch call (SQL checks this)
export const SIMPLIFY_TOLERANCE = 1e-5;    // degrees, ~1 m
export const MIN_ROWS = 300000;            // begin_us_import refuses outside 300k–1.2M
export const MAX_ROWS = 1200000;
// More rows than this dropped as unusable fails the run: it means the layer changed.
export const MAX_REJECT_SHARE = 0.02;
// Unmapped claims are normal at ~2.4%; past this the geometry itself broke.
export const MAX_NO_GEOMETRY_SHARE = 0.06;
// Every kept claim must sit in this envelope (publish_us_import checks it too).
export const WESTERN_US = { minX: -126, minY: 30, maxX: -100, maxY: 50 };
const SERVED = new Set(US_STATE_CODES);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SourceMovedError extends Error {}

/**
 * GET JSON from BLM: never follows a redirect that changes the path (the
 * October 2026 move), retries 5xx / timeouts / in-body ArcGIS errors with
 * exponential backoff.
 */
export async function fetchBlmJson(url, { attempts = 5, timeoutMs = 90000, fetchImpl = fetch, pause = sleep } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const r = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'ExplorationMaps-us-claims-mirror/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      });
      if (r.status >= 300 && r.status < 400) {
        throw new SourceMovedError(`BLM service moved: HTTP ${r.status} to ${r.headers?.get?.('location') || '(no Location)'} — set BLM_MLRS_SERVICE_URL / BLM_MLRS_LAYER_ID.`);
      }
      if (!r.ok) throw Object.assign(new Error(`BLM HTTP ${r.status}`), { retryable: r.status >= 500 || r.status === 429 });
      const body = await r.json();
      if (body?.error) throw Object.assign(new Error(`BLM ArcGIS error: ${JSON.stringify(body.error).slice(0, 200)}`), { retryable: true });
      return body;
    } catch (e) {
      last = e;
      if (e instanceof SourceMovedError) throw e;
      const retryable = e.retryable !== false || e.name === 'TimeoutError';
      if (!retryable || attempt === attempts) break;
      await pause(1000 * 2 ** attempt);
    }
  }
  throw last;
}

// ── Geometry ───────────────────────────────────────────────────────────────

function perpendicular(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function douglasPeucker(points, tol) {
  if (points.length <= 2) return points;
  let maxD = -1;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicular(points[i], points[0], points[points.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [points[0], points[points.length - 1]];
  const left = douglasPeucker(points.slice(0, idx + 1), tol);
  const right = douglasPeucker(points.slice(idx), tol);
  return [...left.slice(0, -1), ...right];
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Simplify one closed ring; never below a valid 4-point ring. */
export function simplifyRing(ring, tol = SIMPLIFY_TOLERANCE) {
  const pts = ring.map((c) => [round6(c[0]), round6(c[1])])
    .filter((c, i, a) => i === 0 || c[0] !== a[i - 1][0] || c[1] !== a[i - 1][1]);
  if (pts.length < 4) return pts.length >= 3 ? [...pts, pts[0]] : pts;
  const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  const open = closed ? pts.slice(0, -1) : pts;
  // Split the ring at its farthest vertex from the start so DP keeps both halves.
  let far = 0;
  let farD = -1;
  open.forEach((p, i) => { const d = Math.hypot(p[0] - open[0][0], p[1] - open[0][1]); if (d > farD) { farD = d; far = i; } });
  const a = douglasPeucker(open.slice(0, far + 1), tol);
  const b = douglasPeucker([...open.slice(far), open[0]], tol);
  const out = [...a.slice(0, -1), ...b];
  return out.length >= 4 ? out : [...open, open[0]];
}

/** Simplified, rounded Polygon/MultiPolygon, or null when there is none. */
export function simplifyGeometry(g, tol = SIMPLIFY_TOLERANCE) {
  if (!g || !Array.isArray(g.coordinates)) return null;
  if (g.type === 'Polygon') {
    const rings = g.coordinates.map((r) => simplifyRing(r, tol)).filter((r) => r.length >= 4);
    return rings.length ? { type: 'Polygon', coordinates: rings } : null;
  }
  if (g.type === 'MultiPolygon') {
    const polys = g.coordinates
      .map((p) => p.map((r) => simplifyRing(r, tol)).filter((r) => r.length >= 4))
      .filter((p) => p.length);
    if (!polys.length) return null;
    return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
  }
  return null;
}

function withinWesternUs(g) {
  let ok = true;
  const walk = (c) => {
    if (!ok) return;
    if (typeof c[0] === 'number') {
      if (c[0] < WESTERN_US.minX || c[0] > WESTERN_US.maxX || c[1] < WESTERN_US.minY || c[1] > WESTERN_US.maxY) ok = false;
    } else c.forEach(walk);
  };
  walk(g.coordinates);
  return ok;
}

// ── Rows ───────────────────────────────────────────────────────────────────

const dateOnly = (v) => {
  if (v == null || v === '') return null;
  const d = new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * One BLM GeoJSON feature → a us_claims row, or { skip: reason }.
 * Reasons: 'no_serial' | 'no_geometry' | 'out_of_scope' (not one of the eleven
 * states) | 'outside_envelope' (coordinates outside the western U.S.).
 */
export function rowFromFeature(feature, retrieved) {
  const p = feature?.properties || {};
  const serial = String(p.CSE_NR ?? '').trim().toUpperCase();
  if (!serial) return { skip: 'no_serial' };
  const legacy = String(p.LEG_CSE_NR ?? '').trim().toUpperCase() || null;
  const placed = claimStates({ geoState: p.GEO_STATE, legalDescription: p.CSE_META, serial, legacySerial: legacy });
  const states = placed.states.filter((s) => SERVED.has(s));
  // Keep a claim in a served state, or an unlocated one from a served office
  // (the API leaves those out per state, but the table stays complete).
  if (!states.length && !(placed.source === 'none' && placed.office && SERVED.has(placed.office))) return { skip: 'out_of_scope' };
  const geometry = simplifyGeometry(feature.geometry);
  if (!geometry) return { skip: 'no_geometry' };
  if (!withinWesternUs(geometry)) return { skip: 'outside_envelope' };
  const acres = Number(p.RCRD_ACRS);
  return {
    serial,
    legacy_serial: legacy,
    claim_name: p.CSE_NAME == null ? null : String(p.CSE_NAME).trim() || null,
    states,
    state_source: states.length ? placed.source : 'none',
    admin_office: placed.office,
    claim_type: p.BLM_PROD ?? null,
    disposition: p.CSE_DISP ?? null,
    case_type_nr: p.CSE_TYPE_NR == null ? null : String(p.CSE_TYPE_NR),
    acres: Number.isFinite(acres) ? acres : null,
    location_date: dateOnly(p.LOC_DT),
    geometry,
    source_updated_at: retrieved,
  };
}

// ── Paging ─────────────────────────────────────────────────────────────────

/** Sorted ids → [first, last] OBJECTID ranges of at most `size` ids each. */
export function idRanges(ids, size = PAGE_SIZE) {
  const sorted = [...ids].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i += size) out.push([sorted[i], sorted[Math.min(i + size, sorted.length) - 1]]);
  return out;
}

function rangeUrl(lo, hi) {
  return `${LAYER_URL}/query?${new URLSearchParams({
    where: `OBJECTID >= ${lo} AND OBJECTID <= ${hi}`,
    outFields: OUT_FIELDS.join(','),
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    f: 'geojson',
  })}`;
}

/**
 * Fetch one OBJECTID range; a range that comes back full (the server's
 * maxRecordCount) is split in two, so no row is ever silently cut off.
 */
export async function fetchRange(lo, hi, { getJson = fetchBlmJson, maxRecordCount = 2000 } = {}) {
  const body = await getJson(rangeUrl(lo, hi));
  const features = Array.isArray(body?.features) ? body.features : null;
  if (!features) throw new Error(`BLM returned no features array for OBJECTID ${lo}-${hi}`);
  const full = features.length >= maxRecordCount || body.exceededTransferLimit || body.properties?.exceededTransferLimit;
  if (full && hi > lo) {
    const mid = Math.floor((lo + hi) / 2);
    const [a, b] = await Promise.all([
      fetchRange(lo, mid, { getJson, maxRecordCount }),
      fetchRange(mid + 1, hi, { getJson, maxRecordCount }),
    ]);
    return [...a, ...b];
  }
  return features;
}

async function allRanges(getJson) {
  try {
    const body = await getJson(`${LAYER_URL}/query?${new URLSearchParams({ where: '1=1', returnIdsOnly: 'true', f: 'json' })}`, { timeoutMs: 180000 });
    if (!Array.isArray(body?.objectIds) || !body.objectIds.length) throw new Error('no object ids');
    return { ranges: idRanges(body.objectIds), idsKnown: body.objectIds.length };
  } catch (e) {
    if (e instanceof SourceMovedError) throw e;
    // Fallback: fixed-width ranges over the extent; fetchRange splits full ones.
    const stats = await getJson(`${LAYER_URL}/query?${new URLSearchParams({
      where: '1=1',
      outStatistics: JSON.stringify([
        { statisticType: 'min', onStatisticField: 'OBJECTID', outStatisticFieldName: 'mn' },
        { statisticType: 'max', onStatisticField: 'OBJECTID', outStatisticFieldName: 'mx' },
      ]),
      f: 'json',
    })}`, { timeoutMs: 180000 });
    const a = stats?.features?.[0]?.attributes || {};
    const mn = Number(a.mn ?? a.MN);
    const mx = Number(a.mx ?? a.MX);
    if (!Number.isFinite(mn) || !Number.isFinite(mx)) throw new Error('Could not read the OBJECTID extent from BLM');
    const step = 5000;
    const ranges = [];
    for (let lo = mn; lo <= mx; lo += step) ranges.push([lo, Math.min(lo + step - 1, mx)]);
    return { ranges, idsKnown: null };
  }
}

/**
 * Fetch every page and turn it into rows.
 * @returns {{rows, stats}}
 */
export async function loadAll({ getJson = (u, o) => fetchBlmJson(u, o), concurrency = PAGE_CONCURRENCY, sample = 0, retrieved = new Date().toISOString().slice(0, 10), log = console.log } = {}) {
  const { ranges: all, idsKnown } = await allRanges(getJson);
  const ranges = sample > 0 ? all.filter((_, i) => i % Math.max(1, Math.floor(all.length / sample)) === 0).slice(0, sample) : all;
  const rows = [];
  const skipped = {};
  const seen = new Set();
  let fetched = 0;
  let next = 0;
  let done = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < ranges.length) {
      const [lo, hi] = ranges[next++];
      const features = await fetchRange(lo, hi, { getJson });
      for (const f of features) {
        fetched += 1;
        const oid = f.properties?.OBJECTID ?? f.id;
        if (oid != null) { if (seen.has(oid)) continue; seen.add(oid); }
        const row = rowFromFeature(f, retrieved);
        if (row.skip) skipped[row.skip] = (skipped[row.skip] || 0) + 1;
        else rows.push(row);
      }
      done += 1;
      if (done % 200 === 0) log(`Fetched ${done}/${ranges.length} pages (${rows.length} rows kept, ${Math.round((Date.now() - started) / 1000)} s)`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, worker));
  return {
    rows,
    stats: { idsKnown, pages: ranges.length, fetched, kept: rows.length, skipped, ms: Date.now() - started, sampled: sample > 0 },
  };
}

/** Refuse a load that looks wrong before anything is written. */
export function validateLoad(rows, stats, { minRows = MIN_ROWS, maxRows = MAX_ROWS } = {}) {
  if (rows.length < minRows || rows.length > maxRows) throw new Error(`Unexpected active-claim count: ${rows.length}`);
  const unusable = (stats.skipped?.no_serial || 0) + (stats.skipped?.outside_envelope || 0);
  if (stats.fetched && unusable / stats.fetched > MAX_REJECT_SHARE) {
    throw new Error(`${unusable} of ${stats.fetched} BLM rows had no serial or impossible coordinates — the layer changed; not loading.`);
  }
  // BLM publishes some claims with no geometry at all (not yet mapped to PLSS:
  // 14,144 of 594,368 on 2026-10-22, 2.4%). They cannot be drawn, so they are
  // not stored; a serial lookup that misses the mirror is re-asked of live BLM.
  // A jump in that share means the geometry broke, not that claims are unmapped.
  const noGeometry = stats.skipped?.no_geometry || 0;
  if (stats.fetched && noGeometry / stats.fetched > MAX_NO_GEOMETRY_SHARE) {
    throw new Error(`${noGeometry} of ${stats.fetched} BLM rows had no usable geometry (limit ${MAX_NO_GEOMETRY_SHARE * 100}%) — the layer changed; not loading.`);
  }
  if (stats.idsKnown != null && stats.fetched < stats.idsKnown * 0.995) {
    throw new Error(`Fetched ${stats.fetched} of ${stats.idsKnown} rows BLM reported — incomplete download; not loading.`);
  }
  const serials = new Set();
  for (const r of rows) {
    if (!r.serial || !r.geometry) throw new Error('Unidentified claim or missing geometry');
    serials.add(r.serial);
  }
  return { rows: rows.length, distinctSerials: serials.size };
}

/** Bytes a row adds as stored (jsonb text length is a fair proxy), for sizing. */
export function sizeStats(rows) {
  if (!rows.length) return { rows: 0 };
  const total = rows.reduce((s, r) => s + JSON.stringify(r).length, 0);
  const geom = rows.reduce((s, r) => s + JSON.stringify(r.geometry).length, 0);
  const vertices = rows.reduce((s, r) => {
    let n = 0;
    const walk = (c) => { if (typeof c[0] === 'number') n += 1; else c.forEach(walk); };
    walk(r.geometry.coordinates);
    return s + n;
  }, 0);
  const bySource = {};
  const byState = {};
  for (const r of rows) {
    bySource[r.state_source] = (bySource[r.state_source] || 0) + 1;
    for (const s of r.states.length ? r.states : ['(none)']) byState[s] = (byState[s] || 0) + 1;
  }
  return {
    rows: rows.length,
    avgRowJsonBytes: Math.round(total / rows.length),
    avgGeometryJsonBytes: Math.round(geom / rows.length),
    avgVertices: Math.round((vertices / rows.length) * 10) / 10,
    bySource,
    byState,
  };
}

// ── Publish (the Quebec atomic swap) ───────────────────────────────────────

export const PUBLISH_STATEMENT_TIMEOUT = '20min';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function publishOverRest(rpc, runId) {
  try {
    return await rpc('publish_us_import', { p_run_id: runId });
  } catch (e) {
    if (/\b57014\b|statement timeout|HTTP 504|aborted due to timeout/i.test(String(e?.message)) || e?.name === 'TimeoutError') {
      throw new Error('publish_us_import cannot finish inside the 60 s REST API limit; add the SUPABASE_DB_URL repository secret (Supabase session pooler connection string) so it runs over Postgres.', { cause: e });
    }
    throw e;
  }
}

export async function publishOverPostgres(dbUrl, runId, { run = promisify(execFile) } = {}) {
  if (!UUID.test(String(runId))) throw new Error('Refusing to publish: import run id is not a uuid');
  try {
    const { stdout } = await run('psql', [dbUrl, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-1',
      '-c', `set local statement_timeout = '${PUBLISH_STATEMENT_TIMEOUT}'`,
      '-c', `select public.publish_us_import('${runId}'::uuid)`], { timeout: 21 * 60_000 });
    return Number(String(stdout).split('\n').map((l) => l.trim()).filter((l) => /^\d+$/.test(l)).pop());
  } catch (e) {
    // Only psql's own words: the argv carries the connection string.
    throw new Error(`publish_us_import over Postgres failed: ${String(e.stderr || (e.killed ? 'psql timed out' : e.code)).trim().slice(0, 300)}`);
  }
}

export const HEADROOM_CHECK_EVERY = 50;

export async function publishRows(rows, rpc, { guard, publish = (runId) => publishOverRest(rpc, runId), log = console.log } = {}) {
  const run = await rpc('begin_us_import', { p_expected_rows: rows.length });
  try {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      if (guard && i > 0 && (i / BATCH_SIZE) % HEADROOM_CHECK_EVERY === 0) await guard('publish');
      await rpc('stage_us_import_batch', { p_run_id: run, p_batch_no: i / BATCH_SIZE, p_rows: rows.slice(i, i + BATCH_SIZE) });
      if (i % 50000 === 0) log(`Staged ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
    }
    if (guard) await guard('publish');
    const result = await publish(run);
    if (result !== rows.length) throw new Error(`Publication count mismatch: ${result}`);
    log(`Published ${result} active US claims atomically.`);
    return result;
  } catch (e) {
    await rpc('abort_us_import', { p_run_id: run }).catch((err) => console.error(`abort_us_import failed, staging left in place: ${err.message}`));
    throw e;
  }
}

export async function abortStaleImport(rpc, readRunId, { log = console.log } = {}) {
  const runId = await readRunId();
  if (!runId) { log('No US claims import in progress; nothing to discard.'); return false; }
  const discarded = await rpc('abort_us_import', { p_run_id: runId });
  log(discarded ? `Discarded staging for interrupted US claims import ${runId}.` : `Import ${runId} had already finished.`);
  return discarded;
}

function connect() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const call = async (path, init, label) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(180000), ...init });
    if (!r.ok) throw new Error(`${label}: HTTP ${r.status}: ${(await r.text()).slice(0, 250)}`);
    return r.json();
  };
  return {
    rpc: (name, args) => call(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) }, name),
    readRunId: async () => (await call('us_import_state?select=run_id', { method: 'GET' }, 'us_import_state'))[0]?.run_id || null,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes('--abort-stale')) {
    const { rpc, readRunId } = connect();
    await abortStaleImport(rpc, readRunId);
    return;
  }
  const dryRun = argv.includes('--dry-run');
  const sample = Number(flag('sample') || 0);
  if (sample && !dryRun) throw new Error('--sample loads a partial copy; it is only allowed with --dry-run.');

  console.log(`Loading ${LAYER_URL}${sample ? ` (sample of ${sample} pages)` : ''}`);
  const { rows, stats } = await loadAll({ sample });
  const size = sizeStats(rows);
  console.log(JSON.stringify({ stats, size }, null, 2));
  const out = flag('output');
  if (out) fs.writeFileSync(out, JSON.stringify(rows));
  if (dryRun) {
    if (!sample) console.log(JSON.stringify(validateLoad(rows, stats)));
    return;
  }
  validateLoad(rows, stats);

  const { rpc } = connect();
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  const publish = dbUrl ? (runId) => publishOverPostgres(dbUrl, runId) : (runId) => publishOverRest(rpc, runId);
  // First load: the table is empty, so size the import from the rows in hand
  // (~1 KB a row stored, indexes included, rounded up).
  const expectedBytes = rows.length * 1024;
  const guard = async (phase) => {
    const headroom = await checkImportHeadroom(() => rpc('import_headroom', {}), { importer: 'us', phase, minBaseBytes: expectedBytes });
    if (!headroom.ok) throw new Error(describeRefusal(headroom));
  };
  await guard('preflight');
  await publishRows(rows, rpc, { guard, publish });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
