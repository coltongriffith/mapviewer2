// Geology and label styling for 2D data layers (Tower v3 spec items 1, 3, 4 and 21–26), opt-in per layer
// (layer.fx) plus a basemap wash (layout.wash). A layer with fx is drawn by this module instead of the plain
// vector pass:
// - polygons: fill opacity per layer, soft feathered edges (a blur radius), the hard outline optional, or a
//   dispersal plume (a fill fading away from its source side, optionally blurred);
// - lines: a soft glow under, a darker casing, the line or dash on top, and the line types thrust (dash-dot,
//   teeth on one side), inferred fault (dashed, "?"), defined zone (solid with casing) and inferred trend (dashed);
// - labels: unit names printed into a polygon's fill (a darker shade of it, spaced caps, an optional italic
//   second line, turned, shrunk to the largest clear spot inside or hidden, never spilling out) and names along
//   a line (side and offset, start along the line, kept upright, spacing, weight and size);
// - collisions: labels step clear of the panels and of each other where they can, and the rest are reported;
// - legend swatches drawn with the layer's own glow, casing, dash, teeth, feather or plume.
//
// Everything is laid out once, in composition px, as primitives that one canvas painter (the editor stage, via
// utils/fxLayers.js, and the PNG export) and one SVG painter (the SVG export, text kept as live text) draw, so
// the three cannot disagree. Lazy: loaded only for a map using any of it.

const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, Number(v))) : d);
const HEX = /^#[0-9a-f]{6}$/i;

// ── Settings ─────────────────────────────────────────────────────────────────────────────────────────
export const LINE_TYPES = [
  ['plain', 'Plain (layer dash)'], ['zone', 'Defined zone (solid + casing)'], ['trend', 'Inferred trend (dashed)'],
  ['fault', 'Inferred fault (dashed, “?”)'], ['thrust', 'Thrust (dash-dot, teeth)'],
];
const DASH = { trend: [10, 7], fault: [8, 6], thrust: [12, 4, 2, 4] };

/** A layer's fx with every default filled in, or null when it has none. */
export function fxOf(layer) {
  const fx = layer?.fx;
  if (!fx || typeof fx !== 'object') return null;
  const type = LINE_TYPES.some(([k]) => k === fx.lineType) ? fx.lineType : 'plain';
  const l = fx.label && typeof fx.label === 'object' ? fx.label : null;
  return {
    feather: clamp(fx.feather, 0, 40, 0),
    outline: fx.outline !== false,
    plume: fx.plume ? { az: clamp(fx.plume.az, -360, 720, 45), tail: clamp(fx.plume.tail, 0, 1, 0), blur: clamp(fx.plume.blur, 0, 40, 0) } : null,
    lineType: type,
    glow: clamp(fx.glow, 0, 24, 0),
    glowOpacity: clamp(fx.glowOpacity, 0, 1, 0.5),
    glowColor: HEX.test(fx.glowColor || '') ? fx.glowColor : null,
    casing: fx.casing ?? type === 'zone',
    teeth: fx.teeth === 'right' ? 'right' : 'left',
    label: l && l.on !== false ? {
      text: String(l.text ?? '').trim(), field: String(l.field || ''), sub: String(l.sub ?? '').trim(), subField: String(l.subField || ''),
      size: clamp(l.size, 6, 48, 13), weight: clamp(l.weight, 300, 900, 700), ls: clamp(l.ls, 0, 1, 0.2), caps: l.caps !== false,
      color: HEX.test(l.color || '') ? l.color : null, opacity: clamp(l.opacity, 0.1, 1, 0.9), halo: l.halo ?? null,
      rotate: l.rotate === 'auto' ? 'auto' : clamp(l.rotate, -90, 90, 0), fit: l.fit === 'hide' ? 'hide' : 'shrink',
      minSize: clamp(l.minSize, 4, 24, 7), per: l.per === 'feature' ? 'feature' : 'layer',
      side: ['left', 'right', 'on'].includes(l.side) ? l.side : 'left', offset: clamp(l.offset, -40, 60, 4),
      start: clamp(l.start, 0, 100, 50), flip: l.flip !== false, nudge: l.nudge !== false,
    } : null,
  };
}

/** Whether the basemap wash draws anything. */
export const washOn = (wash) => Number(wash?.amount) > 0 || Number(wash?.vignette) > 0;

// ── Colour ───────────────────────────────────────────────────────────────────────────────────────────
function rgbOf(hex) {
  const h = HEX.test(hex || '') ? hex : '#888888';
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
/** A darker shade of a colour, keeping its hue: lightness × f, saturation kept (labels printed into a fill). */
export function shade(hex, f = 0.38) {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const L = l * f, C = (1 - Math.abs(2 * L - 1)) * Math.min(1, s * 1.1), X = C * (1 - Math.abs((h % 2 + 2) % 2 - 1)), m = L - C / 2;
  const [r1, g1, b1] = h < 1 ? [C, X, 0] : h < 2 ? [X, C, 0] : h < 3 ? [0, C, X] : h < 4 ? [0, X, C] : h < 5 ? [X, 0, C] : [C, 0, X];
  return toHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]);
}
const rgba = (hex, a) => `rgba(${rgbOf(hex).join(',')},${+a.toFixed(4)})`;

