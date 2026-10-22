// The drill plan on a 2D map (project.drillPlan; opt-in, a map without one draws exactly as before): each hole's
// plan-projected trace in its colour, the assay intervals as thick bars in their bin colours, collar markers (a
// split-colour one for a common pad, whose traces can be fanned apart), hole-ID pills at the toes, a dark tag at
// each published interval, the release's results card, a highlight card for a discovery and a section line A–A′.
//
// Everything is laid out here once, as the Studio cards' primitives (utils/studioCards.js: rect, path, text,
// line, circle, poly, and pline for open polylines), in composition px: the editor stage draws them as SVG
// (components/DrillPlanOverlay.jsx), the PNG exporter paints them on its canvas and the SVG exporter writes them
// as markup, so the three agree. Tags and cards place themselves clear of the traces, the panels and each
// other unless dragged (plan.pos[key]: their offset from their anchor).
//
// Loaded by the lazy overlay and by the exporter only when a map has a drill plan.

import { measureText, cardShell, textOn } from './studioCards.js';
import { holeColors, binsOf, releaseHoles, byHole } from './drillPlanLegend.js';
import { pubCallouts, pubLines, isApproved } from '../three-d/published-results.js';
import { letters, lookingWord } from '../../shared/sectionGeometry.js';
import { getMapFrame } from './coordinateFrame.js';

export const PAD_RADIUS_M = 5;
export const FAN_PX = 6;
const BAR_OFF = 5.5; // px from a trace's centre line to its assay bars'
const INK = '#142126', NAVY = '#14262e', GOLD = '#f5c518', NEW_GREEN = '#2f9e44';
const key = (id) => String(id ?? '').trim().toLowerCase();
const tx = (x, y, s, size, weight, family, fill, o = {}) => ({ t: 'text', x, y, s: String(s ?? ''), size, weight, family, fill, anchor: 'start', ls: 0, ...o });
const mix = (hex, w = 0.5) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - w) + 255 * w).toString(16).padStart(2, '0')).join('')}`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const minus = (v) => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v))}°`;
const RAD = Math.PI / 180;

function metres(a, b) {
  const p1 = a.lat * RAD, p2 = b.lat * RAD, dp = p2 - p1, dl = (b.lng - a.lng) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Collars within `radius` metres of each other, grouped: [{ key: 'pad:077+078', ids, lng, lat }] (two holes or more). */
export function padsOf(plan, radius = PAD_RADIUS_M) {
  const hs = [...(plan?.holes || [])].sort((a, b) => byHole(a.id, b.id)), parent = hs.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) if (metres(hs[i], hs[j]) <= radius) parent[root(j)] = root(i);
  const groups = new Map();
  hs.forEach((h, i) => { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(h); });
  return [...groups.values()].filter((g) => g.length > 1).map((g) => ({
    key: `pad:${g.map((h) => h.id).join('+')}`, ids: g.map((h) => h.id),
    lng: g.reduce((s, h) => s + h.lng, 0) / g.length, lat: g.reduce((s, h) => s + h.lat, 0) / g.length,
  }));
}

