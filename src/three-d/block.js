// The block section for Exploration Maps 3D: a cut-away block of a few chosen holes, as on a company's target
// figure. An opaque block of interpreted geology under the satellite terrain, seen obliquely so the front and one
// side face show; thin black traces with bold IDs at the collars, grade bars along the holes and bracketed
// intercepts on the front face, a heading painted on it, and the legend, logo, depth ticks and scale bar drawn in
// the side face's perspective. Loaded by studio.js for a figure with holes shown (S.holesShown), a block look
// (S.block) or a heading on the block; applyPreset("blockSection") sets it all up with settings that already
// exist (geology, tags, callouts, the block), which can each be changed after.
//
// S.holesShown: null (every hole) or the hole IDs drawn; hidden holes lose their trace, ID, bars and callouts but
// still shape the geology and the grade shell. S.block: null, or
//   { furniture: true   the legend, logo, depth ticks and scale bar on the side face (the page's where it is too
//                       foreshortened or they do not fit),
//     traces: "overlay" thin black traces drawn over the faces (the tubes hidden), the grade bars over them too,
//     brackets: "plain" a bracket and bold "154 m @ 0.51% Cu" text beside the hole (tags.js), or "card",
//     page: "bare"      the block alone on white: no title block, compass or notes, the credits small; "clean": no
//                       title block while the block carries a heading; "full"; or "side": a large title block at the
//                       top left (company line, title, subtitle, info line), the logo and legend card on the page at
//                       the right, no heading on the block (round 5G),
//     info: the side title's muted last line (page "side"; unset: "3D cutaway · looking SW"),
//     hist: { side: "face" (in the front face's plane) | "screen", scale: "linear" | "log", halo, length,
//             palette: "orange" (four classes, pale yellow to deep orange, as the reference) | "bins",
//             style: "spikes" (one thin spike per assay, linear in grade, as the reference) | "bars" } }.
import { fitLine } from './section-geometry.js';
import { ORANGE } from './tags.js';

let H, S;
export function init(host) { H = host; S = host.S; }

export const BLOCK = { furniture: true, traces: 'overlay', brackets: 'plain', page: 'bare', hist: { side: 'face', style: 'spikes', scale: 'linear', halo: false, length: 1, palette: 'orange' } };
const FACES = ['S', 'E', 'N', 'W'], RAD = Math.PI / 180, LOOK = { S: 0, E: 270, N: 180, W: 90 }; // looking at each face from outside
const dx2 = (g) => (g.b[0] - g.a[0]) ** 2 + (g.b[1] - g.a[1]) ** 2;
const at = (g, u) => [g.a[0] + (g.b[0] - g.a[0]) * u, g.a[1] + (g.b[1] - g.a[1]) * u];
const hyp = (v) => Math.hypot(v[0], v[1]);
// A round length for a scale bar or depth step: the largest of these not over max.
export const roundBelow = (max, list = [10, 20, 25, 50, 75, 100, 150, 200, 250, 300, 500, 750, 1000, 1500, 2000, 2500, 5000]) => list.filter((d) => d <= max).pop() || null;
// Depth ticks down a corner of the side face: below its top, every step, clear of the base.
export function depthTicks(top, base, clear) {
  const step = roundBelow((top - base) / 3.2); if (!step) return [];
  const out = []; for (let d = step; top - d >= base + clear; d += step) out.push(d);
  return out;
}

// ---------- the holes shown ----------
function holeIds(ids) {
  if (ids === null || ids === 'all') return null;
  if (!Array.isArray(ids) || !ids.length) throw new Error('holes must be a list of hole IDs, or null for every hole.');
  const known = new Set(H.project.holes.map((h) => h.id)), bad = ids.map(String).filter((id) => !known.has(id));
  if (bad.length) throw new Error(`No hole ${bad.map((b) => `"${b}"`).join(', ')}.`);
  return [...new Set(ids.map(String))];
}
const redraw = () => { H.rebuild(true); H.setStyle({}); H.renderExtUI(); };
export function setHolesShown(ids) {
  if (!H.G) throw new Error('Load data first.');
  S.holesShown = holeIds(ids); redraw();
  H.status(S.holesShown ? `${S.holesShown.length} hole${S.holesShown.length === 1 ? '' : 's'} shown; the others are hidden (they still shape the geology).` : 'Every hole shown.');
}

