// Claim registry lookups for the 3D studio's "Find claims" (src/three-d/claims.js), the same requests the 2D
// editor makes (useClaims's search, App.jsx's nearby claims; those keep their own copies so that the editor's
// chunks are unchanged). Both go through the same-origin proxies, which CSP allows:
// /api/claims (a search by holder, claim number or claim name in one jurisdiction; or a lon/lat bbox outside
// BC) and /api/bc-claims (BC's tenures in a bbox). The rest is pure: claims read into a plain FeatureCollection
// with owner, title and status, split into the project's claims and their neighbours, and the source credit.

// The first non-empty property of these names, any case (shared/claimData.js's claimProperty; kept here so the
// /3d chunk does not split claimData.js out of the 2D app's chunks).
function prop(f, ...names) {
  const p = f?.properties || {}, keys = Object.keys(p);
  for (const n of names) { const k = keys.find((c) => c.toLowerCase() === n.toLowerCase()), v = k ? p[k] : null; if (v !== null && v !== undefined && String(v).trim() !== '') return v; }
  return null;
}

export const CLAIMS_API = '/api/claims';
export const BC_CLAIMS_API = '/api/bc-claims';

// The registry each jurisdiction's claims come from, for the figure's source credit.
export const REGISTRIES = {
  bc: 'BC Mineral Titles Online', on: 'Ontario MLAS', sk: 'Saskatchewan MARS', mb: 'Manitoba Mineral Dispositions',
  nl: 'Newfoundland and Labrador GeoAtlas', yt: 'Yukon Quartz Claims', qc: 'Quebec GESTIM',
};
export const registryOf = (province) => REGISTRIES[province] || (/^us-/.test(province) ? 'BLM MLRS' : String(province || '').toUpperCase());
const day = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
export const claimsCredit = (province, date = new Date()) => `Claims: ${registryOf(province)}, retrieved ${day(date)}`;

// A search of one jurisdiction: type "company" (the holder), "number" or "name" (the claim's name).
// The 2D search's request and errors exactly (useClaims).
export async function searchClaims(query, type, province, signal) {
  const params = new URLSearchParams({ q: String(query).trim(), type, province });
  const res = await fetch(`${CLAIMS_API}?${params}`, signal ? { signal } : undefined);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ? `${body.error}: ${body.detail}` : body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data?.features) throw new Error('Unexpected response format from registry');
  return data;
}

// Every claim in a lon/lat box ([west, south, east, north] or "w,s,e,n"): BC's through /api/bc-claims, the
// others through /api/claims. The 2D nearby-claims request and errors exactly (App.jsx).
export async function claimsInBbox(bbox, province = 'bc', { timeout } = {}) {
  const box = Array.isArray(bbox) ? bbox.join(',') : String(bbox);
  const bc = province === 'bc', url = bc ? `${BC_CLAIMS_API}?bbox=${encodeURIComponent(box)}` : `${CLAIMS_API}?bbox=${encodeURIComponent(box)}&province=${province}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout ?? (bc ? 35000 : 45000)) });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ---- Pure ----
// A box round lon/lat points, widened by pad (a fraction of its size, and at least minDeg on each side).
export function bboxAround(points, pad = 0.5, minDeg = 0.01) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const w = Math.min(...xs), e = Math.max(...xs), s = Math.min(...ys), n = Math.max(...ys);
  const dx = Math.max(minDeg, (e - w) * pad), dy = Math.max(minDeg, (n - s) * pad), r = (v) => Math.round(v * 1e6) / 1e6;
  return [r(w - dx), r(s - dy), r(e + dx), r(n + dy)];
}

// A registry response as claims: polygons only, with number, title (the claim's name), owner, status, type,
// good-to date and area in hectares, whatever the registry calls them. Duplicates (by number) are dropped.
export function toClaims(fc) {
  const seen = new Set(), features = [];
  (fc?.features || []).forEach((f) => {
    const g = f?.geometry; if (!g || !/^(Multi)?Polygon$/.test(g.type)) return;
    const n = prop(f, 'TENURE_NUMBER_ID', 'TAG_NUMBER', 'CLAIM_NUMBER', 'SERIAL_NR', 'SERIAL_NO', 'claim_number', 'number'), number = n == null ? null : String(n).trim(), key = number || JSON.stringify(g.coordinates).slice(0, 200);
    if (seen.has(key)) return; seen.add(key);
    const area = Number(prop(f, 'AREA_IN_HECTARES', 'AREA_HECTARES', 'AREA_HA', 'area_ha'));
    const p = {
      number, title: prop(f, 'CLAIM_NAME', 'CSE_NAME', 'title', 'name'), owner: prop(f, 'OWNER_NAME', 'HOLDER_NAME', 'HOLDER', 'CLAIMANT_NAME', 'owner_name', 'holder', 'owner'),
      status: prop(f, 'STATUS', 'TENURE_STATUS', 'CSE_DISP', 'status'), type: prop(f, 'TITLE_TYPE_DESCRIPTION', 'TENURE_TYPE_DESCRIPTION', 'type'),
      good_to: prop(f, 'GOOD_TO_DATE', 'EXPIRY_DATE', 'good_to'), area_ha: Number.isFinite(area) && area > 0 ? Math.round(area * 100) / 100 : null,
    };
    features.push({ type: 'Feature', properties: Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, typeof v === 'number' ? v : String(v)])), geometry: g });
  });
  return { type: 'FeatureCollection', features };
}
export const mergeClaims = (...fcs) => toClaims({ features: fcs.flatMap((fc) => fc?.features || []) });

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// The holders, most claims first: [{ owner, count }].
export function ownersOf(fc) {
  const n = new Map(); (fc?.features || []).forEach((f) => { const o = f.properties?.owner || 'Unknown'; n.set(o, (n.get(o) || 0) + 1); });
  return [...n].map(([owner, count]) => ({ owner, count })).sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner));
}
// The project's claims (held by owner, matched loosely, or among the numbers given) and their neighbours.
export function splitClaims(fc, { owner, numbers } = {}) {
  const o = norm(owner), nums = new Set((numbers || []).map((x) => String(x).trim().toUpperCase()).filter(Boolean));
  const project = [], neighbours = [];
  (fc?.features || []).forEach((f) => {
    const p = f.properties || {}, mine = (nums.size && nums.has(String(p.number ?? '').toUpperCase())) || (!!o && norm(p.owner).includes(o));
    (mine ? project : neighbours).push(f);
  });
  return { project: { type: 'FeatureCollection', features: project }, neighbours: { type: 'FeatureCollection', features: neighbours } };
}
// Is the lon/lat point inside the claim (its outer rings, less their holes)?
export function claimContains(f, [x, y]) {
  const g = f?.geometry, polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  const inRing = (r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  return polys.some((rs) => rs.length && inRing(rs[0]) && !rs.slice(1).some(inRing));
}
