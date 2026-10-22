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
//     brackets: "plain" a bracket and bold "154 m @ 0.51% Cu" text beside the hole (tags.js), "callout" (a bracket with
//                       a domain heading, hole-ID chip and bold result on a leader, the holes on alternate sides), or "card",
//     page: "bare"      the block alone on white: no title block, compass or notes, the credits small; "clean": no
//                       title block while the block carries a heading; "full"; or "side": a large title block at the
//                       top left (company line, title, subtitle, info line), the logo and legend card on the page at
//                       the right, no heading on the block (round 5G),
//     info: the side title's muted last line (page "side"; unset: "3D cutaway · looking SW"),
//     hist: { side: "face" (in the front face's plane) | "screen", scale: "linear" | "log", halo, length,
//             palette: "orange" (four classes, pale yellow to deep orange, as the reference) | "bins",
//             style: "spikes" (one thin spike per assay, linear in grade, as the reference) | "bars" },
//     units: "auto" a wall label linked to a geology unit sits inside that unit's band on its face; "fixed" (blocks
//                   made before this setting) where it was put,
//     surface: "vivid" a see-through terrain (setStyle surface under 1) keeps its satellite colours, only the holes, bars
//                   and shells under it showing through; "mix" (blocks made before) the plain transparent top,
//     fadeBottom: 0 (off) to 1: the share of the block's height fading out toward its base }.
// Settings missing from a block saved before them keep the earlier look (units "fixed", surface "mix", no fade).
// Round 5H, each off unless set: colors { holeId: "#hex" } (the hole's trace, collar ID, callout chip and legend dot),
// hist.style "thick" (one wide bar per run of assays in one colour, centred on the trace, hist.width × about 1.6% of the
// figure's width) and hist.palette "release" (yellow, orange, red and magenta from
// the four colour limits; nothing under the first), ticks "elevation" (on the block's left vertical edge) or "none"
// (unset: depths on the side face), ends (A and A′ boxed where the section line crosses the block's top), pad (one
// pill, "077 & 078", over holes sharing a pad; a string is its text), legend { assay, geology, holes, bracket } (one
// card: assay classes in two columns, the geology, the holes' colour and the bracket; each its heading or row text),
// inclFrom: false (no "from N m" on the incl. lines), scale "flat" (a flat bar under the figure) and scaleNote.
import * as THREE from 'three';
import { fitLine } from './section-geometry.js';
import { ORANGE, RELEASE, clusters } from './tags.js';

let H, S;
export function init(host) { H = host; S = host.S; }