// ---------- the look's settings ----------
function patch(b, o) {
  if (o.furniture !== undefined) b.furniture = !!o.furniture;
  if (o.traces !== undefined) { if (!['overlay', 'tubes'].includes(o.traces)) throw new Error('traces must be "overlay" (thin black lines over the faces) or "tubes" (the coloured tubes).'); b.traces = o.traces; }
  if (o.brackets !== undefined) { if (!['plain', 'card'].includes(o.brackets)) throw new Error('brackets must be "plain" (a bracket and bold text) or "card".'); b.brackets = o.brackets; }
  if (o.page !== undefined) { if (!['bare', 'clean', 'full', 'side'].includes(o.page)) throw new Error('page must be "bare" (the block alone, credits only), "clean" (no title block while the block has a heading), "full" or "side" (a large title block at the left, the logo and legend at the right).'); b.page = o.page; }
  if (o.info !== undefined) { if (o.info === null) delete b.info; else b.info = String(o.info).slice(0, 160); }
  if (o.hist !== undefined) {
    const h = o.hist || {}, x = { ...(b.hist || BLOCK.hist) };
    if (h.side !== undefined) { if (!['face', 'screen'].includes(h.side)) throw new Error('hist.side must be "face" (in the face\'s plane) or "screen".'); x.side = h.side; }
    if (h.scale !== undefined) { if (!['linear', 'log'].includes(h.scale)) throw new Error('hist.scale must be "linear" or "log".'); x.scale = h.scale; }
    if (h.halo !== undefined) x.halo = !!h.halo;
    if (h.style !== undefined) { if (!['spikes', 'bars'].includes(h.style)) throw new Error('hist.style must be "spikes" (one thin spike per assay) or "bars" (merged bars).'); x.style = h.style; }
    if (h.palette !== undefined) { if (!['orange', 'bins'].includes(h.palette)) throw new Error('hist.palette must be "orange" (pale yellow to deep orange) or "bins" (the figure\'s grade colours).'); x.palette = h.palette; }
    if (h.length !== undefined) { const v = +h.length; if (!Number.isFinite(v)) throw new Error('hist.length must be a number, 0.3-3 (1: the usual length).'); x.length = Math.max(0.3, Math.min(3, v)); }
    b.hist = x;
  }
}
export function setBlock(o) {
  if (!H.G) throw new Error('Load data first.');
  if (o === null) S.block = null;
  else {
    if (!o || typeof o !== 'object') throw new Error('setBlock takes { furniture, traces, brackets, page, hist, holes }, or null to turn the block look off.');
    const b = structuredClone(S.block || BLOCK), was = S.block?.page; patch(b, o);
    if (o.holes !== undefined) S.holesShown = holeIds(o.holes);
    S.block = b;
    // To or from the side title, the block is framed again for the room the title takes.
    if ((was === 'side') !== (b.page === 'side')) { redraw(); const c = H.getCam(); frame({ azimuth: c.azimuth, plunge: c.plunge, zoom: c.zoom }); }
  }
  redraw();
}