// ── Geometry ─────────────────────────────────────────────────────────────────────────────────────────
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
function lengths(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return cum;
}
/** The point and direction (radians) at distance s along a polyline. */
export function pointAt(pts, cum, s) {
  const L = cum[cum.length - 1];
  const t = Math.max(0, Math.min(L, s));
  let i = 1;
  while (i < pts.length - 1 && cum[i] < t) i += 1;
  const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, k = (t - cum[i - 1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
// Chaikin corner cutting: a label follows the line's course, not every digitised kink.
function smooth(pts, n = 2) {
  let p = pts;
  for (let k = 0; k < n && p.length > 2; k += 1) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i += 1) {
      const [a, b] = [p[i], p[i + 1]];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}
// The polyline moved d px along its left normal (screen y down: left of travel), mitred at the joints.
function offsetLine(pts, d) {
  if (!d) return pts;
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const ia = i > 0 ? Math.atan2(p[1] - a[1], p[0] - a[0]) : null, ib = i < n - 1 ? Math.atan2(b[1] - p[1], b[0] - p[0]) : null;
    const ang = ia == null ? ib : ib == null ? ia : Math.atan2(Math.sin(ia) + Math.sin(ib), Math.cos(ia) + Math.cos(ib));
    const half = ia == null || ib == null ? 0 : (ib - ia) / 2;
    const k = d / Math.max(0.35, Math.cos(half));
    return [p[0] + Math.sin(ang) * k, p[1] - Math.cos(ang) * k];
  });
}

function insideRings(rings, x, y) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
// L∞ distance from (cx, cy) to segment a–b: the half-size of the largest square centred there that the segment
// does not cross. Coordinates are already turned and stretched so the label's box is that square.
function linfSeg(cx, cy, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, u0 = ax - cx, v0 = ay - cy;
  const f = (t) => Math.max(Math.abs(u0 + t * dx), Math.abs(v0 + t * dy));
  let best = Math.min(f(0), f(1));
  for (const [num, den] of [[-u0, dx], [-v0, dy], [v0 - u0, dx - dy], [-(u0 + v0), dx + dy]]) {
    if (den) { const t = num / den; if (t > 0 && t < 1) best = Math.min(best, f(t)); }
  }
  return best;
}
/**
 * The largest box of the given aspect (width / height), turned by rot degrees, inside a polygon (rings, holes
 * included): its centre and half-height, for the best few clearly different spots, best first. The box is the
 * unit ball of a stretched L∞ metric, so its largest size at a point is the smallest such distance to any edge
 * (the pole of inaccessibility for a box instead of a circle): a grid of starts, each climbed to its local best.
 */
export function largestBox(rings, aspect, rot = 0, { grid = 16, keep = 4, blocked = [] } = {}) {
  const a = (-rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a), A = Math.max(1e-6, aspect);
  // Turned so the box is axis-aligned, then x squeezed by the aspect so it is a square.
  const turn = (r) => r.map(([x, y]) => [(x * cos - y * sin) / A, x * sin + y * cos]);
  const T = rings.map(turn), B = blocked.map(turn);
  const edges = [];
  [...T, ...B].forEach((r) => r.forEach((p, i) => { const q = r[(i + 1) % r.length]; if (p[0] !== q[0] || p[1] !== q[1]) edges.push([p[0], p[1], q[0], q[1]]); }));
  if (edges.length < 3) return [];
  // Blocked areas (panels, labels already placed) are holes the box may not cover.
  const h = (x, y) => {
    if (!insideRings(T, x, y) || B.some((r) => insideRings([r], x, y))) return 0;
    let m = Infinity;
    for (const e of edges) { const d = linfSeg(x, y, e[0], e[1], e[2], e[3]); if (d < m) m = d; }
    return m;
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  T[0].forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
  // A grid over each axis (the squeezed frame is far narrower than tall), each start climbed to its local best.
  const cx = (x1 - x0) / grid, cy = (y1 - y0) / grid;
  if (!(cx > 0 && cy > 0)) return [];
  const starts = [];
  for (let gx = 0.5; gx < grid; gx += 1) {
    for (let gy = 0.5; gy < grid; gy += 1) {
      const x = x0 + gx * cx, y = y0 + gy * cy, v = h(x, y);
      if (v > 0) starts.push([x, y, v]);
    }
  }
  starts.sort((p, q) => q[2] - p[2]);
  const found = [];
  for (const s of starts.slice(0, keep * 3)) {
    let [x, y, v] = s, step = 0.5;
    while (step > 1 / 64) {
      let moved = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nv = h(x + dx * step * cx, y + dy * step * cy);
        if (nv > v) { x += dx * step * cx; y += dy * step * cy; v = nv; moved = true; break; }
      }
      if (!moved) step /= 2;
    }
    // A spot inside an earlier, larger box is the same spot.
    if (!found.some((f) => Math.abs(f[0] - x) < f[2] && Math.abs(f[1] - y) < f[2])) found.push([x, y, v]);
  }
  found.sort((p, q) => q[2] - p[2]);
  // Back to the polygon's frame.
  return found.slice(0, keep).map(([x, y, v]) => ({ x: x * A * cos + y * sin, y: -x * A * sin + y * cos, half: v }));
}

/** Whether two axis-aligned boxes ({left, top, width, height}) overlap. */
export const boxesOverlap = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
const boxOfPts = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
};