export const BLOCK = { furniture: true, traces: 'overlay', brackets: 'plain', page: 'bare', hist: { side: 'face', style: 'spikes', scale: 'linear', halo: false, length: 1, palette: 'orange' }, units: 'auto', surface: 'vivid', fadeBottom: 0 };
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
  if (o.brackets !== undefined) { if (!['plain', 'callout', 'card'].includes(o.brackets)) throw new Error('brackets must be "plain" (a bracket and bold text), "callout" (a bracket, domain heading, hole-ID chip and bold result, holes on alternate sides) or "card".'); b.brackets = o.brackets; }
  if (o.units !== undefined) { if (!['auto', 'fixed'].includes(o.units)) throw new Error('units must be "auto" (a unit\'s wall label inside its band on the face) or "fixed" (where it was put).'); b.units = o.units; }
  if (o.surface !== undefined) { if (!['vivid', 'mix'].includes(o.surface)) throw new Error('surface must be "vivid" (a see-through terrain keeps its satellite colours) or "mix" (the plain transparent top).'); b.surface = o.surface; }
  if (o.fadeBottom !== undefined) { const v = +o.fadeBottom; if (!Number.isFinite(v)) throw new Error('fadeBottom must be 0 (off) to 1 (the share of the block\'s height fading toward its base).'); b.fadeBottom = Math.max(0, Math.min(1, v)); }
  if (o.page !== undefined) { if (!['bare', 'clean', 'full', 'side'].includes(o.page)) throw new Error('page must be "bare" (the block alone, credits only), "clean" (no title block while the block has a heading), "full" or "side" (a large title block at the left, the logo and legend at the right).'); b.page = o.page; }
  if (o.info !== undefined) { if (o.info === null) delete b.info; else b.info = String(o.info).slice(0, 160); }
  // Round 5H: kept only while on, so a block with them off is the same object as before.
  const opt = (k, v, on) => { if (on) b[k] = v; else delete b[k]; };
  if (o.colors !== undefined) {
    if (o.colors !== null && (typeof o.colors !== 'object' || Array.isArray(o.colors))) throw new Error('colors must be { holeId: "#rrggbb" }, or null for none.');
    // Colours set for holes no longer in the data (another dataset loaded) are dropped, not checked.
    const known = new Set(H.project.holes.map((h) => h.id)), c = { ...Object.fromEntries(Object.entries((o.colors && b.colors) || {}).filter(([id]) => known.has(id))), ...o.colors };
    Object.entries(c).forEach(([id, v]) => { if (v === null) delete c[id]; else if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`colors["${id}"] must be a colour like "#3f9a3c", or null.`); });
    if (o.colors) holeIds(Object.keys(c).length ? Object.keys(c) : null);
    opt('colors', c, o.colors && Object.keys(c).length);
  }
  if (o.ticks !== undefined) { if (!['depth', 'elevation', 'none'].includes(o.ticks)) throw new Error('ticks must be "depth" (depths down the side face), "elevation" (elevations up the block\'s left edge) or "none".'); opt('ticks', o.ticks, o.ticks !== 'depth'); }
  if (o.ends !== undefined) opt('ends', true, !!o.ends);
  if (o.pad !== undefined) opt('pad', typeof o.pad === 'string' && o.pad.trim() ? o.pad.trim().slice(0, 60) : true, !!o.pad);
  if (o.legend !== undefined) {
    if (o.legend && typeof o.legend === 'object') { const x = { ...b.legend }; ['assay', 'geology', 'holes', 'bracket'].forEach((k) => { if (o.legend[k] === null) delete x[k]; else if (o.legend[k] !== undefined) x[k] = String(o.legend[k]).slice(0, 80); }); b.legend = x; }
    else opt('legend', { ...b.legend }, !!o.legend);
  }
  if (o.inclFrom !== undefined) opt('inclFrom', false, !o.inclFrom);
  if (o.scale !== undefined) { if (!['face', 'flat'].includes(o.scale)) throw new Error('scale must be "face" (in perspective on the side face) or "flat" (a flat bar under the figure, true at the block\'s centre).'); opt('scale', 'flat', o.scale === 'flat'); }
  if (o.scaleNote !== undefined) opt('scaleNote', String(o.scaleNote ?? '').slice(0, 160), o.scaleNote !== null);
  if (o.hist !== undefined) {
    const h = o.hist || {}, x = { ...(b.hist || BLOCK.hist) };
    if (h.side !== undefined) { if (!['face', 'screen'].includes(h.side)) throw new Error('hist.side must be "face" (in the face\'s plane) or "screen".'); x.side = h.side; }
    if (h.scale !== undefined) { if (!['linear', 'log'].includes(h.scale)) throw new Error('hist.scale must be "linear" or "log".'); x.scale = h.scale; }
    if (h.halo !== undefined) x.halo = !!h.halo;
    if (h.style !== undefined) { if (!['spikes', 'bars', 'thick'].includes(h.style)) throw new Error('hist.style must be "spikes" (one thin spike per assay), "bars" (merged bars) or "thick" (wide bars along the hole).'); x.style = h.style; }
    if (h.palette !== undefined) { if (!['orange', 'bins', 'release'].includes(h.palette)) throw new Error('hist.palette must be "orange" (pale yellow to deep orange), "bins" (the figure\'s grade colours) or "release" (yellow, orange, red, magenta; none under the first colour limit).'); x.palette = h.palette; }
    if (h.length !== undefined) { const v = +h.length; if (!Number.isFinite(v)) throw new Error('hist.length must be a number, 0.3-3 (1: the usual length).'); x.length = Math.max(0.3, Math.min(3, v)); }
    if (h.width !== undefined) { const v = +h.width; if (!Number.isFinite(v)) throw new Error('hist.width must be a number, 0.3-3 (thick bars; 1: about 1.6% of the figure\'s width).'); x.width = Math.max(0.3, Math.min(3, v)); }
    b.hist = x;
  }
}
export function setBlock(o) {
  if (!H.G) throw new Error('Load data first.');
  if (o === null) S.block = null;
  else {
    if (!o || typeof o !== 'object') throw new Error('setBlock takes { furniture, traces, brackets, page, info, hist, holes, units, surface, fadeBottom, colors, ticks, ends, pad, legend, inclFrom, scale, scaleNote }, or null to turn the block look off.');
    const b = structuredClone(S.block || BLOCK), was = S.block?.page; patch(b, o);
    if (o.holes !== undefined) S.holesShown = holeIds(o.holes);
    S.block = b;
    // To or from the side title, the block is framed again for the room the title takes.
    if ((was === 'side') !== (b.page === 'side')) { const c = H.getCam(); frame({ azimuth: c.azimuth, plunge: c.plunge, zoom: c.zoom }); }
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
  // A standalone map keeps its details in a card at the right (studio.js, mapuse.js): the block is framed in the rest.
  const card = S.mapInfo?.use === 'standalone' ? (230 + 28 + 18) * u : 0, Wa = W - card;
  const box = () => { const ps = []; [[B.x0, B.y0], [B.x1, B.y0], [B.x1, B.y1], [B.x0, B.y1]].forEach(([x, y]) => { ps.push(H.proj(G.V(x, y, B.z0)), H.proj(G.V(x, y, G.surf(x, y)))); }); return [Math.min(...ps.map((q) => q[0])), Math.min(...ps.map((q) => q[1])), Math.max(...ps.map((q) => q[0])), Math.max(...ps.map((q) => q[1]))]; };
  for (let i = 0; i < 4; i++) {
    H.camera.updateMatrixWorld(); const b = box(), t = H.controls.target, ppu = H.proj(t.clone().add(up))[1] - H.proj(t)[1];
    if (ppu) H.aim.y += ((b[1] + b[3]) / 2 - (top + bot) / 2) / ppu;
    if (card) { const r = new THREE.Vector3(1, 0, 0).applyQuaternion(H.camera.quaternion), ppx = H.proj(t.clone().add(r))[0] - H.proj(t)[0]; if (ppx) H.aim.addScaledVector(r, ((b[0] + b[2]) / 2 - Wa / 2) / ppx); }
    const k = Math.min(0.84 * (bot - top) / (b[3] - b[1]), (side ? 0.7 : 0.92) * Wa / (b[2] - b[0]));
    v = { ...v, zoom: Math.max(40, Math.min(250, H.getCam().zoom * Math.min(k, 1.3))), pan: H.aim.toArray() }; H.setCamera(v, true);
  }
}
// Framed again in its current direction: a block section turning standalone or back (mapuse.js).
export function reframe() {
  if (!H.G || !S.block) return;
  // From where the preset starts (zoom 120), so turning back to a presentation figure gives the preset's framing.
  const c = H.getCam(); frame({ azimuth: c.azimuth, plunge: c.plunge, zoom: 120 }); H.setStyle({});
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
  vivid(); curtain();
}

// ---------- the terrain made see-through without washing out (S.block.surface "vivid") ----------
// A transparent top showed the block's own walls and faces through it, so the satellite surface went brown or grey
// as its opacity dropped. With "vivid" the top stays opaque (and marks where it is drawn in the stencil); what lies
// under it (the holes' tubes, the grade bars, shells and model shapes) is drawn again after the scene, only where the
// top covers it (behind it in depth, inside its stencil), at the transparency asked: so the holes show through and the
// imagery keeps its colours. "mix", and blocks saved before the setting, keep the plain transparent top.
const ghost = { on: false, busy: false };
// three.js constants (stencil, blending) as their numbers, so the shared three.js chunk the page loads exports no more names.
const GL = { always: 519, replace: 7681, equal: 514, normal: 1, custom: 5, zero: 200, oneMinusSrcAlpha: 205 };
function vivid() {
  const G = H.G, m = G.top.material, on = S.block?.surface === 'vivid' && S.surf < 0.99;
  ghost.on = on; m.stencilWrite = on;
  if (on) { m.opacity = 1; m.depthWrite = true; m.stencilRef = 1; m.stencilFunc = GL.always; m.stencilZPass = GL.replace; }
  H.scene.onAfterRender = ghostPass; H.scene.onBeforeRender = curtainSides;
}
// The ghost of one object's material: its own colour (instance colours still apply) and opacity, at the share the
// terrain lets through, drawn only behind the top and inside its stencil; null for a material not drawn at all.
const ghosts = new WeakMap();
export function ghostMaterial(m, through) {
  if (!m || Array.isArray(m) || m.visible === false || !(m.opacity > 0) || !(through > 0)) return null;
  let g = ghosts.get(m);
  if (!g) { g = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth, side: THREE.DoubleSide, stencilWrite: true, stencilRef: 1, stencilFunc: GL.equal }); ghosts.set(m, g); }
  if (m.color) g.color.copy(m.color); else g.color.set('#ffffff');
  if (g.vertexColors !== !!m.vertexColors) { g.vertexColors = !!m.vertexColors; g.needsUpdate = true; }
  g.opacity = through * (m.transparent ? m.opacity : 1);
  return g;
}
function ghostPass(renderer, scene, camera) {
  const G = H.G; if (!ghost.on || ghost.busy || !G || !S.block) return;
  const objs = [...H.root.children.filter((o) => o.isInstancedMesh && o.instanceColor && o.visible), ...(G.shellMesh?.visible ? G.shellMesh.children.filter((o) => o.visible) : []), ...(G.meshes || []).map((x) => x.m).filter((m) => m.visible)]
    .map((o) => [o, o.material, ghostMaterial(o.material, 1 - S.surf)]).filter(([, , g]) => g); // each in its own colour and opacity; none at opacity 0
  if (!objs.length) return;
  const bg = scene.background, ac = renderer.autoClear, mask = camera.layers.mask;
  objs.forEach(([o, , g]) => { o.layers.enable(5); o.material = g; }); ghost.busy = true;
  try { scene.background = null; renderer.autoClear = false; camera.layers.set(5); renderer.render(scene, camera); } finally {
    ghost.busy = false; scene.background = bg; renderer.autoClear = ac; camera.layers.mask = mask; objs.forEach(([o, m]) => { o.layers.disable(5); o.material = m; });
  }
}

