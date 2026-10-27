/* ExplorationMaps · 3D Tour — package builder
 * buildTourPackage(input) -> TourPackage (JSON for the viewer template)
 * Pure TS, one dependency (proj4). Runs in the browser or Node.
 */
import proj4 from 'proj4';
import type { TourInput, TourPackage, Collar, Survey, Ring } from './types';
import { footprintRings } from './footprint';

const DEFAULT_COLORS = ['#8fbcd4', '#f2c14e', '#ee8a2a', '#d33a2f'];
export const GRADE_PRESETS: Record<string, number[]> = {
  Cu: [0.1, 0.2, 0.5, 1.0],     // %
  Au: [0.1, 0.5, 1.0, 5.0],     // g/t
  Ag: [5, 25, 50, 150],         // g/t
  U3O8: [0.05, 0.1, 0.5, 1.0],  // %
  Li2O: [0.5, 1.0, 1.5, 2.0],   // %
  Mo: [0.01, 0.03, 0.06, 0.1],  // %
};

/* ---------- projections ---------- */
export function ensureDef(code: string) {
  if (proj4.defs(code)) return;
  const m = /^EPSG:(\d+)$/.exec(code);
  if (!m) throw new Error(`Unknown CRS ${code}: register it with proj4.defs() first`);
  const n = +m[1];
  if (n >= 26901 && n <= 26923) proj4.defs(code, `+proj=utm +zone=${n - 26900} +datum=NAD83 +units=m +no_defs`);
  else if (n >= 32601 && n <= 32660) proj4.defs(code, `+proj=utm +zone=${n - 32600} +datum=WGS84 +units=m +no_defs`);
  else if (n >= 32701 && n <= 32760) proj4.defs(code, `+proj=utm +zone=${n - 32700} +south +datum=WGS84 +units=m +no_defs`);
  else throw new Error(`Register ${code} with proj4.defs() first`);
}
function isUTM(code: string) { const n = +(/^EPSG:(\d+)$/.exec(code)?.[1] ?? 0); return (n >= 26901 && n <= 26923) || (n >= 32601 && n <= 32660) || (n >= 32701 && n <= 32760); }