// ── Text ─────────────────────────────────────────────────────────────────────────────────────────────
let measureCtx;
const fam = (f) => `'${String(f || 'Inter').replace(/['"\\]/g, '')}', Arial, sans-serif`;
/** Advance widths of each character at a size, one canvas context for the editor and both exporters. */
export function advances(chars, size, weight, family, italic = false) {
  if (measureCtx === undefined) {
    try { measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null; } catch { measureCtx = null; }
  }
  if (!measureCtx?.measureText) return chars.map((c) => (c === ' ' ? 0.3 : /[A-Z]/.test(c) ? 0.68 : 0.55) * size);
  measureCtx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${fam(family)}`;
  return chars.map((c) => measureCtx.measureText(c).width);
}
const CAP = 0.72; // cap height per px of font size

// One run of glyphs along a polyline (screen px), centred on distance mid, each glyph turned to the line.
function glyphsAlong(pts, cum, chars, adv, ls, s0) {
  const out = [];
  let s = s0;
  chars.forEach((ch, i) => {
    const p = pointAt(pts, cum, s + adv[i] / 2);
    out.push({ ch, x: p.x - Math.cos(p.a) * (adv[i] / 2), y: p.y - Math.sin(p.a) * (adv[i] / 2), rot: (p.a * 180) / Math.PI });
    s += adv[i] + ls;
  });
  return out;
}
// A glyph's box on screen (its advance by its cap height above the baseline, turned).
function glyphCorners(g, w, size) {
  const c = Math.cos((g.rot * Math.PI) / 180), s = Math.sin((g.rot * Math.PI) / 180), up = [s * size * CAP, -c * size * CAP];
  return [[g.x, g.y], [g.x + c * w, g.y + s * w], [g.x + c * w + up[0], g.y + s * w + up[1]], [g.x + up[0], g.y + up[1]]];
}

function textOf(lab, layer, feature, which) {
  const field = which === 'sub' ? lab.subField : lab.field;
  const fixed = which === 'sub' ? lab.sub : lab.text;
  const v = field ? feature?.properties?.[field] : null;
  const t = String(v != null && v !== '' ? v : fixed || (which === 'sub' ? '' : layer.legend?.label || layer.displayName || layer.name || '')).replace(/\s+/g, ' ').trim();
  return which === 'sub' ? t : lab.caps ? t.toUpperCase() : t;
}

// ── Layout ───────────────────────────────────────────────────────────────────────────────────────────
/**
 * The projection the layout works in: pt(lng, lat) → container px; world(lng, lat) → a zoom-free plane (Web
 * Mercator px at zoom 0) and k px per world unit, so a label's fit is found once per shape and only scaled.
 */
export function mapView(map, width, height, { obstacles = [], family = 'Inter', frame = null } = {}) {
  const z = map.getZoom();
  return {
    pt: (lng, lat) => { const p = map.latLngToContainerPoint([lat, lng]); return [p.x, p.y]; },
    world: (lng, lat) => { const p = map.project([lat, lng], 0); return [p.x, p.y]; },
    k: map.getZoomScale(z, 0), W: width, H: height, obstacles, family, frame,
  };
}

function partsOf(geometry) {
  if (!geometry) return { polys: [], lines: [] };
  const c = geometry.coordinates;
  switch (geometry.type) {
    case 'Polygon': return { polys: [c], lines: [] };
    case 'MultiPolygon': return { polys: c, lines: [] };
    case 'LineString': return { polys: [], lines: [c] };
    case 'MultiLineString': return { polys: [], lines: c };
    case 'GeometryCollection': {
      const parts = geometry.geometries.map(partsOf);
      return { polys: parts.flatMap((p) => p.polys), lines: parts.flatMap((p) => p.lines) };
    }
    default: return { polys: [], lines: [] };
  }
}
const proj = (view, ring) => ring.map(([lng, lat]) => view.pt(lng, lat));

// Strokes for one line in a line type: glow under, casing, the line or dash, then teeth or "?" marks.
function lineStroke(lines, st, fx, alpha, out, every = null) {
  const sw = st.strokeWidth ?? 2, stroke = HEX.test(st.stroke || '') ? st.stroke : '#111111';
  const k = Math.max(1, sw / 2), type = fx.lineType;
  const dash = type === 'plain' ? String(st.dashArray || '').split(/[ ,]+/).map(Number).filter((n) => n > 0) : (DASH[type] || []).map((d) => d * k);
  if (fx.glow > 0) out.push({ t: 'stroke', lines, stroke: fx.glowColor || stroke, sw: sw + fx.glow * 2, opacity: alpha * fx.glowOpacity, blur: fx.glow });
  if (fx.casing) out.push({ t: 'stroke', lines, stroke: shade(stroke, 0.45), sw: sw + Math.max(2, sw * 0.7), opacity: alpha, dash: dash.length ? dash : null, cap: dash.length ? 'butt' : 'round' });
  out.push({ t: 'stroke', lines, stroke, sw, opacity: alpha, dash: dash.length ? dash : null, cap: dash.length ? 'butt' : 'round' });
  if (type === 'thrust' || type === 'fault') {
    const side = fx.teeth === 'right' ? -1 : 1, size = 3 + sw * 1.4;
    lines.forEach((pts) => {
      const cum = lengths(pts), L = cum[cum.length - 1], gap = every || (type === 'thrust' ? 22 + sw * 4 : 90);
      for (let s = gap / 2; s < L - size; s += gap) {
        const p = pointAt(pts, cum, s), c = Math.cos(p.a), sn = Math.sin(p.a), nx = sn * side, ny = -c * side;
        if (type === 'thrust') {
          out.push({ t: 'poly', pts: [[p.x - c * size, p.y - sn * size], [p.x + c * size, p.y + sn * size], [p.x + nx * size * 1.3, p.y + ny * size * 1.3]], fill: stroke, opacity: alpha });
        } else {
          const fs = 9 + sw * 1.5;
          out.push({ t: 'glyphs', glyphs: [{ ch: '?', x: p.x + nx * (sw + fs * 0.55) - fs * 0.27, y: p.y + ny * (sw + fs * 0.55) + fs * CAP / 2, rot: 0 }], size: fs, weight: 700, family: 'Inter', fill: stroke, opacity: alpha, halo: { color: '#ffffff', width: 2.5, opacity: 0.8 }, s: '?' });
        }
      }
    });
  }
}

// The band prims of one fx layer (fills, outlines, strokes), in layer order.
function layerPrims({ layer, features, styleOf }, fx, view) {
  const out = [];
  const lo = layer.style?.layerOpacity ?? 1;
  for (const feature of features) {
    const st = styleOf(feature) || {};
    const op = Math.max(0, Math.min(1, st.opacity ?? 1)) * lo;
    const { polys, lines } = partsOf(feature.geometry);
    if (polys.length) {
      const rings = polys.flatMap((poly) => poly.map((r) => proj(view, r)));
      const fill = HEX.test(st.fill || '') ? st.fill : '#93c5fd', a = (st.fillOpacity ?? 0.2) * op;
      if (fx.plume) {
        const az = (fx.plume.az * Math.PI) / 180, d = [Math.sin(az), -Math.cos(az)];
        const ts = rings.flat().map(([x, y]) => x * d[0] + y * d[1]), t0 = Math.min(...ts), t1 = Math.max(...ts);
        out.push({ t: 'fill', rings, fill, opacity: 1, blur: fx.plume.blur || fx.feather,
          grad: { x1: d[0] * t0, y1: d[1] * t0, x2: d[0] * t1, y2: d[1] * t1, stops: [[0, a], [0.55, a * (0.45 + fx.plume.tail * 0.55)], [1, a * fx.plume.tail]] } });
      } else if (a > 0) out.push({ t: 'fill', rings, fill, opacity: a, blur: fx.feather });
      if (fx.outline && (st.strokeWidth ?? 2) > 0) {
        const dash = String(st.dashArray || '').split(/[ ,]+/).map(Number).filter((n) => n > 0);
        out.push({ t: 'stroke', lines: rings, closed: true, stroke: HEX.test(st.stroke || '') ? st.stroke : '#111111', sw: st.strokeWidth ?? 2, opacity: op, dash: dash.length ? dash : null, cap: 'round' });
      }
    }
    if (lines.length) lineStroke(lines.map((l) => proj(view, l)), st, fx, op, out);
  }
  return out;
}

// Area labels: candidates (best spot first) for each labelled unit, found once per shape in the zoom-free plane.
const fitCache = new WeakMap();
function areaCandidates(entry, fx, view) {
  const { layer, features, styleOf } = entry, lab = fx.label;
  const groups = lab.per === 'feature' ? features.map((f) => [f]) : [features];
  return groups.map((group) => {
    const f0 = group[0];
    const text = textOf(lab, layer, f0, 'text'), sub = textOf(lab, layer, f0, 'sub');
    if (!text || !group.some((f) => partsOf(f.geometry).polys.length)) return null;
    const st = styleOf(f0) || {};
    const color = lab.color || shade(HEX.test(st.fill || '') ? st.fill : '#93c5fd');
    // The block at size 1: the caps line, and under it the italic line at 0.62.
    const c1 = Array.from(text), a1 = advances(c1, 100, lab.weight, view.family).map((w) => w / 100);
    const c2 = Array.from(sub), a2 = advances(c2, 100, 400, view.family, true).map((w) => w / 100);
    const w1 = a1.reduce((s, w) => s + w, 0) + lab.ls * Math.max(0, c1.length - 1), w2 = a2.reduce((s, w) => s + w, 0) * 0.62 + 0.03 * Math.max(0, c2.length - 1);
    const H = sub ? CAP + 0.36 + 0.62 * CAP + 0.62 * 0.24 : CAP, W = Math.max(w1, w2), pad = 0.3;
    const aspect = (W + 2 * pad) / (H + 2 * pad);
    const key = `${aspect.toFixed(4)}|${lab.rotate}`;
    const rots = lab.rotate === 'auto' ? [0, -15, 15, -30, 30, -45, 45, -60, 60] : [lab.rotate];
    let spots = [];
    const parts = group.flatMap((f) => partsOf(f.geometry).polys.map((poly) => poly.map((r) => r.map(([lng, lat]) => view.world(lng, lat)))));
    for (const f of group) {
      let byKey = fitCache.get(f.geometry);
      if (!byKey) { byKey = new Map(); fitCache.set(f.geometry, byKey); }
      if (!byKey.has(key)) {
        const found = [];
        for (const poly of partsOf(f.geometry).polys) {
          const rings = poly.map((r) => r.map(([lng, lat]) => view.world(lng, lat)));
          for (const rot of rots) largestBox(rings, aspect, rot).forEach((b) => found.push({ ...b, rot }));
        }
        found.sort((p, q) => q.half - p.half);
        byKey.set(key, found.slice(0, 6));
      }
      spots = spots.concat(byKey.get(key));
    }
    spots.sort((p, q) => q.half - p.half);
    return { kind: 'area', lab, text, sub, c1, a1, c2, a2, w1, w2, H, pad, color, spots, parts, aspect, rots };
  }).filter(Boolean);
}

// The glyphs of an area label at one spot, or null when it would be smaller than allowed.
function areaGlyphs(c, spot, view) {
  const { lab } = c;
  const fitSize = ((2 * spot.half) / (c.H + 2 * c.pad)) * view.k;
  if (lab.fit === 'hide' && fitSize < lab.size) return null;
  const size = Math.min(lab.size, fitSize);
  if (size < lab.minSize) return null;
  const [cx, cy] = [spot.x * view.k + view.origin[0], spot.y * view.k + view.origin[1]];
  const r = (spot.rot * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  // Local frame: x along the label, y down; the block centred on the spot.
  const at = (x, y) => [cx + x * cos - y * sin, cy + x * sin + y * cos];
  const top = -(c.H * size) / 2;
  const run = (chars, adv, k, ls, base) => {
    const w = adv.reduce((s, a) => s + a * k, 0) + ls * Math.max(0, chars.length - 1);
    let x = -w / 2;
    return chars.map((ch, i) => { const [gx, gy] = at(x, base); x += adv[i] * k + ls; return { ch, x: gx, y: gy, rot: spot.rot }; });
  };
  const line1 = run(c.c1, c.a1, size, c.lab.ls * size, top + CAP * size);
  const s2 = size * 0.62;
  const line2 = c.sub ? run(c.c2, c.a2, s2, 0.03 * size, top + (CAP + 0.36 + 0.62 * CAP) * size) : [];
  const hw = (Math.max(c.w1, c.w2) / 2 + c.pad * 0.5) * size, hh = (c.H / 2 + c.pad * 0.5) * size;
  const box = boxOfPts([at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)]);
  const halo = c.lab.halo ? { color: '#ffffff', width: Math.max(2, size * 0.22), opacity: 0.75 } : null;
  const common = { family: view.family, fill: c.color, opacity: c.lab.opacity, halo };
  const boxes = [...line1.map((g, i) => boxOfPts(glyphCorners(g, c.a1[i] * size, size))), ...line2.map((g, i) => boxOfPts(glyphCorners(g, c.a2[i] * s2, s2)))];
  return {
    box, boxes,
    prims: [
      { t: 'glyphs', glyphs: line1, size, weight: c.lab.weight, ...common, s: c.text, role: 'area-label' },
      ...(line2.length ? [{ t: 'glyphs', glyphs: line2, size: s2, weight: 400, italic: true, ...common, s: c.sub, role: 'area-label-sub' }] : []),
    ],
  };
}

// Line labels: the longest part of each labelled feature (or of the layer), placed along it.
function lineCandidates(entry, fx, view) {
  const { layer, features, styleOf } = entry, lab = fx.label;
  const groups = lab.per === 'feature' ? features.map((f) => [f]) : [features];
  return groups.map((group) => {
    let best = null;
    group.forEach((f) => partsOf(f.geometry).lines.forEach((l) => {
      const pts = proj(view, l);
      const L = lengths(pts).at(-1);
      if (pts.length > 1 && (!best || L > best.L)) best = { pts, L, f };
    }));
    if (!best) return null;
    const text = textOf(lab, layer, best.f, 'text');
    if (!text) return null;
    const st = styleOf(best.f) || {};
    const color = lab.color || shade(HEX.test(st.stroke || '') ? st.stroke : '#333333', 0.32);
    return { kind: 'line', lab, text, color, pts: smooth(best.pts), sw: st.strokeWidth ?? 2, glow: fx.glow };
  }).filter(Boolean);
}

// The glyphs of a line label starting at `start` % (0 = at the line's start, 100 = ending at its end).
function lineGlyphs(c, start, view) {
  const { lab } = c, size = lab.size, ls = lab.ls * size;
  const chars = Array.from(c.text), adv = advances(chars, size, lab.weight, view.family);
  const w = adv.reduce((s, a) => s + a, 0) + ls * Math.max(0, chars.length - 1);
  let pts = c.pts, cum = lengths(pts), L = cum.at(-1);
  if (w > L * 0.96) return null;
  // Upright: read left to right over the stretch the label covers.
  const s0 = (start / 100) * (L - w), p0 = pointAt(pts, cum, s0), p1 = pointAt(pts, cum, s0 + w);
  const reversed = lab.flip && p1.x < p0.x;
  if (reversed) pts = pts.slice().reverse();
  // Which side of the reading direction the text sits on, and its baseline's distance from the line.
  const gap = lab.offset + c.sw / 2 + c.glow * 0.5;
  let d;
  if (lab.side === 'on') d = -(size * CAP) / 2 + lab.offset;
  else {
    const up = (lab.side === 'left') !== reversed;
    d = up ? gap : -(gap + size * CAP);
  }
  pts = offsetLine(pts, d);
  cum = lengths(pts); L = cum.at(-1);
  const s = ((reversed ? 100 - start : start) / 100) * Math.max(0, L - w);
  const glyphs = glyphsAlong(pts, cum, chars, adv, ls, s);
  const corners = glyphs.flatMap((g, i) => glyphCorners(g, adv[i], size));
  const halo = lab.halo === false ? null : { color: '#ffffff', width: Math.max(2.5, size * 0.28), opacity: 0.85 };
  return {
    box: boxOfPts(corners), boxes: glyphs.map((g, i) => boxOfPts(glyphCorners(g, adv[i], size))),
    prims: [{ t: 'glyphs', glyphs, size, weight: lab.weight, family: view.family, fill: c.color, opacity: lab.opacity, halo, s: c.text, role: 'line-label' }],
  };
}

const hits = (lbl, boxes) => boxes.filter((o) => (lbl.boxes || [lbl.box]).some((b) => boxesOverlap(b, o)));
// The strips just outside the map: a label running off its edge is cut there.
const edges = ({ left: l, top: t, right: r, bottom: b }) => {
  const key = 'the map edge', W = r - l, H = b - t;
  return [{ key, left: l - 9 * W, top: t - 9 * H, width: 9 * W, height: 19 * H }, { key, left: r, top: t - 9 * H, width: 9 * W, height: 19 * H },
    { key, left: l, top: t - 9 * H, width: W, height: 9 * H }, { key, left: l, top: b, width: W, height: 9 * H }];
};
const LINE_STEPS = [0, 12, -12, 24, -24, 36, -36, 48, -48];
// Whether a segment crosses a box (Liang–Barsky clipping).
function segHitsBox([x0, y0], [x1, y1], b) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - b.left], [dx, b.left + b.width - x0], [-dy, y0 - b.top], [dy, b.top + b.height - y0]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

/**
 * Everything the fx layers draw: band (fills, outlines and strokes, in layer order, drawn under plain data
 * layers), labels (over every data layer) and the labels that still overlap a panel or another label.
 * entries: [{ layer, features, styleOf(feature) }] for the visible layers with fx, in layer order.
 */
export function fxScene(entries, view) {
  const band = [], labels = [], placed = [], overlaps = [];
  // The world plane's origin on screen: the fit is found once in the plane and scaled by k.
  const [ox, oy] = view.world(0, 0), [px, py] = view.pt(0, 0);
  const v = { ...view, origin: [px - ox * view.k, py - oy * view.k] };
  const f = view.frame || { left: 0, top: 0, right: view.W, bottom: view.H };
  const obstacles = [...(view.obstacles || []).filter((o) => o.width > 0 && o.height > 0), ...edges(f)];
  const cands = [];
  for (const entry of entries) {
    const fx = fxOf(entry.layer);
    if (!fx) continue;
    band.push(...layerPrims(entry, fx, view));
    if (!fx.label) continue;
    const isLine = entry.features.some((f) => partsOf(f.geometry).lines.length);
    cands.push(...(isLine ? lineCandidates(entry, fx, view) : areaCandidates(entry, fx, v)).map((c) => ({ ...c, layerName: entry.layer.legend?.label || entry.layer.displayName || entry.layer.name || 'Layer' })));
  }
  // The styled lines on the map: a unit's name is kept off them too (not reported: a line under a name is usual).
  const lines = [...new Set(band.filter((p) => p.t === 'stroke' && !p.closed).map((p) => p.lines))].flat();
  const onLine = (lbl) => (lbl.boxes || [lbl.box]).some((b) => lines.some((pts) => pts.some((p, i) => i > 0 && segHitsBox(pts[i - 1], p, b))));
  // An area label whose clear spots are all covered: the largest box round the panels, placed labels and lines.
  const aroundBlocked = (c) => {
    const toWorld = (x, y) => [(x - v.origin[0]) / view.k, (y - v.origin[1]) / view.k];
    const blocked = [...obstacles, ...placed.map((p) => p.box)].map((b) => [toWorld(b.left, b.top), toWorld(b.left + b.width, b.top), toWorld(b.left + b.width, b.top + b.height), toWorld(b.left, b.top + b.height)])
      .concat(lines.map((pts) => [...pts, ...pts.slice(0, -1).reverse()].map(([x, y]) => toWorld(x, y))));
    return c.parts.flatMap((rings) => c.rots.flatMap((rot) => largestBox(rings, c.aspect, rot, { blocked, keep: 2 }).map((b) => ({ ...b, rot })))).sort((p, q) => q.half - p.half);
  };
  for (const c of cands) {
    const tries = c.kind === 'area' ? c.spots : LINE_STEPS.map((dx) => c.lab.start + dx).filter((s, i) => i === 0 || (s >= 0 && s <= 100));
    let first = null, chosen = null;
    const attempt = (list) => {
      for (const t of list) {
        const lbl = c.kind === 'area' ? areaGlyphs(c, t, v) : lineGlyphs(c, t, v);
        // Only a label on the map is placed: one wholly off it is not drawn and cannot collide.
        if (!lbl || lbl.box.left > view.W || lbl.box.top > view.H || lbl.box.left + lbl.box.width < 0 || lbl.box.top + lbl.box.height < 0) continue;
        first = first || lbl;
        if (!hits(lbl, obstacles).length && !hits(lbl, placed.flatMap((p) => p.boxes)).length && !(c.kind === 'area' && onLine(lbl))) return lbl;
      }
      return null;
    };
    chosen = attempt(c.lab.nudge ? tries : tries.slice(0, 1));
    if (!chosen && c.kind === 'area' && c.lab.nudge && first) chosen = attempt(aroundBlocked(c).slice(0, 4));
    const lbl = chosen || first;
    // Never drawn cut by the map's edge: a label with nowhere clear inside the map is left off.
    if (!lbl || hits(lbl, obstacles).some((o) => o.key === 'the map edge')) continue;
    const what = [...hits(lbl, obstacles).map((o) => o.key), ...hits(lbl, placed.flatMap((p) => p.boxes)).length ? ['another label'] : []];
    if (what.length) overlaps.push({ label: c.text, layer: c.layerName, with: [...new Set(what)], box: lbl.box });
    placed.push({ box: lbl.box, boxes: lbl.boxes || [lbl.box], text: c.text });
    labels.push(...lbl.prims);
  }
  return { band, labels, overlaps, placed };
}

/** Overlapping boxes among panels, cards and labels ({key, left, top, width, height}), each pair once. */
export function overlapPairs(boxes) {
  const out = [];
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => { if (a.key !== b.key && boxesOverlap(a, b)) out.push([a.key, b.key]); }));
  return out;
}

// ── Wash and legend swatches ─────────────────────────────────────────────────────────────────────────
/** A white (or any colour) wash over the basemap, with an edge vignette, over a W × H frame. */
// bleed: how far past the frame it is painted (the editor's canvas runs past the map's edges while it pans).
export function washPrims(wash, W, H, bleed = 0) {
  if (!washOn(wash)) return [];
  const color = HEX.test(wash.color || '') ? wash.color : '#ffffff';
  return [{ t: 'wash', x: 0, y: 0, w: W, h: H, bleed, color, amount: clamp(wash.amount, 0, 0.9, 0), vignette: clamp(wash.vignette, 0, 1, 0) }];
}

/** A legend swatch drawn with the layer's real style, in a w × h box at (x, y). */
export function swatchPrims(item, x, y, w, h) {
  const fx = fxOf({ fx: item.fx });
  if (!fx) return [];
  const st = item.style || {};
  if (item.type === 'line') {
    const out = [], my = y + h / 2;
    // One tooth in the middle of a thrust's swatch; a fault's "?" does not fit one.
    lineStroke([[[x, my], [x + w, my]]], { ...st, strokeWidth: Math.min(st.strokeWidth ?? 2, 3.5) }, { ...fx, glow: Math.min(fx.glow, 3), lineType: fx.lineType === 'fault' ? 'trend' : fx.lineType }, 1, out, w);
    return out;
  }
  const fill = HEX.test(st.fill || '') ? st.fill : '#93c5fd', a = st.fillOpacity ?? 0.22;
  const inset = fx.feather ? Math.min(2, fx.feather / 3) : 0;
  const rect = [[[x + inset, y + inset], [x + w - inset, y + inset], [x + w - inset, y + h - inset], [x + inset, y + h - inset]]];
  const out = [fx.plume
    ? { t: 'fill', rings: rect, fill, opacity: 1, blur: Math.min(1.5, fx.plume.blur), grad: { x1: x, y1: 0, x2: x + w, y2: 0, stops: [[0, a], [0.55, a * (0.45 + fx.plume.tail * 0.55)], [1, a * fx.plume.tail]] } }
    : { t: 'fill', rings: rect, fill, opacity: a, blur: inset }];
  if (fx.outline && (st.strokeWidth ?? 2) > 0) out.push({ t: 'stroke', lines: rect, closed: true, stroke: HEX.test(st.stroke || '') ? st.stroke : '#3b82f6', sw: 1, opacity: 1, cap: 'round' });
  return out;
}

// ── Painters ─────────────────────────────────────────────────────────────────────────────────────────
function tracePath(ctx, lines, closed) {
  ctx.beginPath();
  lines.forEach((pts) => {
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (closed) ctx.closePath();
  });
}
// A blurred shape: drawn far off the canvas, its shadow (blurred by the browser, σ = blur / 2) shifted back in.
// Works where ctx.filter does not (Safari before 18). Shadow sizes are in device px, untouched by the transform.
function blurred(ctx, blur, color, draw) {
  const m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1, off = (ctx.canvas.width + ctx.canvas.height + 4 * blur * k + 100) / k;
  ctx.shadowColor = color; ctx.shadowBlur = blur * k; ctx.shadowOffsetX = off * m.a; ctx.shadowOffsetY = off * m.b;
  ctx.translate(-off, 0);
  draw();
}
/** Paints fx primitives (composition px) on a canvas at scale s. */
export function paintFxCanvas(ctx, prims, s = 1) {
  for (const p of prims) {
    ctx.save();
    ctx.scale(s, s);
    if (p.t === 'fill') {
      const paint = () => {
        tracePath(ctx, p.rings, true);
        if (p.grad) {
          const g = ctx.createLinearGradient(p.grad.x1, p.grad.y1, p.grad.x2, p.grad.y2);
          p.grad.stops.forEach(([o, a]) => g.addColorStop(o, p.blur ? `rgba(0,0,0,${a})` : rgba(p.fill, a)));
          ctx.fillStyle = g;
        } else ctx.fillStyle = p.blur ? '#000000' : rgba(p.fill, p.opacity);
        ctx.fill('evenodd');
      };
      if (p.blur) blurred(ctx, p.blur, p.grad ? rgba(p.fill, 1) : rgba(p.fill, p.opacity), paint); else paint();
    } else if (p.t === 'stroke') {
      const paint = () => {
        tracePath(ctx, p.lines, p.closed);
        ctx.lineWidth = p.sw; ctx.lineJoin = 'round'; ctx.lineCap = p.cap || 'round';
        ctx.setLineDash(p.dash || []);
        ctx.strokeStyle = p.blur ? '#000000' : rgba(p.stroke, p.opacity);
        ctx.stroke();
      };
      if (p.blur) blurred(ctx, p.blur, rgba(p.stroke, p.opacity), paint); else paint();
    } else if (p.t === 'poly') {
      tracePath(ctx, [p.pts], true);
      ctx.fillStyle = rgba(p.fill, p.opacity ?? 1); ctx.fill();
    } else if (p.t === 'glyphs') {
      ctx.font = `${p.italic ? 'italic ' : ''}${p.weight} ${p.size}px ${fam(p.family)}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      for (const g of p.glyphs) {
        ctx.save();
        ctx.translate(g.x, g.y); ctx.rotate((g.rot * Math.PI) / 180);
        if (p.halo) { ctx.strokeStyle = rgba(p.halo.color, p.halo.opacity); ctx.lineWidth = p.halo.width; ctx.lineJoin = 'round'; ctx.strokeText(g.ch, 0, 0); }
        ctx.fillStyle = rgba(p.fill, p.opacity ?? 1); ctx.fillText(g.ch, 0, 0);
        ctx.restore();
      }
    } else if (p.t === 'wash') {
      const b = p.bleed || 0;
      if (p.amount > 0) { ctx.fillStyle = rgba(p.color, p.amount); ctx.fillRect(p.x - b, p.y - b, p.w + 2 * b, p.h + 2 * b); }
      if (p.vignette > 0) {
        // An ellipse through the corners: the SVG's objectBoundingBox radial gradient (r = √½).
        const rx = p.w * Math.SQRT1_2, ry = p.h * Math.SQRT1_2;
        ctx.translate(p.x + p.w / 2, p.y + p.h / 2); ctx.scale(rx, ry);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, rgba(p.color, 0)); g.addColorStop(0.6, rgba(p.color, 0)); g.addColorStop(1, rgba(p.color, p.vignette));
        ctx.fillStyle = g; ctx.fillRect(-(p.w / 2 + b) / rx, -(p.h / 2 + b) / ry, (p.w + 2 * b) / rx, (p.h + 2 * b) / ry);
      }
    }
    ctx.restore();
  }
}

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const f2 = (v) => +v.toFixed(2);
const pathD = (lines, closed, s) => lines.map((pts) => `M${pts.map(([x, y]) => `${f2(x * s)} ${f2(y * s)}`).join('L')}${closed ? 'Z' : ''}`).join('');
/**
 * The same primitives as SVG markup at scale s. Blur filters and gradients go into defs (ids from opts.prefix,
 * unique per document); text stays text: one element per run, each glyph placed and turned by x, y and rotate.
 */