// ---------- the fade at the bottom (S.block.fadeBottom) ----------
// A band in front of each face from the base up, fadeBottom of the block's height (up to the terrain), the page colour
// fading out upward; on a transparent background it erases toward transparent instead. Only the faces toward the
// camera show theirs. fadeAlpha(t): the band's opacity at t (0 at the base, 1 at its top).
export const fadeAlpha = (t) => (1 - Math.max(0, Math.min(1, t))) ** 1.6;
const fade = { G: null, k: null, meshes: [], mat: null };
function curtain() {
  const G = H.G, f = S.block?.fadeBottom || 0, k = `${f}`;
  if (fade.G === G && fade.k === k) return;
  fade.meshes.forEach((m) => { m.parent?.remove(m); m.geometry.dispose(); }); fade.meshes = []; fade.G = G; fade.k = k;
  if (!(f > 0)) return;
  fade.mat ||= new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const z0 = G.B.z0, NI = 48, NJ = 16;
  FACES.forEach((face) => {
    const g = H.faceGeom(face), pos = [], col = [], idx = [];
    for (let i = 0; i <= NI; i++) {
      const p = at(g, i / NI), hb = Math.min(f * (G.zmax - z0), G.surf(p[0], p[1]) - z0);
      for (let j = 0; j <= NJ; j++) { const v = G.V(p[0], p[1], z0 + hb * j / NJ).addScaledVector(g.n, G.diag * 0.004); pos.push(v.x, v.y, v.z); col.push(1, 1, 1, fadeAlpha(j / NJ)); }
    }
    for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) { const a = i * (NJ + 1) + j, b = a + NJ + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); geo.setIndex(idx);
    const m = new THREE.Mesh(geo, fade.mat); m.renderOrder = 6.5; m.userData.face = face; H.root.add(m); fade.meshes.push(m); // over the faces and the top, under the wall labels
  });
}
// Before each render: the bands on the faces toward the camera only, in the page colour (or erasing).
function curtainSides(renderer, scene, camera) {
  const G = H.G; if (!fade.meshes.length || !G) return;
  const bg = scene.background, M = fade.mat, ht = G.zmax - G.B.z0;
  fade.meshes.forEach((m) => { const g = H.faceGeom(m.userData.face), c = at(g, 0.5); m.visible = g.n.dot(camera.position.clone().sub(G.V(c[0], c[1], G.B.z0 + ht / 2))) > 0; });
  if (bg?.isColor) { M.color.copy(bg); M.blending = GL.normal; } else { M.color.set('#ffffff'); M.blending = GL.custom; M.blendSrc = M.blendSrcAlpha = GL.zero; M.blendDst = M.blendDstAlpha = GL.oneMinusSrcAlpha; }
}

