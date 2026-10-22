#!/usr/bin/env node
// Live smoke test for US (BLM MLRS) claim searches, with timings.
//
//   node scripts/smoke-us-claims-live.mjs            # all cases
//   node scripts/smoke-us-claims-live.mjs nv         # one state's cases
//   node scripts/smoke-us-claims-live.mjs --json     # machine-readable
//
// Runs the REAL /api/claims handler in-process against the REAL BLM service
// (no mocks), the way a production request would, and prints status, row
// count, declared scoping and wall time for each search. It is the check for
// "is US search working and fast enough right now" — the unit suite mocks BLM
// and so cannot answer either question.
//
// NOT part of `npm test` or CI on purpose (it is not under tests/ and not named
// *.test.js): a government endpoint being slow or down must never block a
// deploy. Behind an HTTPS proxy on Node 22, run with NODE_USE_ENV_PROXY=1.
//
// Exit code: 0 when every case answered 200 within its budget, 1 otherwise.

const JSON_OUT = process.argv.includes('--json');
const only = process.argv.slice(2).find((a) => !a.startsWith('--'))?.toLowerCase() || null;
// Typical-search target from the October 2026 incident: under ~10 s. Vercel
// kills the function at 60 s (vercel.json), so anything over that is a failure
// a user would see.
const TARGET_MS = Number(process.env.SMOKE_TARGET_MS || 10000);
const HARD_MS = 60000;

const { default: handler } = await import('../api/claims.js');

let ip = 0;
async function run(query) {
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  const req = {
    method: 'GET',
    query,
    url: `/api/claims?${new URLSearchParams(query)}`,
    headers: { 'x-forwarded-for': `198.51.100.${(ip++ % 250) + 1}` },
  };
  const t0 = Date.now();
  try {
    await handler(req, res);
  } catch (e) {
    res.statusCode = 'threw';
    res.body = { error: String(e?.message || e) };
  }
  return { ms: Date.now() - t0, status: res.statusCode, body: res.body };
}