/* ---------- desurvey: balanced-tangential integration of linearly interpolated az/dip (≈ minimum curvature) ---------- */
type V3 = [number, number, number];
function desurvey(c: Collar, surveys: Survey[], stepM = 2): { md: number[]; pts: V3[] } {
  const st = [{ depth: 0, azimuth: c.azimuth, dip: c.dip }, ...surveys.filter(s => s.depth > 0 && s.depth <= c.depth).sort((a, b) => a.depth - b.depth)];
  if (st[st.length - 1].depth < c.depth) st.push({ ...st[st.length - 1], depth: c.depth });
  const dir = (az: number, dip: number): V3 => { const I = (90 + dip) * Math.PI / 180, A = az * Math.PI / 180; return [Math.sin(I) * Math.sin(A), Math.sin(I) * Math.cos(A), -Math.cos(I)]; };
  const md = [0], pts: V3[] = [[c.x, c.y, c.z]];
  for (let k = 1; k < st.length; k++) {
    const a = st[k - 1], b = st[k], L = b.depth - a.depth; if (L <= 0) continue;
    let da = b.azimuth - a.azimuth; if (da > 180) da -= 360; if (da < -180) da += 360;   // shortest way round
    const n = Math.max(1, Math.ceil(L / stepM));
    for (let i = 1; i <= n; i++) {
      const t0 = (i - 1) / n, t1 = i / n, h = L / n;
      const d0 = dir(a.azimuth + da * t0, a.dip + (b.dip - a.dip) * t0), d1 = dir(a.azimuth + da * t1, a.dip + (b.dip - a.dip) * t1);
      const p = pts[pts.length - 1];
      pts.push([p[0] + h * (d0[0] + d1[0]) / 2, p[1] + h * (d0[1] + d1[1]) / 2, p[2] + h * (d0[2] + d1[2]) / 2]);
      md.push(a.depth + L * t1);
    }
  }
  return { md, pts };
}
function slice(md: number[], pts: V3[], from: number, to: number): V3[] {
  const at = (d: number): V3 => {
    d = Math.max(0, Math.min(md[md.length - 1], d)); let i = 1; while (i < md.length - 1 && md[i] < d) i++;
    const t = (d - md[i - 1]) / ((md[i] - md[i - 1]) || 1), a = pts[i - 1], b = pts[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  const out: V3[] = [at(from)]; for (let i = 0; i < md.length; i++) if (md[i] > from && md[i] < to) out.push(pts[i]); out.push(at(to)); return out;
}

/* ---------- main ---------- */
export function buildTourPackage(inp: TourInput): TourPackage {
  const warnings: string[] = [];
  inp = { ...inp, assays: (inp.assays || []).filter(a=>Object.prototype.hasOwnProperty.call(a.values,inp.grade.field)) };
  if (!inp.assays.some(a=>Number.isFinite(a.values[inp.grade.field]))) throw new Error('The selected grade field has no measured numeric values.');
  validateInput(inp);
  ensureDef(inp.crs);
  // working CRS: the collar UTM zone, or derive one from the collar centroid
  let W = inp.crs;
  const valid = inp.collars.filter(c => Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z));
  inp.collars.filter(c => !valid.includes(c)).forEach(c => warnings.push(`${c.holeId}: missing collar coordinates, not mapped`));
  if (!valid.length) throw new Error('No collars with coordinates');
  if (!isUTM(W)) {
    const ll = valid.map(c => proj4(inp.crs, 'EPSG:4326', [c.x, c.y]));
    const lon = ll.reduce((a, p) => a + p[0], 0) / ll.length, lat = ll.reduce((a, p) => a + p[1], 0) / ll.length;
    const zone = Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1));
    W = `EPSG:${(lat >= 0 ? 32600 : 32700) + zone}`; ensureDef(W);
  }
  const toW = (x: number, y: number) => inp.crs === W ? [x, y] : proj4(inp.crs, W, [x, y]);
  const llToW = (lon: number, lat: number) => proj4('EPSG:4326', W, [lon, lat]);
  const wToLL = (x: number, y: number) => proj4(W, 'EPSG:4326', [x, y]) as [number, number];

  // claims -> working CRS rings
  const rings: Ring[] = [];
  for (const f of inp.claims.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) for (const ring of p) rings.push(ring.map(([lo, la]) => llToW(lo, la) as [number, number]));
  }
  const collarsW = valid.map(c => { const [x, y] = toW(c.x, c.y); return { ...c, x, y }; });
  const ids = new Set<string>(); collarsW.forEach(c => { if (ids.has(c.holeId)) warnings.push(`${c.holeId}: duplicate hole ID`); ids.add(c.holeId); });

  // origin + extent
  const cx = rings.flat().map(p => p[0]).concat(collarsW.map(c => c.x)), cy = rings.flat().map(p => p[1]).concat(collarsW.map(c => c.y));
  const bb = cx.reduce((b, x, i) => [Math.min(b[0], x), Math.min(b[1], cy[i]), Math.max(b[2], x), Math.max(b[3], cy[i])], [Infinity, Infinity, -Infinity, -Infinity]);
  if (!bb.every(Number.isFinite) || Math.max(bb[2]-bb[0],bb[3]-bb[1]) > 200000) throw new Error('Use project claims and collars within a 200 km extent for a browser tour.');
  const zs = collarsW.map(c => c.z).sort((a, b) => a - b);
  const OX = Math.round((bb[0] + bb[2]) / 200) * 100, OY = Math.round((bb[1] + bb[3]) / 200) * 100, OZ = Math.round(zs[zs.length >> 1] / 100) * 100;
  const L = (x: number, y: number, z: number): V3 => [r1(x - OX), r1(z - OZ), r1(-(y - OY))];

  // main target
  const counts = new Map<string, number>(); collarsW.forEach(c => c.target && counts.set(c.target, (counts.get(c.target) || 0) + 1));
  let main = inp.mainTarget === '' ? undefined : inp.mainTarget || [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  let inMain: (c: Collar) => boolean;
  if (main) inMain = c => c.target === main;
  else { inMain = () => true; main = 'Drilling'; }
  if (!collarsW.some(inMain)) throw new Error('The selected target has no mapped collars.');

  // holes
  const sv = new Map<string, Survey[]>(); (inp.surveys || []).forEach(s => { if (!sv.has(s.holeId)) sv.set(s.holeId, []); sv.get(s.holeId)!.push(s); });
  const geo = new Map<string, { md: number[]; pts: V3[]; idx: number }>();
  const holes: TourPackage['holes'] = [];
  collarsW.forEach(c => {
    const sourcePath = inp.paths?.[c.holeId];
    if (!sv.has(c.holeId)) warnings.push(`${c.holeId}: no downhole survey; ${sourcePath ? 'using the current figure path' : 'drawn straight from collar az/dip'}`);
    if ((sv.get(c.holeId)||[]).some(s=>s.depth>c.depth)) warnings.push(c.holeId+': survey station beyond recorded hole depth; tour stops at recorded depth.');
    let g;
    if (sourcePath?.length) {
      const md = sourcePath.map(p=>p.depth), pts = sourcePath.map(p=>{const [x,y]=toW(p.x,p.y);return [x,y,p.z] as V3;});
      const keep = md.map((d,i)=>({d,p:pts[i]})).filter(o=>o.d < c.depth);
      g = {md:[...keep.map(o=>o.d),c.depth],pts:[...keep.map(o=>o.p),slice(md,pts,c.depth,c.depth)[0]]};
    } else g = desurvey(c, sv.get(c.holeId) || []);
    geo.set(c.holeId, { ...g, idx: holes.length });
    const p: number[] = []; let last = -1e9;
    g.md.forEach((d, i) => { if (d - last >= 10 || i === g.md.length - 1) { p.push(...L(...g.pts[i])); last = d; } });
    holes.push({ n: c.holeId, yr: c.year, pv: !!c.provisional, sm: inMain(c), p });
  });

  // grade bins + intervals
  const bins = inp.grade.bins!, colors = inp.grade.colors || DEFAULT_COLORS;
  const binOf = (v: number | null | undefined) => { if (v == null || !Number.isFinite(v)) return -1; let k = -1; bins.forEach((t, i) => { if (v >= t) k = i; }); return k; };
  const thr = inp.footprintThreshold ?? bins[1];
  const runs: TourPackage['runs'] = []; const intercepts: [number, number][][] = [];
  const sorted = [...inp.assays].sort((a, b) => a.holeId < b.holeId ? -1 : a.holeId > b.holeId ? 1 : a.from - b.from);
  let cur: { h: number; b: number; to: number; pts: number[] } | null = null;
  for (const a of sorted) {
    const g = geo.get(a.holeId); if (!g) continue;
    if (a.to > g.md[g.md.length - 1] + 1) warnings.push(`${a.holeId}: assay ${a.from}-${a.to} m extends past hole depth`);
    if (a.from >= g.md[g.md.length - 1]) continue;
    const v = a.values[inp.grade.field], b = binOf(v), seg = slice(g.md, g.pts, a.from, a.to);
    if (v != null && v >= thr && collarsW[g.idx] && inMain(collarsW[g.idx])) intercepts.push(seg.map(p => [p[0], p[1]]));
    if (b >= 0 && cur && cur.h === g.idx && cur.b === b && Math.abs(cur.to - a.from) < 0.000001) { seg.slice(1).forEach(p => cur!.pts.push(...L(...p))); cur.to = a.to; }
    else { if (cur) runs.push([cur.h, cur.pts, cur.b]); cur = b >= 0 ? { h: g.idx, b, to: a.to, pts: seg.flatMap(p => L(...p)) } : null; }
  }
  if (cur) runs.push([cur.h, cur.pts, cur.b]);

  // footprint (generalized plan outline of intercepts >= threshold)
  const fpoly = inp.footprintEnabled ? footprintRings(intercepts).map(r => r.flatMap(([x, y]) => [r1(x - OX), r1(-(y - OY))])) : [];
  if (inp.footprintEnabled) warnings.push('Footprint is a generalized illustration of selected intercepts, not a resource estimate or geological boundary.');

  // terrain extent + tile zooms
  const size = Math.max(bb[2] - bb[0], bb[3] - bb[1]), M = Math.max(900, size * .08);
  const E = [bb[0] - M, bb[1] - M, bb[2] + M, bb[3] + M], ext = Math.max(E[2] - E[0], E[3] - E[1]);
  const step = Math.max(25, Math.ceil(ext / 550 / 5) * 5);
  const lat = wToLL((E[0] + E[2]) / 2, (E[1] + E[3]) / 2)[1], mpp0 = 156543.03 * Math.cos(lat * Math.PI / 180);
  const clampZ = (z: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(z)));
  const demZoom = clampZ(Math.ceil(Math.log2(mpp0 / (step * .75))), 9, 14);
  let imgZoom = clampZ(Math.ceil(Math.log2(mpp0 / (ext / 4096))), 9, 16);
  const tiles = (z: number) => Math.ceil((E[2] - E[0]) / (256 * mpp0 / 2 ** z) + 1) * Math.ceil((E[3] - E[1]) / (256 * mpp0 / 2 ** z) + 1);
  while (imgZoom > 9 && tiles(imgZoom) > 140) imgZoom--;   // keep the main drape to ~140 tiles
  const mainC = collarsW.filter(inMain), mx = mainC.map(c => c.x), my = mainC.map(c => c.y);
  const detailR = Math.max(1200, Math.min(2500, 1.2 * Math.max(Math.max(...mx) - Math.min(...mx), Math.max(...my) - Math.min(...my), 600)));
  const detailZoom = clampZ(Math.ceil(Math.log2(mpp0 / (detailR * 2 / 4096))), imgZoom, 16);

  // labels: main target on the footprint; other targets at their first collar
  const center = collarsW.filter(inMain);
  const labels: TourPackage['config']['labels'] = [{ t: main!, x: r1(center.reduce((n,c)=>n+c.x,0)/center.length-OX), z: r1(-(center.reduce((n,c)=>n+c.y,0)/center.length-OY)), views: [0] }];
  let flip = true;
  [...counts.keys()].filter(t => t !== main).forEach(t => { const c = collarsW.find(o => o.target === t)!; const p = L(c.x, c.y, c.z); labels.push({ t, x: p[0], z: p[2], views: [0], below: flip }); flip = !flip; });
  (inp.labels || []).forEach(l => {
    let x: number, y: number;
    if (l.holeId) { const c = collarsW.find(o => o.holeId === l.holeId); if (!c) return; x = c.x; y = c.y; }
    else if (l.lon != null && l.lat != null) [x, y] = llToW(l.lon, l.lat); else return;
    labels.push({ t: l.text, x: r1(x - OX), z: r1(-(y - OY)), views: l.views || [0], below: l.below });
  });

  const fmt = (n: number) => n >= 10 ? String(n) : n.toFixed(2);
  return {
    v: 1, holes, runs,
    claims: rings.map(r => r.flatMap(([x, y]) => [Math.round(x - OX), Math.round(-(y - OY))])),
    fpoly,
    collars: collarsW.map(c => [...L(c.x, c.y, c.z), inMain(c) ? 1 : 0] as [number, number, number, number]),
    terrain: {
      utm: [Math.round(E[0] - OX), Math.round(-(E[3] - OY)), Math.round(E[2] - OX), Math.round(-(E[1] - OY))],
      corners: [wToLL(E[0], E[1]), wToLL(E[2], E[1]), wToLL(E[0], E[3]), wToLL(E[2], E[3])],
      step, demZoom, imgZoom, detailZoom, detailR: Math.round(detailR),
    },
    config: {
      title: inp.title, tag: main!,
      tabs: inp.tabs || [['The district', 'Claims & terrain'], [main!, 'Drill collars'], ['Below the surface', 'Drilling']],
      legend: { claims: inp.claimsLegend || 'Claims', holes: 'Drill traces', grade: `${inp.grade.field} ${inp.grade.unit}` },
      bins: bins.map((b, i) => [i < bins.length - 1 ? `${fmt(b)}–${fmt(bins[i + 1])}` : `≥${fmt(b)}`, colors[i] || DEFAULT_COLORS[Math.min(i,3)]] as [string, string]),
      labels, imagery: inp.imageryUrl,
    },
    meta: { origin: [OX, OY, OZ], crs: W, holes: holes.length, built: new Date().toISOString(), warnings },
  };
}
const r1 = (v: number) => Math.round(v * 10) / 10;