// ---------- the preset ----------
// The holes to start from: the section's chosen holes, else the callout holes nearest the section line (four).
function pick() {
  const ch = S.section?.holes; if (ch?.length > 1) return ch.slice(0, 6);
  const [A, B] = H.sectionEnds(), L = Math.hypot(B.x - A.x, B.y - A.y) || 1, off = (p) => Math.abs(((p.x - A.x) * (A.y - B.y) + (p.y - A.y) * (B.x - A.x)) / L);
  const hs = [...new Set(H.shownCallouts().map((c) => c.h))];
  const list = (hs.length > 1 ? hs : H.project.holes).slice().sort((p, q) => off(p.posAt(p.len / 2)) - off(q.posAt(q.len / 2)));
  return list.slice(0, 4).map((h) => h.id);
}
// The camera at a preset view, pulled back until the block clears the frame (as studio.js frameView).
// With no title block the block then moves up, centred between the top margin and the footer, and comes closer
// (room above for the IDs) until it fills about 84% of that height or 92% of the width.
function frame(v) {
  const G = H.G; H.aim.set(0, 0, 0); G.fit = 1; H.setCamera(v, true);
  for (let i = 0; i < 4; i++) { const f = H.blockOverflow(); if (f <= 1.005) break; G.fit *= f * 1.01; H.setCamera(v, true); }
  if (S.block?.page === 'full') return;
  // The side title: the block under the title block and clear of the legend at the right.
  const [W, Hf] = H.frame(), u = Math.sqrt(W * Hf) / 900, side = S.block.page === 'side', top = side ? (S.company ? 150 : 128) * u : 80 * u, bot = Hf - (S.block.page === 'bare' ? 36 : 64) * u, B = G.B, up = new H.aim.constructor(0, 1, 0);
  const box = () => { const ps = []; [[B.x0, B.y0], [B.x1, B.y0], [B.x1, B.y1], [B.x0, B.y1]].forEach(([x, y]) => { ps.push(H.proj(G.V(x, y, B.z0)), H.proj(G.V(x, y, G.surf(x, y)))); }); return [Math.min(...ps.map((q) => q[0])), Math.min(...ps.map((q) => q[1])), Math.max(...ps.map((q) => q[0])), Math.max(...ps.map((q) => q[1]))]; };
  for (let i = 0; i < 4; i++) {
    H.camera.updateMatrixWorld(); const b = box(), t = H.controls.target, ppu = H.proj(t.clone().add(up))[1] - H.proj(t)[1];
    if (ppu) H.aim.y += ((b[1] + b[3]) / 2 - (top + bot) / 2) / ppu;
    const k = Math.min(0.84 * (bot - top) / (b[3] - b[1]), (side ? 0.7 : 0.92) * W / (b[2] - b[0]));
    v = { ...v, zoom: Math.max(40, Math.min(250, H.getCam().zoom * Math.min(k, 1.3))), pan: H.aim.toArray() }; H.setCamera(v, true);
  }
}
// The block around the holes: their traces with a margin, at least 75% as deep (across) as it is long along
// them, so the side face shows; the base a little under the deepest of them.
export function extentAround(paths, along) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  paths.forEach((ps) => ps.forEach((p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }));
  const pad = Math.max(40, 0.18 * Math.max(x1 - x0, y1 - y0)), e = { x0: x0 - pad, x1: x1 + pad, y0: y0 - pad, y1: y1 + pad }, k = along === 'x' ? ['y0', 'y1', 'x0', 'x1'] : ['x0', 'x1', 'y0', 'y1'];
  const need = 0.75 * (e[k[3]] - e[k[2]]) - (e[k[1]] - e[k[0]]); if (need > 0) { e[k[0]] -= need / 2; e[k[1]] += need / 2; }
  e.z0 = z0 - Math.max(20, 0.06 * (z1 - z0));
  return Object.fromEntries(Object.entries(e).map(([kk, v]) => [kk, Math.round(v)]));
}
// Where the heading goes on the front face, [u, v] low down: the first spot (the right first) whose box on screen
// no hole shown, or its grade bars to its right, crosses; else the one crossed least.
export function headingU(face, hs) {
  H.camera.updateMatrixWorld();
  const G = H.G, g = H.faceGeom(face), z0 = G.B.z0, [W] = H.frame(), bw = 0.08 * W, scr = (uu, f) => { const p = at(g, uu); return H.proj(G.V(p[0], p[1], z0 + f * (G.surf(p[0], p[1]) - z0))); };
  const pts = hs.flatMap((h) => h.path.filter((p, i) => i % 3 === 0).map((p) => H.proj(G.V(p.x, p.y, p.z)))), wide = Math.abs(scr(1, 0.2)[0] - scr(0, 0.2)[0]) * 0.19, m = at(g, 0.5), tall = Math.abs(H.proj(G.V(m[0], m[1], z0))[1] - H.proj(G.V(m[0], m[1], z0 + 0.09 * Math.sqrt(dx2(g))))[1]); // a heading is about 13% of the face's width tall, and a margin
  const hits = ([c, v]) => { const [x, y] = scr(c, v); return pts.filter((q) => q[1] > y - tall && q[1] < y + tall && q[0] + bw > x - wide && q[0] < x + wide).length; };
  const cands = [0.2, 0.13, 0.08].flatMap((v) => [0.78, 0.72, 0.66, 0.6, 0.5, 0.3, 0.24].map((c) => [c, v]));
  return cands.find((c) => !hits(c)) ?? cands.reduce((a, c) => (hits(c) < hits(a) ? c : a));
}
export async function applyPreset(name = 'blockSection', o = {}) {
  if (name !== 'blockSection') throw new Error('applyPreset takes "blockSection": a cut-away block of chosen holes, as on a target figure.');
  if (!H.G) throw new Error('Load data first.');
  const ids = o.holes !== undefined ? holeIds(o.holes) : S.holesShown || pick(), hs = H.project.holes.filter((h) => !ids || ids.includes(h.id));
  S.holesShown = ids;
  // The front face runs along the holes; the camera stays on its side of the block.
  const f = fitLine(hs.map((h) => h.posAt(h.len / 2))), az = f ? f.az : S.secAz, ew = Math.abs(Math.sin(az * RAD)) >= Math.abs(Math.cos(az * RAD)), cam = H.camera.position;
  const front = o.face && LOOK[o.face] !== undefined ? o.face : ew ? (cam.z > 0 ? 'S' : 'N') : (cam.x > 0 ? 'E' : 'W');
  const b = structuredClone(BLOCK); patch(b, o.block || {}); S.block = b;
  // Model shapes inside the block would only be hidden by its opaque faces, and listed in the legend: off.
  H.setStyle({ meshes: Object.fromEntries(Object.keys(S.meshes).map((k) => [k, { show: false }])), blockExtent: extentAround(hs.map((h) => h.path), ew ? 'x' : 'y'), blockStyle: 'solid', histograms: true, ribbons: false, coPlacement: 'bracket', inset: false, ...(H.hasRole('published') ? { calloutMode: 'published' } : {}), ...(H.geo() ? { terrain: 'satellite' } : {}) });
  await H.api.setTags({ at: 'collar', style: 'plain', idMode: 'all', emphasis: 'none' });
  if (H.hasRole('litho')) await H.api.setGeology({ enabled: true, faces: 'all', opacity: 1, contacts: true, labels: true, labelStyle: 'caps', blend: 1, fade: 0.3, fadeDir: 'down' });
  // Framed once the real terrain for the new block has loaded (it sets the block's height).
  await globalThis.EM3D?.terrainReady?.();
  frame({ azimuth: (LOOK[front] - 38 + 360) % 360, plunge: 20, zoom: 120 }); // no title block: closer, unless the block would leave the frame
  // The heading on the front face, from the figure's title and subtitle (kept if the block has one); none under a side title.
  if (b.page !== 'side' && !S.wallLabels.some((l) => l.size === 'heading')) {
    const at2 = headingU(front, hs), t = S.title.split('·').map((x) => x.trim()).filter(Boolean), n = S.wallLabels.reduce((mx, l) => Math.max(mx, +String(l.id).replace(/\D/g, '') || 0), 0) + 1;
    S.wallLabels.push({ id: `W${n}`, text: [t[t.length - 1] || S.title || 'TARGET ZONE', S.subtitle].filter(Boolean).join('\n'), face: front, u: at2[0], v: at2[1], size: 'heading', scale: 1, rotation: 0, color: null });
  }
  H.buildWallLabels(); H.setStyle({}); H.renderExtUI();
  H.status(`Block section: ${hs.length} hole${hs.length === 1 ? '' : 's'}, the ${{ N: 'north', S: 'south', E: 'east', W: 'west' }[front]} face in front. Change anything in Layout.`);
}