// ---------- wall labels by unit (S.block.units "auto") ----------
// A wall label linked to a geology unit (addWallLabel({ unit })) goes inside that unit's colour band on its face, never
// over another unit: at the largest size (down to 45%) at which it fits wholly inside the band, turned to follow it,
// at the spot clearest of the holes shown, their grade bars, the other wall labels and what the overlay placed. With
// no such spot it is hidden and says why (getState().layout.wallLabels[id].why). Placed again as the view turns 5° or zooms 10%.
// bandSpot: the search on a face's class grid (cls: nx × ny cells, row 0 at the top), in the face's own units (len
// across, ht from the base up to the grid's top); w × h the label's size. room(x, z, hw, hh, angle): how clear a spot
// is (above 0: clear). Returns { x, z, angle (degrees), scale, r } or null.
export function bandSpot(cls, nx, ny, ci, len, ht, w, h, room = () => 1) {
  const dx = len / (nx - 1), dz = ht / (ny - 1), cell = (x, z) => { const i = Math.round(x / dx), j = Math.round((ht - z) / dz); return i >= 0 && j >= 0 && i < nx && j < ny ? cls[j * nx + i] : -2; };
  const is = (i, j) => j >= 0 && j < ny && cls[j * nx + i] === ci;
  // The middle row of the unit's run in column i nearest row j (within a sixth of the grid), or null.
  const midRow = (i, j) => {
    if (i < 0 || i >= nx) return null;
    let r = -1; for (let d = 0; d <= ny / 6 && r < 0; d++) r = is(i, j - d) ? j - d : is(i, j + d) ? j + d : -1;
    if (r < 0) return null; let a = r, b = r; while (is(i, a - 1)) a--; while (is(i, b + 1)) b++; return (a + b) / 2;
  };
  let first = null;
  for (const sc of [1, 0.85, 0.7, 0.55, 0.45]) {
    const hw = w * sc / 2, hh = h * sc / 2, di = Math.max(1, Math.round(hw / dx)), si = Math.max(1, Math.round(di / 4)), sj = Math.max(1, Math.round(hh / dz / 2));
    let best = null; const seen = new Set();
    for (let j = 0; j < ny; j += sj) for (let i = 0; i < nx; i += si) {
      if (!is(i, j)) continue;
      const mc = midRow(i, j), k = `${i}|${mc}`; if (seen.has(k)) continue; seen.add(k);
      const m0 = midRow(i - di, Math.round(mc)), m1 = midRow(i + di, Math.round(mc));
      let ang = m0 !== null && m1 !== null ? Math.atan2(-(m1 - m0) * dz, 2 * di * dx) : 0; ang = Math.max(-0.6, Math.min(0.6, ang)); if (Math.abs(ang) < 0.05) ang = 0;
      const x = i * dx, z = ht - mc * dz, ca = Math.cos(ang), sa = Math.sin(ang);
      let ok = true; // the label, a little larger than drawn, wholly inside the unit
      for (let p = -1; p <= 1.001 && ok; p += 0.2) for (let q = -1; q <= 1.001; q += 0.5) if (cell(x + p * hw * 1.08 * ca - q * hh * 1.25 * sa, z + p * hw * 1.08 * sa + q * hh * 1.25 * ca) !== ci) { ok = false; break; }
      if (!ok) continue;
      const r = room(x, z, hw, hh, ang); if (!best || r > best.r) best = { x, z, angle: +(ang * 180 / Math.PI).toFixed(1), scale: sc, r };
    }
    if (best && best.r > 0) return best;
    if (best?.r > -Infinity) first ||= best; // near a hole, at the largest size that fits; a covered spot never
  }
  return first;
}
const spots = new Map();
// Where each unit's label went (or why not), by label ID: drawing results kept out of S, so neither saved nor undone
// (getState().layout.wallLabels).
const placed = new Map();
export const placements = () => Object.fromEntries(S.wallLabels.filter((l) => placed.has(l.id)).map((l) => [l.id, placed.get(l.id)]));
let side = { f: null, rects: [] }; // the side face's legend and logo as last laid out (plan)
export function unitSpot(mesh) {
  const L = mesh.userData.L, G = H.G;
  if (S.block?.units !== 'auto' || !L.unit || L.size === 'heading' || !G) { placed.delete(L.id); return; } // where it was put
  const grid = H.ext('geology')?.unitGrid(L.face, L.unit);
  if (!grid) { placed.delete(L.id); return; } // no geology painted on that face: the label keeps its own place
  const g = H.faceGeom(L.face), z0 = G.B.z0, A = G.V(g.a[0], g.a[1], z0), len = A.distanceTo(G.V(g.b[0], g.b[1], z0)), ht = A.distanceTo(G.V(g.a[0], g.a[1], G.zmax));
  const e = mesh.matrix.elements, w = Math.hypot(e[0], e[1], e[2]), h = Math.hypot(e[4], e[5], e[6]), c = H.getCam();
  // The side face's legend and logo (plan, as last laid out), in the face's own units: x across, z up from the base.
  const fur = side.f === L.face ? side.rects.map(([u0, u1, za, zb]) => [u0 * len, u1 * len, (za - z0) / (G.zmax - z0) * ht, (zb - z0) / (G.zmax - z0) * ht]) : [];
  const key = [grid.k, grid.id, L.unit, w.toPrecision(3), h.toPrecision(3), Math.round(c.azimuth / 5), Math.round(c.plunge / 5), Math.round(c.zoom / 10), S.holesShown, S.wallLabels.length, fur.flat().map(Math.round)].join('|');
  let sp = spots.get(L.id);
  if (!sp || sp.key !== key) {
    H.camera.updateMatrixWorld();
    const W = H.frame()[0], bw = 0.06 * W, pts = [], P = (x, z) => { const p = at(g, x / len); return H.proj(G.V(p[0], p[1], z0 + (G.zmax - z0) * z / ht)); };
    H.project.holes.filter(H.holeOn).forEach((ho) => ho.path.forEach((p, i) => { if (i % 2) return; const q = H.proj(G.V(p.x, p.y, p.z)); for (let t = 0; t <= 1; t += 0.25) pts.push([q[0] + (S.histograms ? bw * t : 0), q[1]]); }));
    const v = new THREE.Vector3(), box4 = (ps) => [Math.min(...ps.map((q) => q[0])), Math.min(...ps.map((q) => q[1])), Math.max(...ps.map((q) => q[0])), Math.max(...ps.map((q) => q[1]))];
    const eye = H.camera.position, toward = (f) => { const gg = H.faceGeom(f), cc = at(gg, 0.5); return gg.n.dot(eye.clone().sub(G.V(cc[0], cc[1], z0))) > 0; }; // labels on the faces turned away are not seen
    const boxes = (G.wallLabelMeshes || []).filter((m) => m.userData.L.id !== L.id && m.visible && toward(m.userData.L.face)).map((m) => box4([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => H.proj(v.set(x, y, 0).applyMatrix4(m.matrixWorld)))));
    const room = (x, z, hw, hh, a) => {
      const ca = Math.cos(a), sa = Math.sin(a), ex = hw * Math.abs(ca) + hh * Math.abs(sa), ez = hw * Math.abs(sa) + hh * Math.abs(ca);
      if (fur.some((f) => x + ex > f[0] && x - ex < f[1] && z + ez > f[2] && z - ez < f[3])) return -Infinity; // under the side face's legend or logo
      const b = box4([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => P(x + p * hw * ca - q * hh * sa, z + p * hw * sa + q * hh * ca)));
      if (boxes.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]))) return -Infinity; // covered: never chosen
      let d = Infinity; for (const [px, py] of pts) d = Math.min(d, Math.max(b[0] - px, px - b[2], b[1] - py, py - b[3]));
      return d;
    };
    sp = { key, at: bandSpot(grid.cls, grid.nx, grid.ny, grid.ci, len, ht, w, h, room) }; spots.set(L.id, sp);
  }
  const s = sp.at;
  if (!s) { placed.set(L.id, { at: null, why: 'no clear room inside its unit on this face' }); mesh.visible = false; return; }
  const p = at(g, s.x / len), z = z0 + (G.zmax - z0) * s.z / ht, top = G.surf(p[0], p[1]), r = s.angle * RAD;
  const right = new THREE.Vector3(g.b[0] - g.a[0], 0, -(g.b[1] - g.a[1])).normalize(), up = new THREE.Vector3(0, 1, 0);
  const R = right.clone().multiplyScalar(Math.cos(r)).addScaledVector(up, Math.sin(r)), U = up.clone().multiplyScalar(Math.cos(r)).addScaledVector(right, -Math.sin(r));
  mesh.matrix.makeBasis(R.multiplyScalar(w * s.scale), U.multiplyScalar(h * s.scale), g.n).setPosition(G.V(p[0], p[1], z).addScaledVector(g.n, G.diag * 0.003)); mesh.visible = true;
  placed.set(L.id, { at: { u: +(s.x / len).toFixed(3), v: +((z - z0) / (top - z0)).toFixed(3), rotation: s.angle, scale: s.scale } });
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
  last = { ticks: [], ends: [], pads: [], scale: null };
  // ticks: no elevation ticks from studio.js (the side face's depths, or round 5H's ticks set); secs: the release legend.
  return { head: B.page !== 'full' && S.wallLabels.some((l) => l.size === 'heading' || l.size === 'title'), title: B.page === 'side' && (() => sideTitle(ctx, K)), bare, foot: bare && ((credits) => foot(ctx, K, credits)), logo: !!F?.logo, legend: !!F?.legend, ticks: !!F?.ticks || !!B.ticks, scale: !!F?.scale || B.scale === 'flat',
    secs: B.legend && releaseSecs,
    late: B.ticks === 'elevation' ? (lay) => elevTicks(ctx, K, lay) : null, // after the callouts, as studio.js's ticks
    draw: (lay, footTop) => { if (F) furniture(ctx, K, lay, F); if (B.ends) ends(ctx, K, lay); if (B.scale === 'flat') flatScale(ctx, K, lay, footTop); } };
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
  const p = S.block?.hist?.palette;
  if (!S.histograms || (p !== 'orange' && p !== 'release') || S.block.hist.side !== 'face') return null;
  const b = S.bins;
  if (p === 'release') return [[`≥ ${b[3]}`, RELEASE[3]], [`${b[2]} – ${b[3]}`, RELEASE[2]], [`${b[1]} – ${b[2]}`, RELEASE[1]], [`${b[0]} – ${b[1]}`, RELEASE[0]]];
  return [[`≥ ${b[3]}`, ORANGE[3]], [`${b[1]} – ${b[3]}`, ORANGE[2]], [`${b[0]} – ${b[1]}`, ORANGE[1]], [`< ${b[0]}`, ORANGE[0]]];
}
function traces(ctx, K) {
  const G = H.G, { u } = K;
  H.project.holes.filter(H.holeOn).forEach((h) => {
    const pts = h.path.map((p) => H.proj(G.V(p.x, p.y, p.z))); if (pts.some((p) => p[2] > 1)) return;
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.lineJoin = 'round';
    const hc = colorOf(h); if (hc) { ctx.strokeStyle = 'rgba(20,33,38,0.6)'; ctx.lineWidth = 3.8 * u; ctx.stroke(); } // a hole's own colour, wider, edged dark (over the bars)
    ctx.setLineDash(h.prov || h.planned ? [6 * u, 4 * u] : []); ctx.strokeStyle = hc || (h.planned ? H.pri() : H.INK); ctx.lineWidth = (hc ? 2.4 : 0.85) * u; ctx.stroke(); ctx.setLineDash([]); // ~1.5 px at 2000 px wide
  });
}