// ── Paths in px ─────────────────────────────────────────────────────────────
// The point at depth d along a px path of [x, y, depth] (past the end: the end).
function at(pts, d) {
  if (pts.length === 1 || d <= pts[0][2]) return [pts[0][0], pts[0][1]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (d <= b[2]) { const t = (d - a[2]) / ((b[2] - a[2]) || 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  }
  const e = pts[pts.length - 1]; return [e[0], e[1]];
}
// The px polyline between depths d0 and d1, at least `min` px long (grown about its middle).
function span(pts, d0, d1, min = 3) {
  const out = [at(pts, d0)];
  pts.forEach((p) => { if (p[2] > d0 && p[2] < d1) out.push([p[0], p[1]]); });
  out.push(at(pts, d1));
  const len = out.reduce((s, p, i) => s + (i ? dist(p, out[i - 1]) : 0), 0);
  if (len >= min) return out;
  const a = out[0], b = out[out.length - 1], dir = dirOf(pts), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return [[c[0] - (dir[0] * min) / 2, c[1] - (dir[1] * min) / 2], [c[0] + (dir[0] * min) / 2, c[1] + (dir[1] * min) / 2]];
}
// The unit px direction from collar to toe, or east for a vertical hole.
function dirOf(pts) {
  const a = pts[0], b = pts[pts.length - 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return l > 0.5 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [1, 0];
}

// ── Measuring and boxes ─────────────────────────────────────────────────────
// Boxes are [x0, y0, x1, y1] (as the 3D page's layout helpers take them; kept here so /3d's chunks stay as they are).
const hits = (a, b, pad = 0) => !(a[2] + pad < b[0] || a[0] - pad > b[2] || a[3] + pad < b[1] || a[1] - pad > b[3]);
const overlapArea = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
// Whether the segment p→q passes through box b grown by pad (Liang–Barsky).
function segHits(p, q, b, pad = 0) {
  let t0 = 0, t1 = 1; const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [d, lo, hi, o] of [[dx, b[0] - pad, b[2] + pad, p[0]], [dy, b[1] - pad, b[3] + pad, p[1]]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
    let a = (lo - o) / d, c = (hi - o) / d; if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) return false;
  }
  return true;
}
const W = (s, size, weight, family, ls = 0) => measureText(s, size, weight, family, ls);
const box = (x, y, w, h) => [x, y, x + w, y + h];
const nearestOn = (b, p) => [Math.max(b[0], Math.min(b[2], p[0])), Math.max(b[1], Math.min(b[3], p[1]))];

/** The panels (title, legend, locator, logo, scale, north) as boxes, for tags and cards to keep clear of. */
export function panelBoxes(zones = {}, layout = {}) {
  const on = { title: layout.showTitle !== false, legend: layout.showLegend !== false, inset: layout.insetEnabled !== false, logo: !!layout.logo, northArrow: layout.showNorthArrow !== false, scaleBar: layout.showScaleBar !== false };
  return Object.entries(on).filter(([k, v]) => v && zones[k]?.width > 0 && zones[k]?.height > 0).map(([k]) => box(zones[k].left, zones[k].top, zones[k].width, zones[k].height));
}

// ── Cards ───────────────────────────────────────────────────────────────────
// Each card is { w, h, draw(x, y) → prims } laid out from its text.
function chip(x, y, id, color, family, size = 9) {
  const w = W(id, size, 800, family) + 8;
  return { w, prims: [{ t: 'rect', x, y, w, h: size + 4.5, r: 2.5, fill: color, opacity: 1, stroke: color === '#ffffff' ? 'rgba(20,33,38,0.35)' : null, sw: 1 }, tx(x + 4, y + size + 0.8, id, size, 800, family, textOn(color))] };
}

// A published interval's tag: hole-ID chip and domain heading, the bold result, its "incl." line.
function tagCard(c, color, family) {
  const p = 7, head = String(c.heading || '').toUpperCase(), main = c.l1, incl = c.l2 || '';
  const cw = W(c.id, 9, 800, family) + 8, hw = head ? W(head, 7.5, 700, family, 0.8) + 6 : 0;
  const w = Math.ceil(p * 2 + Math.max(cw + hw, W(main, 12.5, 800, family), incl ? W(incl, 8.5, 500, family) : 0));
  const h = p * 2 + 13.5 + 4 + 14 + (incl ? 12 : 0);
  return {
    w, h,
    draw: (x, y) => {
      const ch = chip(x + p, y + p, c.id, color, family);
      return [
        { t: 'rect', x, y, w, h, r: 5, fill: NAVY, opacity: 0.94, shadow: true },
        ...ch.prims,
        ...(head ? [tx(x + p + ch.w + 6, y + p + 9.6, head, 7.5, 700, family, mix(color === '#ffffff' ? '#9fd3ff' : color, 0.45), { ls: 0.8 })] : []),
        tx(x + p, y + p + 13.5 + 4 + 11.5, main, 12.5, 800, family, '#ffffff', { role: 'result' }),
        ...(incl ? [tx(x + p, y + p + 13.5 + 4 + 14 + 9, incl, 8.5, 500, family, 'rgba(255,255,255,0.8)')] : []),
      ];
    },
  };
}

// The release's results card: NEW pill and release date, a title, then per hole its chip with each result's
// domain heading, bold interval and "incl." lines.
function resultsCard(groups, rel, family, accent) {
  const p = 12, date = rel.date ? `RELEASED ${String(rel.date).toUpperCase()}` : '', title = rel.title || '';
  const lines = [];
  groups.forEach((g, gi) => {
    if (gi) lines.push({ kind: 'rule', h: 9 });
    g.items.forEach((it, i) => {
      lines.push({ kind: 'head', h: 15, chip: i === 0 ? g.id : null, color: g.color, s: String(it.heading || '').toUpperCase() });
      lines.push({ kind: 'main', h: 17, s: it.l1 });
      if (it.l2) lines.push({ kind: 'incl', h: 12, s: it.l2 });
      if (i < g.items.length - 1) lines.push({ kind: 'gap', h: 5 });
    });
  });
  const cw = (l) => (l.chip ? W(l.chip, 9, 800, family) + 14 : 0);
  const widths = lines.map((l) => (l.kind === 'head' ? cw(l) + W(l.s, 7.5, 700, family, 0.8) : l.kind === 'main' ? W(l.s, 14, 800, family) : l.kind === 'incl' ? W(l.s, 9, 400, family) : 0));
  const top = (rel.isNew !== false || date ? 22 : 0) + (title ? 24 : 0);
  const w = Math.ceil(Math.max(200, p * 2 + 6 + Math.max(...widths, title ? W(title, 15, 800, family) : 0, (rel.isNew !== false ? 38 : 0) + W(date, 8, 650, family, 0.8))));
  const h = Math.ceil(p * 2 + top + lines.reduce((s, l) => s + l.h, 0));
  return {
    w, h,
    draw: (x, y) => {
      const x0 = x + p + 6, out = cardShell({ opacity: 0.97, fill: '#ffffff', edge: 'rgba(20,33,38,0.12)', shadow: true, radius: 8, accent: 'left', accentColor: accent }, x, y, w, h);
      let yy = y + p;
      if (rel.isNew !== false || date) {
        let dx = 0;
        if (rel.isNew !== false) { out.push({ t: 'rect', x: x0, y: yy, w: 32, h: 15, r: 7.5, fill: NEW_GREEN, opacity: 1 }, tx(x0 + 16, yy + 10.6, 'NEW', 8, 800, family, '#ffffff', { anchor: 'middle', ls: 0.6, role: 'new' })); dx = 38; }
        if (date) out.push(tx(x0 + dx, yy + 10.6, date, 8, 650, family, '#5f6e72', { ls: 0.8, role: 'released' }));
        yy += 22;
      }
      if (title) { out.push(tx(x0, yy + 15, title, 15, 800, family, '#16466e', { role: 'title' })); yy += 24; }
      lines.forEach((l) => {
        if (l.kind === 'rule') out.push({ t: 'line', x1: x0, y1: yy + 4.5, x2: x + w - p, y2: yy + 4.5, stroke: 'rgba(20,33,38,0.16)', sw: 1 });
        else if (l.kind === 'head') {
          let dx = 0;
          if (l.chip) { const ch = chip(x0, yy, l.chip, l.color, family); out.push(...ch.prims); dx = ch.w + 6; }
          if (l.s) out.push(tx(x0 + dx, yy + 9.8, l.s, 7.5, 700, family, '#5f6e72', { ls: 0.8 }));
        } else if (l.kind === 'main') out.push(tx(x0, yy + 13.5, l.s, 14, 800, family, INK, { role: 'result' }));
        else if (l.kind === 'incl') out.push(tx(x0, yy + 9, l.s, 9, 400, family, '#5f6e72'));
        yy += l.h;
      });
      return out;
    },
  };
}

function starPts(cx, cy, r, inner = 0.45) {
  return Array.from({ length: 10 }, (_, i) => { const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * inner : r; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; });
}

// The highlight card: a star and the heading, a caps subline, the main result and a secondary one.
function highlightCard(hl, family) {
  const p = 11, head = String(hl.heading || '').toUpperCase(), sub = String(hl.sub || '').toUpperCase(), main = hl.main || '', second = hl.second || '';
  const w = Math.ceil(Math.max(180, p * 2 + 6 + Math.max(18 + W(head, 13.5, 800, family, 0.3), W(sub, 8, 650, family, 0.9), W(main, 15, 800, family), W(second, 10, 500, family))));
  const h = Math.ceil(p * 2 + 18 + (sub ? 14 : 0) + (main ? 20 : 0) + (second ? 14 : 0));
  return {
    w, h,
    draw: (x, y) => {
      const x0 = x + p + 6, out = cardShell({ opacity: 0.95, fill: NAVY, edge: null, shadow: true, radius: 6, accent: 'left', accentColor: GOLD }, x, y, w, h);
      let yy = y + p;
      out.push({ t: 'poly', pts: starPts(x0 + 6.5, yy + 7.5, 7), fill: GOLD, opacity: 1 });
      out.push(tx(x0 + 18, yy + 13, head, 13.5, 800, family, GOLD, { ls: 0.3, role: 'heading' }));
      yy += 18;
      if (sub) { out.push(tx(x0, yy + 9.5, sub, 8, 650, family, 'rgba(255,255,255,0.82)', { ls: 0.9 })); yy += 14; }
      if (main) { out.push(tx(x0, yy + 15, main, 15, 800, family, '#ffffff', { role: 'result' })); yy += 20; }
      if (second) out.push(tx(x0, yy + 10.5, second, 10, 500, family, 'rgba(255,255,255,0.88)'));
      return out;
    },
  };
}

// The common pad's tag: "COMMON DRILL PAD" over "077 −50° / 078 −70° → NW", each ID in its hole's colour.
function padCard(pad, holes, colors, fanned, family) {
  const p = 7, size = 12, parts = pad.ids.map((id) => { const h = holes.find((x) => x.id === id); return { id, color: colors.get(key(id)), dip: Number.isFinite(h?.dip) ? minus(h.dip) : '' }; });
  const az = pad.ids.map((id) => holes.find((x) => x.id === id)?.az).filter(Number.isFinite);
  const toward = az.length ? `→ ${lookingWord(az.reduce((s, a) => s + a, 0) / az.length)}` : '';
  // Words with the gaps between them as space (an SVG viewer would drop a leading space in the text itself).
  const segs = [], gap = 4; parts.forEach((q, i) => { if (i) segs.push({ s: '/', fill: '#ffffff', w: 650 }); segs.push({ s: q.id, fill: q.color === '#ffffff' ? '#ffffff' : mix(q.color, 0.1), w: 800 }); if (q.dip) segs.push({ s: q.dip, fill: '#ffffff', w: 700 }); });
  if (toward) segs.push({ s: toward, fill: '#ffffff', w: 700 });
  const rowW = segs.reduce((s, g) => s + W(g.s, size, g.w, family), 0) + gap * (segs.length - 1), note = fanned ? 'traces offset for clarity' : '';
  const w = Math.ceil(p * 2 + Math.max(W('COMMON DRILL PAD', 7.5, 700, family, 0.8), rowW, note ? W(note, 8.5, 500, family) : 0));
  const h = p * 2 + 9.5 + 4 + 14 + (note ? 12 : 0);
  return {
    w, h,
    draw: (x, y) => {
      const out = [{ t: 'rect', x, y, w, h, r: 5, fill: NAVY, opacity: 0.94, shadow: true }, tx(x + p, y + p + 8, 'COMMON DRILL PAD', 7.5, 700, family, 'rgba(255,255,255,0.75)', { ls: 0.8, role: 'pad-heading' })];
      let xx = x + p;
      segs.forEach((g) => { out.push(tx(xx, y + p + 9.5 + 4 + 11, g.s, size, g.w, family, g.fill)); xx += W(g.s, size, g.w, family) + gap; });
      if (note) out.push(tx(x + p, y + p + 9.5 + 4 + 14 + 9, note, 8.5, 500, family, 'rgba(255,255,255,0.8)'));
      return out;
    },
  };
}

// ── Layout ──────────────────────────────────────────────────────────────────
/**
 * The plan's primitives for a view: { base, over, targets }. base: the section line, traces, assay bars, collars
 * and toe pills; over: the star, tags, pad tags and cards with their leaders; targets: what the stage lets you
 * drag ({ key, box, anchor }). view: { pt(lng, lat) → [x, y], W, H, panels: [box], family, accent }.
 */
export function planLayout(plan, view) {
  const base = [], over = [], targets = [];
  if (!plan?.holes?.length) return { base, over, targets, hidden: [] };
  const { pt, W: FW, H: FH, panels = [], family = 'Inter' } = view;
  const edge = view.frame || [0, 0, FW, FH]; // the map's frame (inside the coordinate ticks), else the stage
  const show = { traces: true, bars: true, pills: true, collars: true, tags: true, padTag: true, card: false, ...(plan.show || {}) };
  const colors = holeColors(plan), rel = releaseHoles(plan), pads = padsOf(plan), fan = plan.fan || {};
  const holes = [...plan.holes].sort((a, b) => byHole(a.id, b.id));
  const padOf = new Map(); pads.forEach((p) => p.ids.forEach((id) => padOf.set(id, p)));

  // Each hole in px, fanned apart (perpendicular to the pad's mean direction) when its pad is fanned.
  const px = new Map(), side = new Map(); // side: which side of its trace a hole's assay bars run (+1 or −1)
  holes.forEach((h) => px.set(h.id, (h.path?.length ? h.path : [[h.lng, h.lat, 0]]).map(([lng, lat, d]) => [...pt(lng, lat), d])));
  pads.filter((p) => fan[p.key]).forEach((p) => {
    const ds = p.ids.map((id) => dirOf(px.get(id))), m = [ds.reduce((s, d) => s + d[0], 0), ds.reduce((s, d) => s + d[1], 0)], l = Math.hypot(...m) || 1, n = [-m[1] / l, m[0] / l];
    p.ids.forEach((id, i) => { const o = (i - (p.ids.length - 1) / 2) * FAN_PX; side.set(id, o < 0 ? -1 : 1); px.set(id, px.get(id).map(([x, y, d]) => [x + n[0] * o, y + n[1] * o, d])); });
  });
  const segs = []; // trace segments, for tags and cards to keep off
  holes.forEach((h) => { const q = px.get(h.id); for (let i = 1; i < q.length; i++) segs.push([q[i - 1], q[i]]); });

  // Section line A–A′: a dashed line, boxed letters past each end, its name along it.
  const sec = plan.section, endBoxes = [];
  if (sec?.a && sec?.b) {
    const a = pt(sec.a.lng, sec.a.lat), b = pt(sec.b.lng, sec.b.lat), l = dist(a, b) || 1, u = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const [la, lb] = letters({ id: 'A', ...sec, name: sec.name || 'A–A′' });
    base.push({ t: 'pline', pts: [a, b], stroke: '#0b1a20', sw: 3.6, opacity: 0.4, cap: 'butt' }, { t: 'pline', pts: [a, b], stroke: '#ffffff', sw: 1.7, dash: [7, 5], cap: 'butt' });
    // Each end's box just past the end, or (when that is off the frame or under a panel) moved in along the line,
    // so both letters always show while their ends are on the map.
    [[a, -1, la], [b, 1, lb]].forEach(([p, s, t]) => {
      const bw = Math.max(18, W(t, 10.5, 800, family) + 8), fits = (c) => c[0] - bw / 2 >= edge[0] + 2 && c[1] - 9 >= edge[1] + 2 && c[0] + bw / 2 <= edge[2] - 2 && c[1] + 9 <= edge[3] - 2 && !panels.some((o) => hits([c[0] - bw / 2, c[1] - 9, c[0] + bw / 2, c[1] + 9], o, 2));
      const spots = [13, -13, -30, -50, -75, -105].filter((d) => d > 0 || -d < l / 2).map((d) => [p[0] + u[0] * d * s, p[1] + u[1] * d * s]);
      const c = spots.find(fits) || spots[0];
      endBoxes.push([c[0] - bw / 2, c[1] - 9, c[0] + bw / 2, c[1] + 9]);
      base.push({ t: 'rect', x: c[0] - bw / 2, y: c[1] - 9, w: bw, h: 18, r: 3, fill: '#1d4f7a', opacity: 1, stroke: '#ffffff', sw: 1.2 }, tx(c[0], c[1] + 3.8, t, 10.5, 800, family, '#ffffff', { anchor: 'middle', role: 'section-end' }));
    });
    const label = String(sec.label ?? `SECTION ${sec.name || 'A–A′'}`).toUpperCase();
    if (label) {
      let ang = Math.atan2(u[1], u[0]) / RAD, nrm = [-u[1], u[0]];
      if (ang > 90 || ang < -90) { ang += ang > 0 ? -180 : 180; nrm = [u[1], -u[0]]; }
      // Near A, on the side above the text, reading left to right.
      const d0 = Math.min(l / 2, 30 + W(label, 8, 700, family, 1) / 2), c = [a[0] + u[0] * d0 - nrm[0] * 7, a[1] + u[1] * d0 - nrm[1] * 7];
      base.push(tx(c[0], c[1], label, 8, 700, family, '#ffffff', { ls: 1, rot: ang, anchor: 'middle', halo: { color: '#0b1a20', width: 2.6, opacity: 0.6 }, role: 'section-label' }));
    }
  }

  // Traces: a dark casing under each hole's colour.
  if (show.traces) {
    holes.forEach((h) => { const q = px.get(h.id); if (q.length > 1) base.push({ t: 'pline', pts: q.map(([x, y]) => [x, y]), stroke: '#0b1a20', sw: 4.6, opacity: 0.5 }); });
    holes.forEach((h) => { const q = px.get(h.id); if (q.length > 1) base.push({ t: 'pline', pts: q.map(([x, y]) => [x, y]), stroke: colors.get(key(h.id)), sw: 2.6, role: 'trace' }); });
  }
  // Assay bars: each interval at or above the lowest bin, in its bin's colour, alongside its trace so the hole's
  // own colour stays in view (fanned pad holes on their outer sides); touching intervals of one bin are one bar.
  const els = plan.assays?.elements || [], ei = Math.max(0, els.findIndex((e) => e.name === plan.element)), bins = binsOf(plan);
  if (show.bars && els.length && bins.length) {
    const binOf = (v) => (Number.isFinite(v) ? bins.filter((b) => v >= b.min).pop() || null : null);
    const bars = [];
    holes.forEach((h) => {
      const d = dirOf(px.get(h.id)), k = BAR_OFF * (side.get(h.id) || 1), q = px.get(h.id).map(([x, y, dd]) => [x - d[1] * k, y + d[0] * k, dd]);
      let run = null;
      (plan.assays.rows?.[h.id] || []).forEach((r) => {
        const b = binOf(r[2 + ei]);
        if (run && b === run.b && r[0] <= run.t + 0.01) { run.t = r[1]; return; }
        if (run) bars.push(run);
        run = b ? { q, f: r[0], t: r[1], b } : null;
      });
      if (run) bars.push(run);
    });
    // Low grades first, so the high ones sit on top where bars meet.
    bars.sort((a, b) => a.b.min - b.b.min);
    bars.forEach((r) => base.push({ t: 'pline', pts: span(r.q, r.f, r.t), stroke: '#0b1a20', sw: 7.4, opacity: 0.55, cap: 'butt' }));
    bars.forEach((r) => base.push({ t: 'pline', pts: span(r.q, r.f, r.t), stroke: r.b.color, sw: 5.2, cap: 'butt', role: 'bar' }));
  }
  // Collars: a white disc ringed in the hole's colour; on a common pad, one disc split into each hole's colour.
  const avoid = [...panels, ...endBoxes];
  if (show.collars) {
    const done = new Set();
    holes.forEach((h) => {
      const p = padOf.get(h.id);
      if (p) {
        if (done.has(p.key)) return; done.add(p.key);
        const [cx, cy] = pt(p.lng, p.lat), r = 6.5, n = p.ids.length;
        p.ids.forEach((id, i) => {
          const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / n, a1 = a0 + (2 * Math.PI) / n, big = a1 - a0 > Math.PI ? 1 : 0;
          const f2 = (v) => +v.toFixed(2);
          base.push({ t: 'path', d: `M${f2(cx)},${f2(cy)}L${f2(cx + r * Math.cos(a0))},${f2(cy + r * Math.sin(a0))}A${r},${r} 0 ${big} 1 ${f2(cx + r * Math.cos(a1))},${f2(cy + r * Math.sin(a1))}Z`, fill: colors.get(key(id)) });
        });
        base.push({ t: 'circle', cx, cy, r, stroke: '#ffffff', sw: 1.8 }, { t: 'circle', cx, cy, r: r + 1.4, stroke: '#0b1a20', sw: 1, opacity: 0.5 });
        avoid.push([cx - 9, cy - 9, cx + 9, cy + 9]);
        return;
      }
      const [cx, cy] = pt(h.lng, h.lat), c = colors.get(key(h.id));
      base.push({ t: 'circle', cx, cy, r: 4.6, fill: '#ffffff', stroke: c === '#ffffff' ? '#0b1a20' : c, sw: 2.2 });
      avoid.push([cx - 6, cy - 6, cx + 6, cy + 6]);
    });
  }
  // Hole-ID pills at the toes, past the end of each trace (release holes placed first).
  if (show.pills) {
    [...holes].sort((a, b) => (rel.has(key(b.id)) ? 1 : 0) - (rel.has(key(a.id)) ? 1 : 0)).forEach((h) => {
      const q = px.get(h.id), own = new Set(q), c = colors.get(key(h.id)), w = W(h.id, 9.5, 800, family) + 10, ph = 15, d = dirOf(q), e = q[q.length - 1];
      let bx = null;
      for (const [s, side] of [[0, 0], [16, 0], [32, 0], [0, 1], [0, -1], [24, 1], [24, -1]]) {
        const r = Math.abs(d[0]) * w / 2 + Math.abs(d[1]) * ph / 2 + 5 + s, cx = e[0] + d[0] * r - d[1] * side * (ph + 3), cy = e[1] + d[1] * r + d[0] * side * (ph + 3);
        const b = [cx - w / 2, cy - ph / 2, cx + w / 2, cy + ph / 2];
        const clear = !avoid.some((o) => hits(b, o, 1)) && !segs.some(([s0, s1]) => !own.has(s0) && segHits(s0, s1, b, 1));
        if (clear || !bx) bx = b;
        if (clear) break;
      }
      avoid.push(bx);
      base.push({ t: 'rect', x: bx[0], y: bx[1], w, h: ph, r: ph / 2, fill: c, opacity: 1, stroke: c === '#ffffff' ? 'rgba(20,33,38,0.4)' : '#ffffff', sw: 1 },
        tx((bx[0] + bx[2]) / 2, bx[1] + 11, h.id, 9.5, 800, family, textOn(c), { anchor: 'middle', role: 'toe-pill' }));
    });
  }

  // ── Cards, tags and their leaders ──
  const frame = [edge[0] + 4, edge[1] + 4, edge[2] - 4, edge[3] - 4], placed = [], leaders = [];
  // What the panels or the frame edge hide: collars (a pad as one), the star and the section's ends.
  const hidden = [];
  const check = (what, q) => { const off = q[0] < edge[0] || q[1] < edge[1] || q[0] > edge[2] || q[1] > edge[3]; if (off || panels.some((o) => q[0] >= o[0] && q[0] <= o[2] && q[1] >= o[1] && q[1] <= o[3])) hidden.push({ what, off }); };
  const seenPad = new Set();
  holes.forEach((h) => { const p = padOf.get(h.id); if (p) { if (!seenPad.has(p.key)) { seenPad.add(p.key); check(`pad ${p.ids.join(' / ')}`, pt(p.lng, p.lat)); } } else check(`collar ${h.id}`, pt(h.lng, h.lat)); });
  if (sec?.a && sec?.b) { const [la, lb] = letters({ id: 'A', ...sec, name: sec.name || 'A–A′' }); check(`section end ${la}`, pt(sec.a.lng, sec.a.lat)); check(`section end ${lb}`, pt(sec.b.lng, sec.b.lat)); }
  if (plan.highlight?.at && show.highlight !== false) check('highlight star', pt(plan.highlight.at.lng, plan.highlight.at.lat));
  const crossings = (b) => segs.reduce((n, [p, q]) => n + (segHits(p, q, b, 2) ? 1 : 0), 0);
  // A card's box: where it was dragged (plan.pos[key], its top-left from the anchor), else the clearest spot
  // around the anchor: off the panels, pills, collars and other cards first, then off the traces, then near.
  function place(k, anchor, card, radii) {
    const own = plan.pos?.[k];
    if (own && Number.isFinite(own.dx) && Number.isFinite(own.dy)) return box(anchor[0] + own.dx, anchor[1] + own.dy, card.w, card.h);
    let best = null;
    radii.forEach((r, ri) => {
      for (let a = 0; a < 360; a += 30) {
        const t = (a - 45) * RAD, ux = Math.cos(t), uy = Math.sin(t), cx = anchor[0] + ux * (r + Math.abs(ux) * card.w / 2), cy = anchor[1] + uy * (r + Math.abs(uy) * card.h / 2);
        const b = box(cx - card.w / 2, cy - card.h / 2, card.w, card.h);
        if (b[0] < frame[0] || b[1] < frame[1] || b[2] > frame[2] || b[3] > frame[3]) continue;
        const lead = [anchor, nearestOn(b, anchor)];
        const blocked = [...avoid, ...placed].reduce((s, o) => s + (hits(b, o, 3) ? 1e5 + overlapArea(b, o) : 0), 0);
        const crossLead = [...placed].reduce((s, o) => s + (segHits(lead[0], lead[1], o, 1) ? 1 : 0), 0) + leaders.reduce((s, [p, q]) => s + (segsCross(p, q, lead[0], lead[1]) ? 1 : 0), 0);
        const score = blocked + crossings(b) * 4e3 + crossLead * 800 + ri * 120 + a / 360;
        if (!best || score < best.score) best = { b, score };
      }
    });
    return best ? best.b : box(Math.min(FW - card.w - 4, anchor[0] + 24), Math.max(4, anchor[1] - card.h - 24), card.w, card.h);
  }
  function put(k, anchor, card, radii, style) {
    const b = place(k, anchor, card, radii), end = nearestOn(b, anchor);
    placed.push(b);
    if (dist(end, anchor) > 2) {
      leaders.push([anchor, end]);
      over.push({ t: 'line', x1: anchor[0], y1: anchor[1], x2: end[0], y2: end[1], stroke: '#0b1a20', sw: style.sw + 1.6, opacity: 0.35 },
        { t: 'line', x1: anchor[0], y1: anchor[1], x2: end[0], y2: end[1], stroke: style.color, sw: style.sw, role: 'leader' });
      if (style.dot) over.push({ t: 'circle', cx: anchor[0], cy: anchor[1], r: 2.6, fill: '#ffffff', stroke: '#0b1a20', sw: 1 });
    }
    over.push(...card.draw(b[0], b[1]));
    targets.push({ key: k, box: b, anchor });
  }

  // The highlight: a star with a glow ring at its place, and its card.
  const hl = plan.highlight;
  if (hl?.at && show.highlight !== false) {
    const s = pt(hl.at.lng, hl.at.lat);
    over.push({ t: 'circle', cx: s[0], cy: s[1], r: 25, fill: GOLD, fo: 0.18, stroke: GOLD, sw: 1.6, opacity: 0.7 },
      { t: 'circle', cx: s[0], cy: s[1], r: 17, fill: GOLD, fo: 0.22 },
      { t: 'poly', pts: starPts(s[0], s[1], 14), fill: GOLD, opacity: 1, stroke: '#5c4300', sw: 1.3 });
    avoid.push([s[0] - 26, s[1] - 26, s[0] + 26, s[1] + 26]);
    targets.push({ key: 'star', box: [s[0] - 16, s[1] - 16, s[0] + 16, s[1] + 16], anchor: s });
    if (hl.heading || hl.main) put('hl', s, highlightCard(hl, family), [60, 110, 170, 240], { color: GOLD, sw: 1.4 });
  }

  // Published intervals on the plan's holes (approved, top-level; "incl." results as their second line).
  const holeById = new Map(holes.map((h) => [key(h.id), h]));
  const onPlan = (plan.results || []).filter((r) => isApproved(r) && holeById.has(key(r.holeId)));
  const cards = pubCallouts(onPlan.map((r) => ({ ...r, holeId: holeById.get(key(r.holeId)).id })), holes.map((h) => ({ id: h.id, len: h.len })));
  const heads = plan.headings || {};
  const items = cards.map((c) => { const L = pubLines(c); return { key: c.key, id: c.h.id, heading: heads[c.key] ?? c.pub.domain ?? '', l1: L.l1, l2: L.l2, from: c.pub.fromM, to: c.pub.toM }; });

  // The results card: per hole (in hole order) its results, upper first; one leader to the release's pad or collar.
  if (show.card && items.length) {
    const byHole = new Map(); items.forEach((it) => { if (!byHole.has(it.id)) byHole.set(it.id, []); byHole.get(it.id).push(it); });
    const groups = [...byHole.entries()].sort((a, b) => holes.findIndex((h) => h.id === a[0]) - holes.findIndex((h) => h.id === b[0]))
      .map(([id, l]) => ({ id, color: colors.get(key(id)), items: l.sort((a, b) => a.from - b.from) }));
    const firstPad = padOf.get(groups[0].id), first = holeById.get(key(groups[0].id));
    const anchor = firstPad ? pt(firstPad.lng, firstPad.lat) : pt(first.lng, first.lat);
    const release = { date: plan.release?.date ?? (plan.results || []).find((r) => r.releaseDate)?.releaseDate ?? '', title: plan.release?.title ?? '', isNew: plan.release?.isNew };
    put('card', anchor, resultsCard(groups, release, family, view.accent || NEW_GREEN), [140, 220, 300, 400], { color: view.accent || NEW_GREEN, sw: 1.5 });
  }
  // A tag at each published interval's middle, on its (fanned) trace.
  if (show.tags) items.forEach((it) => {
    const anchor = at(px.get(it.id), (it.from + it.to) / 2);
    put(`tag:${it.key}`, anchor, tagCard(it, colors.get(key(it.id)), family), [34, 60, 95, 140, 200], { color: '#ffffff', sw: 1.1, dot: true });
  });
  // The common pad's tag, near the pad.
  if (show.padTag && show.collars) pads.forEach((p) => {
    const anchor = pt(p.lng, p.lat);
    put(p.key, anchor, padCard(p, holes, colors, !!fan[p.key], family), [34, 60, 95, 140, 200], { color: '#ffffff', sw: 1.1, dot: true });
  });
  return { base, over, targets, hidden };
}
// Whether segments p1–p2 and q1–q2 cross.
function segsCross(p1, p2, q1, q2) {
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return o(p1, p2, q1) !== o(p1, p2, q2) && o(q1, q2, p1) !== o(q1, q2, p2);
}

// ── Fit to plan ─────────────────────────────────────────────────────────────
/** Everything the plan draws on the ground: hole paths, the star and the section's ends, as [[s, w], [n, e]]. */
export function planBounds(plan) {
  const pts = [];
  (plan?.holes || []).forEach((h) => (h.path?.length ? h.path : [[h.lng, h.lat]]).forEach(([lng, lat]) => pts.push([lng, lat])));
  if (plan?.highlight?.at) pts.push([plan.highlight.at.lng, plan.highlight.at.lat]);
  if (plan?.section?.a && plan?.section?.b) pts.push([plan.section.a.lng, plan.section.a.lat], [plan.section.b.lng, plan.section.b.lat]);
  if (!pts.length) return null;
  const lng = pts.map((p) => p[0]), lat = pts.map((p) => p[1]);
  return [[Math.min(...lat), Math.min(...lng)], [Math.max(...lat), Math.max(...lng)]];
}
/**
 * The largest box of the stage (W × H) clear of the panels for content of aspect w:h, as [x0, y0, x1, y1]: tried
 * between every panel edge, scored by how large the content can be drawn in it.
 */
export function freeRect(panels, FW, FH, w = 1, h = 1) {
  const xs = [...new Set([0, FW, ...panels.flatMap((b) => [b[0], b[2]])].map((v) => Math.max(0, Math.min(FW, v))))].sort((p, q) => p - q);
  const ys = [...new Set([0, FH, ...panels.flatMap((b) => [b[1], b[3]])].map((v) => Math.max(0, Math.min(FH, v))))].sort((p, q) => p - q);
  let best = [0, 0, FW, FH], score = -1;
  for (const x0 of xs) for (const x1 of xs) for (const y0 of ys) for (const y1 of ys) {
    if (x1 <= x0 || y1 <= y0 || panels.some((b) => b[0] < x1 && x0 < b[2] && b[1] < y1 && y0 < b[3])) continue;
    const k = Math.min((x1 - x0) / Math.max(w, 1e-6), (y1 - y0) / Math.max(h, 1e-6));
    if (k > score) { score = k; best = [x0, y0, x1, y1]; }
  }
  return best;
}
/**
 * Frames the map on the plan inside the stage area the panels leave free, with room around it for the tags and
 * cards (margin px). Returns the free box used, or null without a plan.
 */
export function fitPlan(map, plan, zones, layout = {}, margin = 56) {
  const b = planBounds(plan), size = map?.getSize?.();
  if (!b || !size?.x) return null;
  const p0 = map.latLngToContainerPoint(b[0]), p1 = map.latLngToContainerPoint(b[1]);
  const e = frameBox(layout, size.x, size.y), outside = [[0, 0, size.x, e[1]], [0, e[3], size.x, size.y], [0, 0, e[0], size.y], [e[2], 0, size.x, size.y]].filter((b) => b[2] > b[0] && b[3] > b[1]);
  const r = freeRect([...panelBoxes(zones, layout), ...outside], size.x, size.y, Math.abs(p1.x - p0.x) + 1, Math.abs(p1.y - p0.y) + 1);
  const m = Math.max(8, Math.min(margin, (r[2] - r[0]) / 4, (r[3] - r[1]) / 4));
  map.fitBounds(b, { paddingTopLeft: [r[0] + m, r[1] + m], paddingBottomRight: [size.x - r[2] + m, size.y - r[3] + m], animate: false, maxZoom: 19 });
  return r;
}

// The map's frame inside the coordinate ticks when the layout draws one, else the whole stage.
function frameBox(layout, width, height) {
  const f = getMapFrame(layout, { width, height });
  return f ? [f.left, f.top, f.right, f.bottom] : [0, 0, width, height];
}

/** The view a Leaflet map gives: composition px for longitude/latitude, the stage size and the panels. */
export function mapView(map, width, height, zones, layout = {}) {
  return {
    pt: (lng, lat) => { const p = map.latLngToContainerPoint([lat, lng]); return [p.x, p.y]; },
    W: width, H: height, frame: frameBox(layout, width, height), panels: panelBoxes(zones, layout), family: layout.fonts?.callout || 'Inter', accent: /^#[0-9a-f]{6}$/i.test(layout.accentColor || '') ? layout.accentColor : null,
  };
}