// ---------- the scene: traces over the faces ----------
export function sync() {
  const G = H.G; if (!G) return;
  // A heading drawn as a plain title before this module loaded is drawn again as a heading.
  if (G.wallLabelMeshes?.some((m) => m.userData.L.size === 'heading' && !m.userData.hd)) H.buildWallLabels();
  const over = S.block?.traces === 'overlay';
  if (over) G.tubes.visible = G.tubesP.visible = false;
  // The block's outline is the first line set added to the scene; the traces follow it.
  H.root.children.filter((o) => o.isLineSegments).slice(1).forEach((o) => { o.visible = !over; });
}
// A heading on the block (wall label size "heading"): a bold title over smaller subtitle lines, in capitals,
// right-aligned. Lines from the text's line breaks, or " | " typed in the one-line box. lines: its height in title lines.
export function headCanvas(L, sans, ink) {
  const lines = String(L.text).split(/\n|\s*\|\s*/).map((t) => t.trim().toUpperCase()).filter(Boolean), px = 96, sub = px * 0.46, c = document.createElement('canvas'), g = c.getContext('2d');
  const fontOf = (i) => { g.font = `${i ? 500 : 800} ${i ? sub : px}px ${sans}`; if ('letterSpacing' in g) g.letterSpacing = `${i ? sub * 0.08 : px * 0.03}px`; };
  const ws = lines.map((t, i) => { fontOf(i); return g.measureText(t).width; }), lh = (i) => (i ? sub * 1.25 : px * 1.1), tall = lines.reduce((s, t, i) => s + lh(i), 0);
  c.width = Math.ceil(Math.max(1, ...ws) + px * 0.4); c.height = Math.ceil(tall + px * 0.3);
  let y = px * 0.15; g.fillStyle = ink; g.textAlign = 'right'; g.textBaseline = 'middle';
  lines.forEach((t, i) => { fontOf(i); y += lh(i) / 2; g.fillText(t, c.width - px * 0.2, y); y += lh(i) / 2; });
  return { c, lines: tall / (px * 1.15) };
}