// ---------- round 5H: hole colours, a common pad, the release legend, edge ticks, section ends, a flat scale ----------
// What the last drawing placed (getState().layout.block): drawing results, neither saved nor undone.
let last = { ticks: [], ends: [], pads: [], scale: null };
export const layout = () => structuredClone(last);
export const padDrawn = (p) => last.pads.push({ text: p.text, holes: p.holes.map((h) => h.id) });
export const colorOf = (h) => S.block?.colors?.[h.id] || null;
export const HOLE_COLORS = ['#3f9a3c', '#1fb0c6', '#e07a1f', '#7d4fc2', '#c23b5a', '#2f6fb3']; // 077 green, 078 cyan, then more
// Hole IDs without the prefix they share up to a separator ("BS-077", "BS-078" → "077", "078"), and joined "a, b & c".
export function shortIds(ids) {
  if (ids.length < 2) return ids.slice();
  let k = 0; while (k < ids[0].length && ids.every((s) => s[k] === ids[0][k])) k++;
  const n = (/^.*[^A-Za-z0-9]/.exec(ids[0].slice(0, k)) || [''])[0].length;
  return ids.map((s) => s.slice(n) || s);
}
export const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} & ${xs[xs.length - 1]}`);
// Holes sharing a pad (S.block.pad): shown holes whose collars lie within 20 m in plan, two or more, as one pill
// ("077 & 078", or the text set) in the first hole's colour; tags.js places it over their collars. [{ holes, text, color }]
export function pads() {
  if (!S.block?.pad || !H.G) return [];
  const hs = H.project.holes.filter(H.holeOn);
  return clusters(hs.map((h) => [h.c.x, h.c.y]), 20).filter((g) => g.length > 1).map((g) => {
    const list = g.map((i) => hs[i]).sort((a, b) => a.id.localeCompare(b.id));
    return { holes: list, text: typeof S.block.pad === 'string' ? S.block.pad : joinAnd(shortIds(list.map((h) => h.id))), color: colorOf(list[0]) || S.accent };
  });
}
// The release legend (S.block.legend): one card, the assay classes two to a row under their heading, the geology under
// its own, any other sections, then the holes in their colours and the bracket. main, ext: studio.js's sections.
export function releaseSecs(main, ext) {
  const L = S.block.legend, as = main.find((s) => s.key === 'assays'), ids = H.project.holes.filter((h) => H.holeOn(h) && colorOf(h)).map((h) => h.id);
  const two = (a, b) => ({ h: 19, full: (ctx, K, x, y, w) => [a, b].forEach((r, i) => { if (!r) return; const cx = x + i * w / 2; r.draw(ctx, cx, y + 9.5 * K.u, K.u); K.font(400, 12, r.mono); ctx.fillStyle = H.INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(H.fitText(ctx, r.label, w / 2 - 34 * K.u), cx + 30 * K.u, y + 9.5 * K.u); }) });
  const rows = (as?.rows || []).filter((r) => r.draw && !r.sep), pairs = []; for (let i = 0; i < rows.length; i += 2) pairs.push(two(rows[i], rows[i + 1]));
  const dots = (ctx, x, cy, u) => ids.slice(0, 3).forEach((id, i) => { ctx.beginPath(); ctx.arc(x + (6 + i * 6) * u, cy, 4.5 * u, 0, Math.PI * 2); ctx.fillStyle = S.block.colors[id]; ctx.fill(); ctx.lineWidth = u; ctx.strokeStyle = H.paper(); ctx.stroke(); });
  const bracket = (ctx, x, cy, u) => { ctx.beginPath(); ctx.moveTo(x + 7 * u, cy - 7 * u); ctx.lineTo(x + 12 * u, cy - 7 * u); ctx.lineTo(x + 12 * u, cy + 7 * u); ctx.lineTo(x + 7 * u, cy + 7 * u); ctx.strokeStyle = H.INK; ctx.lineWidth = 1.8 * u; ctx.lineJoin = 'miter'; ctx.stroke(); };
  const holes = [...(ids.length ? [{ label: L.holes ?? `Hole${ids.length > 1 ? 's' : ''} ${joinAnd(shortIds(ids))} (this release)`, draw: dots }] : main.find((s) => s.key === 'holes')?.rows || []),
    ...(H.shownCallouts().length ? [{ label: L.bracket ?? `${S.calloutMode === 'published' ? 'Published' : 'Reported'} interval (down-hole)`, draw: bracket }] : [])];
  return [...(pairs.length ? [{ key: 'assays', title: L.assay ?? `ASSAY · ${S.valueLabel}`, minW: 236, rows: pairs }] : []), ...ext.map((s) => (s.key === 'lithology' ? { ...s, title: L.geology ?? 'GEOLOGY' } : s)),
    ...main.filter((s) => s.key !== 'assays' && s.key !== 'holes'), ...(holes.length ? [{ key: 'holes', rows: holes }] : [])];
}
// Elevations up the block's left vertical edge (S.block.ticks "elevation"), flat on the page: a tick and "1500 m" at
// each round step between the base and the terrain there.
function elevTicks(ctx, K, lay) {
  const G = H.G, { u, font } = K, B = G.B, z0 = B.z0;
  const c = [[B.x0, B.y0], [B.x1, B.y0], [B.x1, B.y1], [B.x0, B.y1]].map(([x, y]) => ({ x, y, zt: G.surf(x, y), b: H.proj(G.V(x, y, z0)) })).filter((p) => p.b[2] < 1).sort((p, q) => p.b[0] - q.b[0])[0];
  const step = c && roundBelow((c.zt - z0) / 3.5, [10, 20, 25, 50, 100, 200, 250, 500, 1000]); if (!step) return;
  for (let z = Math.ceil((z0 + 0.05 * (c.zt - z0)) / step) * step; z < c.zt - 0.06 * (c.zt - z0); z += step) {
    const [x, y] = H.proj(G.V(c.x, c.y, z)), t = `${Math.round(z)} m`; font(500, 11.5); const box = [x - 12 * u - ctx.measureText(t).width, y - 8 * u, x + u, y + 8 * u];
    if (!lay.clear(box)) continue;
    lay.add(box); last.ticks.push(Math.round(z));
    ctx.strokeStyle = H.INK; ctx.lineWidth = 1.1 * u; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6 * u, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 3 * u; ctx.strokeStyle = H.paper(0.85); ctx.strokeText(t, x - 9 * u, y); ctx.fillStyle = H.INK; ctx.fillText(t, x - 9 * u, y);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
}
// The section line A→B (plan points) clipped to the block's extent b: [A, B] where it crosses it, or null.
export function clipToBox(A, B, b) {
  const dx = B.x - A.x, dy = B.y - A.y; let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, A.x - b.x0], [dx, b.x1 - A.x], [-dy, A.y - b.y0], [dy, b.y1 - A.y]]) {
    if (!p) { if (q < 0) return null; continue; }
    const r = q / p; if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
  }
  return t1 - t0 > 1e-6 ? [t0, t1].map((t) => ({ x: A.x + dx * t, y: A.y + dy * t })) : null;
}
// The section's ends (S.block.ends): its letters boxed (A, A′) over the terrain where the section line crosses the
// block's edges, nudged off what is placed.
function ends(ctx, K, lay) {
  const G = H.G, { u } = K, [A, Bp] = H.sectionEnds(), seg = clipToBox(A, Bp, G.B), tags = H.ext('sections')?.tags() || ['A', 'A′'];
  (seg || []).forEach((p, i) => {
    const s = H.proj(G.V(p.x, p.y, G.surf(p.x, p.y))); if (s[2] > 1) return;
    const spots = [[0, -30], [0, -56], [-38, -22], [38, -22], [0, -82], [-64, -40], [64, -40], [-64, 0], [64, 0], [0, -110]].map(([dx, dy]) => [s[0] + dx * u, s[1] + dy * u]), box = ([x, y]) => [x - 15 * u, y - 13 * u, x + 15 * u, y + 13 * u];
    const at2 = spots.find((q) => lay.clear(box(q))) || spots[0];
    lay.add(box(at2)); H.tagLabel(ctx, K, tags[i], ...at2); last.ends.push({ tag: tags[i], x: Math.round(p.x), y: Math.round(p.y) });
  });
}
// A flat scale bar under the figure, at the left (S.block.scale "flat"): true at the block's centre, level across the
// screen, with a note (the view and the coordinate system, or S.block.scaleNote; "" for none).
function flatScale(ctx, K, lay, footTop) {
  const G = H.G, { u, m, font } = K, B = G.B, cam = H.getCam(), cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2, cz = (B.z0 + G.surf(cx, cy)) / 2;
  H.camera.updateMatrixWorld();
  const r = new THREE.Vector3().setFromMatrixColumn(H.camera.matrixWorld, 0), d = Math.hypot(r.x, r.z) || 1, e = r.x / d, n = -r.z / d; // the screen's right, level, in metres east and north
  const p0 = H.proj(G.V(cx, cy, cz)), p1 = H.proj(G.V(cx + e * 100, cy + n * 100, cz)), ppm = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 100, D = ppm > 0 && roundBelow(0.2 * H.frame()[0] / ppm);
  if (!D) return;
  const bw = D * ppm, geo = H.geo(), note = S.block.scaleNote ?? `Scale at block centre · looking ${H.pad3(cam.azimuth)}°, plunge ${cam.plunge}°${geo?.label ? ` · ${geo.label}` : ''}`;
  font(400, 10); const nw = note ? ctx.measureText(note).width : 0, x = m + (S.block.page === 'bare' ? 0 : 175 * u), y = footTop - (note ? 30 : 14) * u; // right of the view's compass, where drawn
  lay.add([x - 4 * u, y - 18 * u, x + Math.max(bw, nw) + 6 * u, y + (note ? 22 : 8) * u]);
  for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? H.paper() : H.INK; ctx.fillRect(x + bw * i / 4, y, bw / 4, 4.5 * u); }
  ctx.strokeStyle = H.INK; ctx.lineWidth = 0.8 * u; ctx.strokeRect(x, y, bw, 4.5 * u);
  font(600, 11); ctx.fillStyle = H.INK; ctx.textBaseline = 'alphabetic';
  [[0, '0'], [0.5, String(D / 2)], [1, `${D} m`]].forEach(([f, t], i) => { ctx.textAlign = ['left', 'center', 'right'][i]; ctx.fillText(t, x + bw * f + (i === 2 ? ctx.measureText(' m').width / 2 : 0), y - 5 * u); });
  if (note) { font(400, 10); ctx.textAlign = 'left'; ctx.fillStyle = H.MUTED; ctx.fillText(note, x, y + 18 * u); }
  ctx.textAlign = 'left'; last.scale = { metres: D, px: +bw.toFixed(1), note };
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
  side = { f: null, rects: [] };
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
  const hf = lowTop(0.05, 0.98) - z0, ext0 = H.extSections(), rel = S.block.legend && releaseSecs(H.legendSecs(), ext0), ext = rel ? [] : ext0, secs = rel || [...ext, ...H.legendSecs().filter((s) => s.key !== 'holes' || s.rows.length > 1)];
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
      if (uc - span / 2 > 0.12 && uc + span / 2 < 0.99 && zc + lh / k / 2 < z0 + 0.94 * hf) { F.logo = { uc, zc, lw, lh, sc, img, word, k, span }; break; }
    }
  }
  // Depth ticks down the face's near corner (at u = 0), below the terrain there.
  const t0 = top(0.004), ticks = depthTicks(t0, z0, 0.1 * ht), kz = hyp(frameAt(F, 0.02, (t0 + z0) / 2).b);
  if (!S.block.ticks && ticks.length >= 2 && (ticks[1] - ticks[0]) * kz > 34 * u) F.ticks = { t0, ticks };
  // The scale bar along the base, left of the legend.
  const room = ((F.legend ? F.legend.uc - F.legend.span / 2 : 0.92) - 0.14) * F.len, D = roundBelow(Math.min(room, 0.45 * F.len));
  if (S.block.scale !== 'flat' && D && D * hyp(frameAt(F, 0.3, z0).a) > 70 * u) F.scale = { D };
  const R = (o, hg) => [o.uc - o.span / 2, o.uc + o.span / 2, o.zc - hg / o.k / 2, o.zc + hg / o.k / 2];
  side = { f: F.f, rects: [F.legend && R(F.legend, F.legend.h * F.legend.sc), F.logo && R(F.logo, F.logo.lh)].filter(Boolean) }; // for the wall labels by unit
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
      <label class="check"><input type="checkbox" data-bk="traces" ${b.traces === 'overlay' ? 'checked' : ''}>Thin traces over the faces</label><label class="check"><input type="checkbox" data-bk="units" ${b.units === 'auto' ? 'checked' : ''}>Unit wall labels inside their band</label>
      </div>
    <div class="grid2" style="margin-top:6px"><label class="field"><span>Brackets</span><select data-bs="brackets">${[['plain', 'Plain: bracket and bold result'], ['callout', 'Callout: heading, hole chip, result'], ['card', 'In a card']].map(([v, t]) => `<option value="${v}" ${b.brackets === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span>See-through terrain</span><select data-bs="surface"><option value="vivid" ${b.surface === 'vivid' ? 'selected' : ''}>Keeps its colours (holes show through)</option><option value="mix" ${b.surface !== 'vivid' ? 'selected' : ''}>Plain transparency</option></select></label>
      <label class="field"><span>Fade at the bottom <output class="mono">${Math.round((b.fadeBottom || 0) * 100)}%</output></span><input type="range" min="0" max="100" step="5" data-bf value="${Math.round((b.fadeBottom || 0) * 100)}" aria-label="Fade at the bottom of the block"></label></div>
    <div class="grid2" style="margin-top:6px"><label class="field"><span>Page</span><select data-bs="page">${[['bare', 'The block alone (credits only)'], ['clean', 'No title block'], ['full', 'Title block, compass and notes'], ['side', 'Side title: title left, logo and legend right']].map(([v, t]) => `<option value="${v}" ${b.page === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${b.page === 'side' ? `<label class="field"><span>Info line under the title</span><input type="text" data-bi value="${esc(b.info ?? '')}" placeholder="3D cutaway · looking ${compass8(H.getCam().azimuth)}"></label>` : ''}
      <label class="field"><span>Bar shape</span><select data-bh="style"><option value="spikes" ${hb.style === 'spikes' ? 'selected' : ''}>A spike per assay</option><option value="bars" ${hb.style !== 'spikes' && hb.style !== 'thick' ? 'selected' : ''}>Merged bars</option><option value="thick" ${hb.style === 'thick' ? 'selected' : ''}>Thick bars along the hole</option></select></label>
      <label class="field"><span>Bar colours</span><select data-bh="palette"><option value="orange" ${hb.palette === 'orange' ? 'selected' : ''}>Orange ramp</option><option value="bins" ${hb.palette !== 'orange' && hb.palette !== 'release' ? 'selected' : ''}>The grade colours</option><option value="release" ${hb.palette === 'release' ? 'selected' : ''}>Yellow to magenta (none below the first)</option></select></label></div>
    <div class="grid2" style="margin-top:6px"><label class="field"><span>Grade bars</span><select data-bh="side"><option value="face" ${hb.side === 'face' ? 'selected' : ''}>On the front face</option><option value="screen" ${hb.side !== 'face' ? 'selected' : ''}>Facing the camera</option></select></label>
      <label class="field"><span>Bar length</span><select data-bh="scale"><option value="linear" ${hb.scale !== 'log' ? 'selected' : ''}>By grade</option><option value="log" ${hb.scale === 'log' ? 'selected' : ''}>By grade, log scale</option></select></label>
      ${hb.style === 'thick' ? `<label class="field"><span>Bar width <output class="mono">${hb.width || 1}×</output></span><input type="range" min="0.5" max="3" step="0.25" data-bw value="${hb.width || 1}" aria-label="Width of the thick bars"></label>` : ''}</div>
    <div class="grid2" style="margin-top:6px"><label class="field"><span>Ticks</span><select data-bs="ticks">${[['depth', 'Depths on the side face'], ['elevation', 'Elevations on the left edge'], ['none', 'None']].map(([v, t]) => `<option value="${v}" ${(b.ticks || 'depth') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span>Scale bar</span><select data-bs="scale"><option value="face" ${b.scale !== 'flat' ? 'selected' : ''}>In perspective on the face</option><option value="flat" ${b.scale === 'flat' ? 'selected' : ''}>Flat, under the figure</option></select></label>
      ${b.scale === 'flat' ? `<label class="field"><span>Scale note</span><input type="text" data-bn value="${esc(b.scaleNote ?? '')}" placeholder="Scale at block centre · looking …"></label>` : ''}</div>
    <div class="row" style="gap:14px;flex-wrap:wrap;margin-top:6px"><label class="check"><input type="checkbox" data-bc ${b.colors ? 'checked' : ''}>A colour per hole</label><label class="check"><input type="checkbox" data-bo="ends" ${b.ends ? 'checked' : ''}>A and A′ at the section's ends</label>
      <label class="check"><input type="checkbox" data-bo="pad" ${b.pad ? 'checked' : ''}>One label per drill pad</label><label class="check"><input type="checkbox" data-bo="legend" ${b.legend ? 'checked' : ''}>Release legend</label>
      <label class="check"><input type="checkbox" data-bo="inclFrom" ${b.inclFrom === false ? 'checked' : ''}>No "from" on incl. lines</label></div>
    ${b.colors ? `<div class="row" style="gap:10px;flex-wrap:wrap;margin-top:6px">${Object.entries(b.colors).filter(([id]) => holes.some((h) => h.id === id)).map(([id, c]) => `<label class="check"><input type="color" data-hc="${esc(id)}" value="${c}" aria-label="Colour of ${esc(id)}">${esc(id)}</label>`).join('')}</div>` : ''}
    ${b.pad ? `<label class="field" style="margin-top:6px"><span>Pad label</span><input type="text" data-bp value="${esc(typeof b.pad === 'string' ? b.pad : '')}" placeholder="${esc(pads()[0]?.text || '077 & 078')}"></label>` : ''}
    ${b.legend ? `<div class="grid2" style="margin-top:6px">${[['assay', 'Assay heading', `ASSAY · ${S.valueLabel}`], ['geology', 'Geology heading', 'GEOLOGY'], ['holes', 'Holes row', 'Holes … (this release)'], ['bracket', 'Bracket row', 'Published interval (down-hole)']].map(([k, t, ph]) => `<label class="field"><span>${t}</span><input type="text" data-bl="${k}" value="${esc(b.legend[k] ?? '')}" placeholder="${esc(ph)}"></label>`).join('')}</div>` : ''}
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
  const V = { traces: ['overlay', 'tubes'], units: ['auto', 'fixed'] };
  el.querySelector('[data-bf]')?.addEventListener('change', (e) => run(() => H.api.setBlock({ fadeBottom: +e.target.value / 100 })));
  el.querySelectorAll('[data-bk]').forEach((cb) => cb.addEventListener('change', () => run(() => H.api.setBlock({ [cb.dataset.bk]: V[cb.dataset.bk] ? V[cb.dataset.bk][cb.checked ? 0 : 1] : cb.checked }))));
  el.querySelectorAll('[data-bh]').forEach((s) => s.addEventListener('change', () => run(() => H.api.setBlock({ hist: { [s.dataset.bh]: s.value } }))));
  el.querySelector('[data-bw]')?.addEventListener('change', (e) => run(() => H.api.setBlock({ hist: { width: +e.target.value } })));
  // Round 5H: a colour per hole (the callout holes shown first, up to six), the switches and their texts.
  el.querySelector('[data-bc]')?.addEventListener('change', (e) => run(() => H.api.setBlock({ colors: e.target.checked ? Object.fromEntries(holes.filter((h) => on.has(h.id)).sort((p, q) => co.has(q.id) - co.has(p.id)).slice(0, 6).map((h, i) => [h.id, HOLE_COLORS[i]])) : null })));
  el.querySelectorAll('[data-bo]').forEach((cb) => cb.addEventListener('change', () => run(() => H.api.setBlock({ [cb.dataset.bo]: cb.dataset.bo === 'inclFrom' ? !cb.checked : cb.checked }))));
  el.querySelectorAll('[data-hc]').forEach((x) => x.addEventListener('change', () => run(() => H.api.setBlock({ colors: { [x.dataset.hc]: x.value } }))));
  el.querySelectorAll('[data-bl]').forEach((x) => x.addEventListener('change', () => run(() => H.api.setBlock({ legend: { [x.dataset.bl]: x.value.trim() || null } }))));
  el.querySelector('[data-bp]')?.addEventListener('change', (e) => run(() => H.api.setBlock({ pad: e.target.value.trim() || true })));
  el.querySelector('[data-bn]')?.addEventListener('change', (e) => run(() => H.api.setBlock({ scaleNote: e.target.value.trim() || null })));
  const q = el.querySelector('[data-hq]'), filter = () => el.querySelectorAll('.prov-list label').forEach((l) => { l.hidden = !!query && !l.textContent.toLowerCase().includes(query); });
  if (q) { q.value = query; q.addEventListener('input', () => { query = q.value.trim().toLowerCase(); filter(); }); filter(); }
}