export function paintFxSvg(prims, s = 1, defs = [], { prefix = 'em-fx', W = 1e5, H = 1e5 } = {}) {
  const filterId = (blur) => {
    const id = `${prefix}-blur-${String(f2(blur * s)).replace('.', '_')}`;
    if (!defs.some((d) => d.includes(`id="${id}"`))) defs.push(`<filter id="${id}" filterUnits="userSpaceOnUse" x="${f2(-W * s)}" y="${f2(-H * s)}" width="${f2(3 * W * s)}" height="${f2(3 * H * s)}"><feGaussianBlur stdDeviation="${f2((blur * s) / 2)}" /></filter>`);
    return id;
  };
  let n = 0;
  const gradId = () => `${prefix}-g${defs.length}-${n++}`;
  const paint = (attr, color, a) => ` ${attr}="${esc(color)}"${a < 1 ? ` ${attr}-opacity="${+a.toFixed(4)}"` : ''}`;
  return prims.map((p) => {
    if (p.t === 'fill') {
      let fill;
      if (p.grad) {
        const id = gradId();
        defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f2(p.grad.x1 * s)}" y1="${f2(p.grad.y1 * s)}" x2="${f2(p.grad.x2 * s)}" y2="${f2(p.grad.y2 * s)}">${p.grad.stops.map(([o, a]) => `<stop offset="${o}" stop-color="${esc(p.fill)}" stop-opacity="${+a.toFixed(4)}" />`).join('')}</linearGradient>`);
        fill = ` fill="url(#${id})"`;
      } else fill = paint('fill', p.fill, p.opacity);
      return `<path d="${pathD(p.rings, true, s)}"${fill} fill-rule="evenodd"${p.blur ? ` filter="url(#${filterId(p.blur)})"` : ''} />`;
    }
    if (p.t === 'stroke') {
      const dash = p.dash ? ` stroke-dasharray="${p.dash.map((d) => f2(d * s)).join(' ')}"` : '';
      return `<path d="${pathD(p.lines, p.closed, s)}" fill="none"${paint('stroke', p.stroke, p.opacity)} stroke-width="${f2(p.sw * s)}" stroke-linejoin="round" stroke-linecap="${p.cap || 'round'}"${dash}${p.blur ? ` filter="url(#${filterId(p.blur)})"` : ''} />`;
    }
    if (p.t === 'poly') return `<path d="${pathD([p.pts], true, s)}"${paint('fill', p.fill, p.opacity ?? 1)} />`;
    if (p.t === 'glyphs') {
      const xs = p.glyphs.map((g) => f2(g.x * s)).join(' '), ys = p.glyphs.map((g) => f2(g.y * s)).join(' '), rs = p.glyphs.map((g) => f2(g.rot)).join(' ');
      const halo = p.halo ? `${paint('stroke', p.halo.color, p.halo.opacity)} stroke-width="${f2(p.halo.width * s)}" stroke-linejoin="round" paint-order="stroke"` : '';
      return `<text${p.role ? ` class="em-fx-${p.role}"` : ''} xml:space="preserve" x="${xs}" y="${ys}" rotate="${rs}" font-family="${esc(fam(p.family))}" font-size="${f2(p.size * s)}" font-weight="${p.weight}"${p.italic ? ' font-style="italic"' : ''}${paint('fill', p.fill, p.opacity ?? 1)}${halo}>${esc(p.glyphs.map((g) => g.ch).join(''))}</text>`;
    }
    if (p.t === 'wash') {
      let out = p.amount > 0 ? `<rect x="${f2(p.x * s)}" y="${f2(p.y * s)}" width="${f2(p.w * s)}" height="${f2(p.h * s)}"${paint('fill', p.color, p.amount)} />` : '';
      if (p.vignette > 0) {
        const id = gradId();
        defs.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="${Math.SQRT1_2}"><stop offset="0" stop-color="${esc(p.color)}" stop-opacity="0" /><stop offset="0.6" stop-color="${esc(p.color)}" stop-opacity="0" /><stop offset="1" stop-color="${esc(p.color)}" stop-opacity="${p.vignette}" /></radialGradient>`);
        out += `<rect x="${f2(p.x * s)}" y="${f2(p.y * s)}" width="${f2(p.w * s)}" height="${f2(p.h * s)}" fill="url(#${id})" />`;
      }
      return out;
    }
    return '';
  }).join('');
}