// ---------- the overlay: traces, and the side face's furniture ----------
// Before the collars: the shown holes' traces (thin black lines) when they go over the faces; then what goes on
// the side face, so studio.js leaves the logo, title block, legend cards, scale bar or elevation ticks off the page.
export function begin(ctx, K) {
  const B = S.block; if (!B || !H.G) return null;
  if (B.traces === 'overlay') traces(ctx, K);
  const F = B.furniture !== false ? plan(ctx, K) : null;
  const bare = B.page === 'bare';
  return { head: B.page !== 'full' && S.wallLabels.some((l) => l.size === 'heading' || l.size === 'title'), title: B.page === 'side' && (() => sideTitle(ctx, K)), bare, foot: bare && ((credits) => foot(ctx, K, credits)), logo: !!F?.logo, legend: !!F?.legend, ticks: !!F?.ticks, scale: !!F?.scale, draw: (lay) => F && furniture(ctx, K, lay, F) };
}
// The side title's last line: S.block.info, else the view ("3D cutaway · looking SW").
export const compass8 = (az) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((az % 360) + 360) % 360) / 45) % 8];
const infoLine = () => S.block.info ?? `3D cutaway · looking ${compass8(H.getCam().azimuth)}`;
// The side title (page "side"), top left with no frame: the company line in small tracked capitals in the accent
// colour, the title large and bold in the primary colour, the subtitle, an accent bar beside those three, and a muted
// info line. Returns its foot, for the layout pass.
function sideTitle(ctx, K) {
  const { u, m, font } = K, [W] = H.frame(), x = m + 18 * u, maxW = 0.55 * W, one = (t) => H.fitText(ctx, t, maxW);
  let y = m; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  if (S.company) { font(800, 13); H.setSpacing(ctx, 1.8 * u); ctx.fillStyle = S.accent; y += 13 * u; ctx.fillText(one(S.company.toUpperCase()), x, y); H.setSpacing(ctx, 0); y += 9 * u; }
  let ts = 50; font(800, ts); while (ts > 24 && ctx.measureText(S.title).width > maxW) font(800, --ts);
  y += ts * 0.86 * u; ctx.fillStyle = H.pri(); ctx.fillText(one(S.title), x, y);
  if (S.subtitle) { font(700, 21); ctx.fillStyle = H.INK; y += 31 * u; ctx.fillText(one(S.subtitle), x, y); }
  ctx.fillStyle = S.accent; ctx.fillRect(m, m, 5 * u, y + 7 * u - m);
  const info = infoLine(); if (info) { font(400, 13.5); ctx.fillStyle = H.MUTED; y += 27 * u; ctx.fillText(one(info), x, y); }
  return y + 14 * u;
}
// A bare block section's foot: the sources (imagery, elevation) and the Exploration Maps credit, small, bottom right.
// Returns the footer's top for the layout pass.
function foot(ctx, K, credits) {
  const { u, m, font } = K, [W, Hf] = H.frame(), t = [...credits, ...(S.credit ? ['Made with Exploration Maps'] : [])].join(' · ');
  if (t) { font(400, 9.5); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = H.MUTED; ctx.fillText(t, W - m, Hf - 14 * u); ctx.textAlign = 'left'; }
  return Hf - 30 * u;
}
// The legend's assay rows in the bars' orange palette (studio.js legendSecs), highest first; null with the usual colours.
export function assayRows() {
  if (!S.histograms || S.block?.hist?.palette !== 'orange' || S.block.hist.side !== 'face') return null;
  const b = S.bins;
  return [[`≥ ${b[3]}`, ORANGE[3]], [`${b[1]} – ${b[3]}`, ORANGE[2]], [`${b[0]} – ${b[1]}`, ORANGE[1]], [`< ${b[0]}`, ORANGE[0]]];
}
function traces(ctx, K) {
  const G = H.G, { u } = K;
  H.project.holes.filter(H.holeOn).forEach((h) => {
    const pts = h.path.map((p) => H.proj(G.V(p.x, p.y, p.z))); if (pts.some((p) => p[2] > 1)) return;
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.lineJoin = 'round';
    ctx.setLineDash(h.prov || h.planned ? [6 * u, 4 * u] : []); ctx.strokeStyle = h.planned ? H.pri() : H.INK; ctx.lineWidth = 0.85 * u; ctx.stroke(); ctx.setLineDash([]); // ~1.5 px at 2000 px wide
  });
}
// The screen frame at (uu, z) on face g: P, and the screen vectors per metre along the face (a, left to right as seen
// from outside) and downward (b).
function frameAt(F, uu, z) {
  const G = H.G, p = at(F.g, uu), q = at(F.g, uu + 1 / F.len), P = H.proj(G.V(p[0], p[1], z)), A = H.proj(G.V(q[0], q[1], z)), D = H.proj(G.V(p[0], p[1], z - 1));
  return { P, a: [A[0] - P[0], A[1] - P[1]], b: [D[0] - P[0], D[1] - P[1]] };
}
// Draws fn in the face's perspective about (uu, z): x along the face, y down, one unit a screen pixel up and down.
// Returns the screen box of the local rectangle [x0, y0, x1, y1].
function onFace(ctx, F, uu, z, r, fn) {
  const { P, a, b } = frameAt(F, uu, z), k = hyp(b), m = [a[0] / k, a[1] / k, b[0] / k, b[1] / k, P[0], P[1]];
  if (fn) { ctx.save(); ctx.transform(...m); fn(); ctx.restore(); }
  const ps = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  return [Math.min(...ps.map((q) => q[0])), Math.min(...ps.map((q) => q[1])), Math.max(...ps.map((q) => q[0])), Math.max(...ps.map((q) => q[1]))];
}
// The side face, and what fits on it: of the two faces toward the camera, the one to the right on screen; none when
// it is seen too nearly edge-on (under 150 px across, or under a quarter as wide as tall per metre).
function plan(ctx, K) {
  const G = H.G, { u } = K, eye = H.camera.position, z0 = G.B.z0, ht = G.zmax - z0;
  const near = FACES.map((f) => ({ f, g: H.faceGeom(f) })).filter(({ g }) => { const m = at(g, 0.5); return g.n.dot(eye.clone().sub(G.V(m[0], m[1], z0 + ht / 2))) > 0; });
  if (near.length < 2) return null;
  const base = (g, uu) => { const p = at(g, uu); return H.proj(G.V(p[0], p[1], z0)); };
  const { f, g } = near.map((x) => ({ ...x, c: base(x.g, 0.5)[0] })).sort((p, q) => q.c - p.c)[0], len = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
  const F = { f, g, len }, top = (uu) => { const p = at(g, uu); return G.surf(p[0], p[1]); }, b0 = base(g, 0), b1 = base(g, 1), wpx = b1[0] - b0[0];
  const mid = frameAt(F, 0.5, z0 + 0.4 * (top(0.5) - z0)), fsh = hyp(mid.a) / hyp(mid.b);
  if (b0[2] > 1 || b1[2] > 1 || wpx < 150 * u || fsh < 0.25 || Math.abs(b1[1] - b0[1]) > 1.2 * wpx) return null;
  const lowTop = (ua, ub) => Math.min(...[0, 0.25, 0.5, 0.75, 1].map((t) => top(ua + (ub - ua) * t)));
  // The legend: one card, the layers first (lithology), its right edge near the face's far edge, its foot near the
  // base; drawn smaller (to 58%) where it would not fit at full size. hf: the face's height under its lowest top.
  const hf = lowTop(0.05, 0.98) - z0, ext = H.extSections(), secs = [...ext, ...H.legendSecs().filter((s) => s.key !== 'holes' || s.rows.length > 1)];
  // Two layouts: one card, or the layers' card (lithology) beside the rest, which is lower and wider.
  const rest = secs.filter((x) => !ext.includes(x)), gap = 10 * u;
  const layout = (groups) => { let x = 0; const cards = groups.filter((g) => g.length).map((g) => { const [w, h] = H.cardSize(ctx, K, g), c = { secs: g, x, w, h }; x += w + gap; return c; }); return { cards, w: x - gap, h: Math.max(...cards.map((c) => c.h)) }; };
  const tries = secs.length && S.block.page !== 'side' ? [[layout([secs]), [1, 0.85, 0.7]], ...(ext.length && rest.length ? [[layout([ext, rest]), [1, 0.85, 0.7]]] : []), [layout([secs]), [0.6]]] : [];
  for (const [L, scs] of tries) {
    for (const sc of scs) {
      const { w, h } = L; let k = hyp(frameAt(F, 0.75, z0 + 0.3 * hf).b), span = w * sc / k / F.len; const uc = 0.96 - span / 2;
      k = hyp(frameAt(F, uc, z0 + 0.3 * hf).b); span = w * sc / k / F.len;
      const zc = z0 + 0.05 * hf + h * sc / k / 2;
      if (uc - span / 2 > 0.16 && zc + h * sc / k / 2 < z0 + 0.8 * hf) { F.legend = { uc, zc, w, h, sc, cards: L.cards, k, span }; break; }
    }
    if (F.legend) break;
  }
  // The logo (or the company's name in capitals), above the legend or high on the face, smaller where it must be.
  const img = S.logo, word = !img && S.company ? S.company.toUpperCase() : '', ratio = img ? (img.naturalWidth / img.naturalHeight) || 1 : 0;
  if ((img || word) && S.block.page !== 'side') { // a side title has the logo and legend on the page
    K.font(800, 17); if ('letterSpacing' in ctx) ctx.letterSpacing = `${2 * u}px`;
    const lw0 = img ? Math.min(210 * u, 46 * u * ratio) : ctx.measureText(word).width, lh0 = img ? lw0 / ratio : 26 * u; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    for (const sc of [1, 0.8, 0.65]) {
      const lw = lw0 * sc, lh = lh0 * sc, uc = F.legend ? F.legend.uc : 0.6, k = hyp(frameAt(F, uc, z0 + 0.6 * hf).b), span = lw / k / F.len;
      const zc = F.legend ? F.legend.zc + F.legend.h * F.legend.sc / F.legend.k / 2 + 0.06 * hf + lh / k / 2 : z0 + 0.72 * hf;
      if (uc - span / 2 > 0.12 && uc + span / 2 < 0.99 && zc + lh / k / 2 < z0 + 0.94 * hf) { F.logo = { uc, zc, lw, lh, sc, img, word }; break; }
    }
  }
  // Depth ticks down the face's near corner (at u = 0), below the terrain there.
  const t0 = top(0.004), ticks = depthTicks(t0, z0, 0.1 * ht), kz = hyp(frameAt(F, 0.02, (t0 + z0) / 2).b);
  if (ticks.length >= 2 && (ticks[1] - ticks[0]) * kz > 34 * u) F.ticks = { t0, ticks };
  // The scale bar along the base, left of the legend.
  const room = ((F.legend ? F.legend.uc - F.legend.span / 2 : 0.92) - 0.14) * F.len, D = roundBelow(Math.min(room, 0.45 * F.len));
  if (D && D * hyp(frameAt(F, 0.3, z0).a) > 70 * u) F.scale = { D };
  return F;
}
function furniture(ctx, K, lay, F) {
  const G = H.G, { u, font } = K, z0 = G.B.z0, ht = G.zmax - z0;
  // The cards stand on a common foot.
  if (F.legend) { const { uc, zc, w, h, sc, cards } = F.legend; lay.add(onFace(ctx, F, uc, zc, [-w * sc / 2, -h * sc / 2, w * sc / 2, h * sc / 2], () => { ctx.scale(sc, sc); cards.forEach((c) => H.drawCard(ctx, K, -w / 2 + c.x, h / 2 - c.h, c.w, c.h, c.secs)); })); }
  if (F.logo) {
    const { uc, zc, lw, lh, sc, img, word } = F.logo;
    lay.add(onFace(ctx, F, uc, zc, [-lw / 2, -lh / 2, lw / 2, lh / 2], () => {
      if (img) { ctx.drawImage(img, -lw / 2, -lh / 2, lw, lh); return; }
      font(800, 17 * sc); if ('letterSpacing' in ctx) ctx.letterSpacing = `${2 * u * sc}px`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = H.pri(); ctx.fillText(word, 0, 0); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }));
  }
  if (F.ticks) {
    const { t0, ticks } = F.ticks;
    ticks.forEach((d) => {
      const t = `– ${d} m`; font('italic 600', 12.5); const tw = ctx.measureText(t).width;
      lay.add(onFace(ctx, F, 0.004, t0 - d, [0, -9 * u, 16 * u + tw, 9 * u], () => {
        ctx.strokeStyle = H.INK; ctx.lineWidth = 1.2 * u; ctx.beginPath(); ctx.moveTo(2 * u, 0); ctx.lineTo(10 * u, 0); ctx.stroke();
        font('italic 600', 12.5); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 3 * u; ctx.strokeStyle = H.paper(0.8); ctx.strokeText(t, 14 * u, 0); ctx.fillStyle = H.INK; ctx.fillText(t, 14 * u, 0); ctx.textBaseline = 'alphabetic';
      }));
    });
  }
  if (F.scale) {
    // Four blocks, dark and light, on the face along its base: each corner projected, so the bar is in true perspective.
    const { D } = F.scale, u0 = 0.1, zb = z0 + 0.045 * ht, th = 6 * u / hyp(frameAt(F, u0, zb).b), P = (du, z) => { const p = at(F.g, u0 + du / F.len); return H.proj(G.V(p[0], p[1], z)); };
    for (let i = 0; i < 4; i++) {
      const q = [P(D * i / 4, zb), P(D * (i + 1) / 4, zb), P(D * (i + 1) / 4, zb + th), P(D * i / 4, zb + th)];
      ctx.beginPath(); q.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fillStyle = i % 2 ? H.paper() : H.INK; ctx.fill(); ctx.strokeStyle = H.INK; ctx.lineWidth = u; ctx.stroke();
    }
    [[0, '0'], [D / 2, String(D / 2)], [D, `${D} m`]].forEach(([d, t]) => {
      font(600, 12.5); const tw = ctx.measureText(t).width;
      lay.add(onFace(ctx, F, u0 + d / F.len, zb + th, [-tw / 2 - 2 * u, -24 * u, tw / 2 + 2 * u, 0], () => {
        font(600, 12.5); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round'; ctx.lineWidth = 3 * u; ctx.strokeStyle = H.paper(0.8); ctx.strokeText(t, 0, -6 * u); ctx.fillStyle = H.INK; ctx.fillText(t, 0, -6 * u); ctx.textAlign = 'left';
      }));
    });
  }
}