function bboxOf(features, pad = 0.03) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const walk = (c) => {
    if (typeof c?.[0] === 'number') {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  features.forEach((f) => walk(f.geometry?.coordinates));
  if (!Number.isFinite(minX)) return null;
  return [minX - pad, minY - pad, maxX + pad, maxY + pad].map((v) => v.toFixed(4)).join(',');
}

// Keep only the claims near an expected point (a name like GATOR exists in
// more than one place), so the follow-up bbox is the property, not the state.
function near(features, [lng, lat], km = 40) {
  const d = (f) => {
    const c = f.geometry?.coordinates?.[0]?.[0]?.[0] ? f.geometry.coordinates[0][0][0] : f.geometry?.coordinates?.[0]?.[0];
    if (!c) return Infinity;
    const dx = (c[0] - lng) * 111 * Math.cos((lat * Math.PI) / 180);
    const dy = (c[1] - lat) * 111;
    return Math.hypot(dx, dy);
  };
  return features.filter((f) => d(f) <= km);
}

const CASES = {
  nv: {
    label: 'Nevada',
    bbox: '-116.30,40.70,-116.00,41.00',          // Carlin trend
    company: 'Nevada Gold Mines',
  },
  az: {
    label: 'Arizona',
    bbox: '-114.50,35.00,-114.20,35.30',          // Oatman / Kingman
    company: 'Freeport',
  },
  ca: {
    label: 'California',
    bbox: '-117.80,35.30,-117.50,35.50',          // Randsburg
    company: 'Rise Gold',
  },
};

// Acceptance properties named by the client (October 2026).
const PROPERTIES = [
  // ~160 lode claims, Pershing/Lander counties, ~56 km SSW of Battle Mountain.
  { state: 'nv', name: 'GATOR', expect: [-117.25, 40.2], km: 45 },
  // The block matching Gator's "~160 claims / ~3,306 acres" on the BLM layer
  // (Oct 2026): 161 CHIVO claims, 3,326 acres, near 40.36 N 116.96 W —
  // unconfirmed against the company's serials.
  { state: 'nv', name: 'CHIVO', expect: [-116.96, 40.36], km: 20 },
  // Lincoln County, ~40 km NE of Pioche (Eastern Calderas).
  { state: 'nv', name: 'JERICHO', expect: [-114.15, 38.2], km: 45 },
];

const rows = [];
function record(state, kind, query, r, extra = {}) {
  const features = r.body?.features || [];
  const row = {
    state,
    kind,
    query: query.q || query.bbox,
    status: r.status,
    ms: r.ms,
    rows: features.length,
    totalKnown: r.body?.meta?.totalKnown ?? null,
    truncated: r.body?.meta?.truncated ?? null,
    scoping: r.body?.meta?.scopingMethod ? `${r.body.meta.scopingMethod}${r.body.meta.scopingDegraded ? ' (degraded)' : ''}` : null,
    // 'mirror' (weekly Supabase copy) or 'live' (BLM) — see docs/us-claims.md.
    source: r.body?.meta?.source || null,
    error: r.status === 200 ? null : (r.body?.error || null),
    ...extra,
  };
  row.ok = r.status === 200 && r.ms < HARD_MS;
  row.fast = r.ms < TARGET_MS;
  rows.push(row);
  if (!JSON_OUT) {
    const flag = !row.ok ? '✗' : row.fast ? '✓' : '~';
    console.log(`${flag} ${state.toUpperCase()} ${kind.padEnd(8)} ${String(row.status).padEnd(5)} ${String(r.ms).padStart(6)} ms  `
      + `${String(row.rows).padStart(5)} rows  ${row.source || '-'} ${row.scoping || ''}  ${row.query}${row.error ? `  — ${row.error}` : ''}`
      + `${extra.note ? `  [${extra.note}]` : ''}`);
  }
  return row;
}

for (const [st, c] of Object.entries(CASES)) {
  if (only && only !== st) continue;
  const province = `us-${st}`;
  // Nearby: a bbox like the nearby-claims overlay sends.
  const nearby = await run({ bbox: c.bbox, province });
  record(st, 'nearby', { bbox: c.bbox }, nearby);
  // Number: a real serial from that bbox, so the lookup is known to exist.
  const serial = nearby.body?.features?.[0]?.properties?.TAG_NUMBER;
  if (serial) record(st, 'number', { q: serial }, await run({ q: serial, type: 'number', province }));
  const bare = serial?.replace(/^[A-Z]+/, '');
  if (bare) record(st, 'number', { q: bare }, await run({ q: bare, type: 'number', province }), { note: 'bare digits' });
  // Company: no claimant store loaded, so this is the claim-name alias ladder.
  record(st, 'company', { q: c.company }, await run({ q: c.company, type: 'company', province }));
}

for (const p of PROPERTIES) {
  if (only && only !== p.state) continue;
  const province = `us-${p.state}`;
  const byName = await run({ q: p.name, type: 'name', province });
  const local = near(byName.body?.features || [], p.expect, p.km);
  const acres = local.reduce((s, f) => s + (Number(f.properties?.RCRD_ACRS) || 0), 0);
  // Where the name actually occurs, so a wrong expected point is obvious.
  const cells = new Map();
  for (const f of byName.body?.features || []) {
    const b = bboxOf([f], 0)?.split(',').map(Number);
    if (!b) continue;
    const key = `${(Math.round(((b[1] + b[3]) / 2) * 5) / 5).toFixed(1)},${(Math.round(((b[0] + b[2]) / 2) * 5) / 5).toFixed(1)}`;
    cells.set(key, (cells.get(key) || 0) + 1);
  }
  const where = [...cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${n}@${k}`).join(' ');
  record(p.state, 'name', { q: p.name }, byName, { note: `${local.length} within ${p.km} km of the property, ${Math.round(acres)} acres; clusters lat,lng: ${where}` });
  const bbox = bboxOf(local);
  if (bbox) {
    const r = await run({ bbox, province });
    const named = (r.body?.features || []).filter((f) => String(f.properties?.CLAIM_NAME || '').toUpperCase().includes(p.name)).length;
    record(p.state, 'nearby', { bbox }, r, { note: `${named} ${p.name} claims + ${(r.body?.features?.length || 0) - named} neighbours` });
  }
}

if (JSON_OUT) console.log(JSON.stringify({ checkedAt: new Date().toISOString(), targetMs: TARGET_MS, rows }, null, 2));
const failed = rows.filter((r) => !r.ok);
const slow = rows.filter((r) => r.ok && !r.fast);
if (!JSON_OUT) {
  console.log(`\n${rows.length - failed.length}/${rows.length} answered; ${slow.length} over the ${TARGET_MS / 1000}s target.`);
}
process.exit(failed.length ? 1 : 0);