function validateInput(inp: TourInput) {
  if (!inp?.crs || !inp.claims?.features?.length) throw new Error('Set the collar CRS and add project claims before making a tour.');
  if (!inp.collars?.length || inp.collars.length > 5000 || inp.assays?.length > 200000) throw new Error('Tours support 1–5,000 collars and up to 200,000 assay rows.');
  const ids = new Set<string>();
  for (const c of inp.collars) {
    if (!c.holeId || ids.has(c.holeId)) throw new Error('Collars need unique hole IDs.');
    ids.add(c.holeId);
    if (![c.depth,c.azimuth,c.dip].every(Number.isFinite) || c.depth <= 0 || c.depth > 20000 || Math.abs(c.dip) > 90 || c.azimuth < 0 || c.azimuth > 360) throw new Error(c.holeId + ': check depth, azimuth and dip.');
    const path = inp.paths?.[c.holeId];
    if (path && (path.length < 2 || path[0].depth !== 0 || path.at(-1)!.depth < c.depth || path.some((p,i)=>![p.depth,p.x,p.y,p.z].every(Number.isFinite) || (i>0 && p.depth<=path[i-1].depth)))) throw new Error(c.holeId+': the current figure path is incomplete or invalid.');
  }
  if (inp.collars.reduce((n,c)=>n+Math.ceil(c.depth/2),0) > 1000000) throw new Error('This tour has too much drilling for a single browser export.');
  const bins = inp.grade?.bins;
  if (!bins?.length || bins.length > 8 || bins.some((b,i)=>!Number.isFinite(b) || (i > 0 && b <= bins[i-1]))) throw new Error('Enter increasing numeric grade bins for the selected field and unit.');
  if (inp.footprintEnabled && inp.footprintThreshold != null && !Number.isFinite(inp.footprintThreshold)) throw new Error('Enter a numeric footprint threshold.');
  for (const s of inp.surveys || []) if (![s.depth,s.azimuth,s.dip].every(Number.isFinite) || s.depth < 0 || Math.abs(s.dip)>90) throw new Error(s.holeId + ': invalid survey station.');
  const ends = new Map<string, number>();
  for (const a of [...inp.assays].sort((a,b)=>a.holeId.localeCompare(b.holeId)||a.from-b.from)) {
    if (![a.from,a.to].every(Number.isFinite) || a.from < 0 || a.to <= a.from || a.from < (ends.get(a.holeId) ?? 0)) throw new Error(a.holeId + ': check overlapping or invalid assay intervals.');
    ends.set(a.holeId,a.to);
  }
  for (const f of inp.claims.features) {
    if (!['Polygon','MultiPolygon'].includes(f.geometry?.type)) throw new Error('Project claims must be polygons.');
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) for (const r of p) if (r.length < 4 || r.some(v=>!Number.isFinite(v[0])||!Number.isFinite(v[1])||Math.abs(v[0])>180||Math.abs(v[1])>85)) throw new Error('Claim coordinates must be valid WGS84 longitude/latitude.');
  }
  if (inp.imageryUrl && !/^https:\/\//i.test(inp.imageryUrl)) throw new Error('Imagery needs an HTTPS tile URL.');
}