// ---------- the Layout panel ----------
export function click(what) {
  if (what === 'blockSection') return H.api.applyPreset('blockSection').catch((e) => H.status(e.message));
  const el = document.getElementById('block-ui'); if (el) { el.hidden = false; renderUI(el); }
  return null;
}
let query = '';
export function renderUI(el) {
  if (!el) return;
  const holes = H.project?.holes || [], on = new Set(S.holesShown || holes.map((h) => h.id)), b = S.block, esc = H.esc, co = new Set(H.shownCallouts().map((c) => c.h.id)), hb = b?.hist || BLOCK.hist;
  el.innerHTML = `${b ? `<div class="row" style="gap:14px;flex-wrap:wrap"><label class="check"><input type="checkbox" data-bk="furniture" ${b.furniture !== false ? 'checked' : ''}>Legend, logo, depths and scale on the side face</label>
      <label class="check"><input type="checkbox" data-bk="traces" ${b.traces === 'overlay' ? 'checked' : ''}>Thin traces over the faces</label><label class="check"><input type="checkbox" data-bk="brackets" ${b.brackets === 'plain' ? 'checked' : ''}>Plain brackets</label>
      </div>
    <div class="grid2" style="margin-top:6px"><label class="field"><span>Page</span><select data-bs="page">${[['bare', 'The block alone (credits only)'], ['clean', 'No title block'], ['full', 'Title block, compass and notes'], ['side', 'Side title: title left, logo and legend right']].map(([v, t]) => `<option value="${v}" ${b.page === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${b.page === 'side' ? `<label class="field"><span>Info line under the title</span><input type="text" data-bi value="${esc(b.info ?? '')}" placeholder="3D cutaway · looking ${compass8(H.getCam().azimuth)}"></label>` : ''}
      <label class="field"><span>Bar shape</span><select data-bh="style"><option value="spikes" ${hb.style === 'spikes' ? 'selected' : ''}>A spike per assay</option><option value="bars" ${hb.style !== 'spikes' ? 'selected' : ''}>Merged bars</option></select></label>
      <label class="field"><span>Bar colours</span><select data-bh="palette"><option value="orange" ${hb.palette === 'orange' ? 'selected' : ''}>Orange ramp</option><option value="bins" ${hb.palette !== 'orange' ? 'selected' : ''}>The grade colours</option></select></label></div>
    <div class="grid2" style="margin-top:6px"><label class="field"><span>Grade bars</span><select data-bh="side"><option value="face" ${hb.side === 'face' ? 'selected' : ''}>On the front face</option><option value="screen" ${hb.side !== 'face' ? 'selected' : ''}>Facing the camera</option></select></label>
      <label class="field"><span>Bar length</span><select data-bh="scale"><option value="linear" ${hb.scale !== 'log' ? 'selected' : ''}>By grade</option><option value="log" ${hb.scale === 'log' ? 'selected' : ''}>By grade, log scale</option></select></label></div>
    <button class="btn" type="button" data-bk-off style="margin-top:6px">Turn the block look off</button>` : ''}
    <div class="field" style="margin-top:8px"><span>Holes shown (${S.holesShown ? `${S.holesShown.length} of ${holes.length}` : 'all'})</span>
      ${holes.length > 12 ? '<input type="text" data-hq placeholder="Filter holes" aria-label="Filter holes shown" style="margin:4px 0">' : ''}
      <div class="prov-list" style="max-height:168px;overflow:auto">${holes.map((h) => `<label class="check"${co.has(h.id) ? ' style="font-weight:700"' : ''}><input type="checkbox" data-hs value="${esc(h.id)}" ${on.has(h.id) ? 'checked' : ''}>${esc(h.id)}</label>`).join('')}</div>
      <div class="row" style="margin-top:6px;gap:6px"><button class="btn" type="button" data-hs-all>All holes</button>${S.section?.holes?.length ? '<button class="btn" type="button" data-hs-sec>The section\'s chosen holes</button>' : ''}</div>
      <p class="muted" style="margin-top:4px">Hidden holes lose their trace, ID, bars and callouts; they still shape the geology. Bold: callout holes.</p></div>`;
  const run = (p) => Promise.resolve().then(p).catch((e) => H.status(e.message));
  el.querySelectorAll('[data-hs]').forEach((cb) => cb.addEventListener('change', () => run(() => H.api.setHolesShown([...el.querySelectorAll('[data-hs]')].filter((x) => x.checked).map((x) => x.value)))));
  el.querySelector('[data-hs-all]')?.addEventListener('click', () => run(() => H.api.setHolesShown(null)));
  el.querySelector('[data-hs-sec]')?.addEventListener('click', () => run(() => H.api.setHolesShown(S.section.holes)));
  el.querySelector('[data-bk-off]')?.addEventListener('click', () => run(() => H.api.setBlock(null)));
  el.querySelector('[data-bi]')?.addEventListener('change', (e) => run(() => H.api.setBlock({ info: e.target.value.trim() || null })));
  el.querySelectorAll('[data-bs]').forEach((x) => x.addEventListener('change', () => run(() => H.api.setBlock({ [x.dataset.bs]: x.value }))));
  const V = { traces: ['overlay', 'tubes'], brackets: ['plain', 'card'] };
  el.querySelectorAll('[data-bk]').forEach((cb) => cb.addEventListener('change', () => run(() => H.api.setBlock({ [cb.dataset.bk]: V[cb.dataset.bk] ? V[cb.dataset.bk][cb.checked ? 0 : 1] : cb.checked }))));
  el.querySelectorAll('[data-bh]').forEach((s) => s.addEventListener('change', () => run(() => H.api.setBlock({ hist: { [s.dataset.bh]: s.value } }))));
  const q = el.querySelector('[data-hq]'), filter = () => el.querySelectorAll('.prov-list label').forEach((l) => { l.hidden = !!query && !l.textContent.toLowerCase().includes(query); });
  if (q) { q.value = query; q.addEventListener('input', () => { query = q.value.trim().toLowerCase(); filter(); }); filter(); }
}
