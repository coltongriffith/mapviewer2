// Plan views for Exploration Maps 3D, looking down (plunge 80° or more). Loaded by studio.js for figures of design
// version 5 (FEATURES.planView) or with the easting/northing grid on (S.grid). In a plan view the intervals are
// drawn as flat coloured bars along each hole's plan trace, at least a few pixels long, so a steep hole's intervals
// read as bars rather than as the round ends of its tubes; the orientation box says "Plan view"; the hole IDs are
// smaller and each placed clear of the collars, the bars and the other IDs, on a short leader when it moves off;
// and the grid has its eastings and northings along the block's edges.
import { uses } from './design-version.js';
import { placePills } from './leaders.js';
import { hits } from './layout.js';

let H, S;
export function init(host) { H = host; S = host.S; }

export const PLAN_PLUNGE = 80;
export const isPlanView = (plunge) => plunge >= PLAN_PLUNGE;
// Grid values between lo and hi every step: a round step (1, 2 or 5 × 10ⁿ m) giving about n lines.
export function gridTicks(lo, hi, n = 5) {
  if (!(hi > lo) || !(n > 0)) return { step: 0, values: [] };
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p, step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p, values = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + 1e-9; k++) values.push(+(k * step).toPrecision(12));
  return { step, values };
}
// A span [s0, s1] along a line, at least min long (grown about its middle) and, when it would reach into
// [-off, off] (the collar marker, at 0), moved to start at off.
export function barSpan(s0, s1, min, off = 0) {
  let a = Math.min(s0, s1), b = Math.max(s0, s1);
  if (b - a < min) { const c = (a + b) / 2; a = c - min / 2; b = c + min / 2; }
  if (off > 0 && a < off && b > -off) { b += off - a; a = off; }
  return [a, b];
}
// An interval's bar from its own ends on screen (a, b): along a→b where that is long enough to give a direction,
// else along the first of dirs (the trace there, then the whole hole) that has one; at least min long about its
// middle, and kept off the collar marker (c, radius off) when it lies across it. Returns [x0, y0, x1, y1].
export function barOf(a, b, dirs, min, c = null, off = 0) {
  const len = (v) => Math.hypot(v[0], v[1]), ab = [b[0] - a[0], b[1] - a[1]], v = [ab, ...dirs].find((x, i) => len(x) > (i ? 1e-6 : min / 4)) || [1, 0], d = [v[0] / len(v), v[1] / len(v)];
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], h = Math.abs(ab[0] * d[0] + ab[1] * d[1]) / 2;
  // Along d from the collar's foot on the line through m; the collar counts only if it lies on that line.
  const tc = c ? (c[0] - m[0]) * d[0] + (c[1] - m[1]) * d[1] : 0, onIt = c && Math.abs((c[0] - m[0]) * d[1] - (c[1] - m[1]) * d[0]) < off;
  const [s0, s1] = barSpan(-h - (onIt ? tc : 0), h - (onIt ? tc : 0), min, onIt ? off : 0), o = onIt ? tc : 0;
  return [m[0] + d[0] * (s0 + o), m[1] + d[1] * (s0 + o), m[0] + d[0] * (s1 + o), m[1] + d[1] * (s1 + o)];
}
// A hole's interval bars: P(depth) its point on screen, ints the intervals shown.
export function holeBars(h, P, ints, min, off) {
  const c = P(0), e = P(h.len), whole = [e[0] - c[0], e[1] - c[1]];
  return ints.map((it) => { const p = P(Math.max(0, it.from - 10)), q = P(Math.min(h.len, it.to + 10)); return barOf(P(it.from), P(it.to), [[q[0] - p[0], q[1] - p[1]], whole], min, c, off); });
}

const on = () => !!H.G && isPlanView(H.getCam().plunge);
const feat = () => uses(S, 'planView');
// The tubes hide in a plan view; the bars stand in for them (studio.js placeRibbons, extScene).
export function sync() { const G = H.G; if (!G?.tubes) return; G.tubes.visible = G.tubesP.visible = !(feat() && on()); }

let barBoxes = [];
// Before the collars: the grid's lines and the bars. Returns null outside a plan view, else what studio.js asks
// for next: ids (the IDs, when this module places them), labels (the grid's numbers) and foot (the orientation text).
export function begin(ctx, K) {
  if (!on() || !(feat() || S.grid)) return null;
  const grid = S.grid ? drawGrid(ctx, K) : null;
  barBoxes = []; if (feat()) drawBars(ctx, K);
  return { ids: feat() ? drawIds : null, labels: (c, k, lay) => grid && gridLabels(c, k, lay, grid), foot: feat() ? ['Plan view', grid?.step ? `Grid ${grid.step.toLocaleString('en-US')} m` : ''] : null };
}

const toS = (x, y, z) => H.proj(H.G.V(x, y, z ?? H.G.surf(x, y)));
// Lines every round step over the block, draped on the terrain (so they meet what is painted on it), faint.
function drawGrid(ctx, K) {
  const G = H.G, B = G.B, { u } = K, xs = gridTicks(B.x0, B.x1, 5), ys = gridTicks(B.y0, B.y1, Math.max(2, Math.round(5 * G.bh / G.bw)));
  const step = Math.max(xs.step, ys.step), ex = gridTicks(B.x0, B.x1, Math.round((B.x1 - B.x0) / step) || 1), ny = gridTicks(B.y0, B.y1, Math.round((B.y1 - B.y0) / step) || 1);
  const run = (f) => Array.from({ length: 25 }, (_, i) => f(i / 24)).map(([x, y]) => toS(x, y)), lines = [];
  ex.values.forEach((x) => lines.push({ v: x, ax: 'E', pts: run((t) => [x, B.y0 + (B.y1 - B.y0) * t]) }));
  ny.values.forEach((y) => lines.push({ v: y, ax: 'N', pts: run((t) => [B.x0 + (B.x1 - B.x0) * t, y]) }));
  ctx.save(); ctx.lineJoin = 'round';
  [[H.paper(0.45), 2.2 * u], [H.INK, 0.8 * u]].forEach(([c, w], k) => {
    ctx.globalAlpha = k ? 0.38 : 1; ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath();
    lines.forEach(({ pts }) => pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))); ctx.stroke();
  });
  ctx.restore();
  return { step: ex.step === ny.step ? ex.step : 0, lines };
}
// Eastings at the lower end of their lines, northings at the left end, each just outside the block where it is
// clear (else just inside): placed in the figure's layout pass, drawn last unless something has landed on them.
function gridLabels(ctx, K, lay, grid) {
  if (H.project?.latlon) return; // collars in latitude/longitude: local metres, so the lines only
  const { u, font } = K, occ = lay.boxes; font(500, 10, true);
  grid.lines.forEach(({ v, ax, pts }) => {
    const end = ax === 'E' ? (pts[0][1] > pts.at(-1)[1] ? pts[0] : pts.at(-1)) : (pts[0][0] < pts.at(-1)[0] ? pts[0] : pts.at(-1));
    const t = `${Math.round(v)}${ax}`, w = ctx.measureText(t).width + 4 * u, h = 12 * u, [x, y] = end;
    const at = ax === 'E' ? [[x - w / 2, y + 4 * u], [x - w / 2, y - 4 * u - h]] : [[x - 6 * u - w, y - h / 2], [x + 4 * u, y - h / 2]];
    lay.place(at.map(([a, b]) => [a, b, a + w, b + h]), 0, (b) => {
      if (occ.some((o) => o !== b && hits(o, b))) return; // a legend or a callout took the spot after it
      font(500, 10, true); ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.lineWidth = 3 * u; ctx.strokeStyle = H.paper(0.9);
      ctx.strokeText(t, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2); ctx.fillStyle = H.MUTED; ctx.fillText(t, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    });
  });
}

// The intervals as flat bars along the plan trace, each on its own stretch of it (a surveyed hole bends), highest grades on top; their boxes, merged a few at a time, are
// kept for the IDs to keep off.
function drawBars(ctx, K) {
  const G = H.G, { u } = K, w = 5 * u, min = 9 * u, off = 7 * u, list = [], tags = H.ext('tags');
  H.project.holes.forEach((h) => {
    const P = (d) => { const p = h.posAt(d); return H.proj(G.V(p.x, p.y, p.z)); }; if (P(0)[2] > 1) return;
    const alpha = tags?.fade(h) ? 0.35 : h.prov ? 0.6 : 1, ints = h.ints.map((it) => [it, H.intervalShown(it) ? H.binIndex(it.vals[S.valueCol]) : -1]).filter(([, bi]) => bi > 0);
    let box = null;
    holeBars(h, P, ints.map(([it]) => it), min, off).forEach(([x0, y0, x1, y1], k) => {
      const bi = ints[k][1];
      list.push({ bi, alpha, x0, y0, len: Math.hypot(x1 - x0, y1 - y0), ang: Math.atan2(y1 - y0, x1 - x0) });
      const bb = [Math.min(x0, x1) - w / 2, Math.min(y0, y1) - w / 2, Math.max(x0, x1) + w / 2, Math.max(y0, y1) + w / 2];
      if (box && Math.max(box[2], bb[2]) - Math.min(box[0], bb[0]) < 18 * u && Math.max(box[3], bb[3]) - Math.min(box[1], bb[1]) < 18 * u) box.splice(0, 4, Math.min(box[0], bb[0]), Math.min(box[1], bb[1]), Math.max(box[2], bb[2]), Math.max(box[3], bb[3]));
      else barBoxes.push(box = bb);
    });
  });
  list.sort((p, q) => p.bi - q.bi).forEach(({ bi, alpha, x0, y0, len, ang }) => {
    ctx.save(); ctx.translate(x0, y0); ctx.rotate(ang); ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(20,33,38,0.55)'; ctx.fillRect(-0.8 * u, -w / 2 - 0.8 * u, len + 1.6 * u, w + 1.6 * u);
    ctx.fillStyle = H.BIN_COLORS[bi]; ctx.fillRect(0, -w / 2, len, w); ctx.restore();
  });
}

// Hole IDs, smaller than in a 3D view: callout holes first, each at the first spot around its collar clear of the
// collars, the bars and the IDs placed before it (a short leader when it sits further off), else left out.
function drawIds(ctx, K, placed, idBoxes) {
  if (!S.ids) return;
  const G = H.G, { u, font } = K, tags = H.ext('tags'), co = H.shownCallouts().map((c) => c.h), t = S.tags;
  const want = (h) => (typeof t.showId?.[h.id] === 'boolean' ? t.showId[h.id] : t.idMode !== 'key' || !tags || tags.idShown(h)) && !(tags && t.at === 'collar' && tags.tagShown(h));
  const collars = [], items = [];
  font(500, 10, true);
  H.project.holes.forEach((h) => {
    const s = H.proj(G.V(h.c.x, h.c.y, h.c.z)); if (s[2] > 1) return;
    collars.push([s[0] - 7 * u, s[1] - 7 * u, s[0] + 7 * u, s[1] + 7 * u]);
    if (want(h)) items.push({ hole: h, pri: co.includes(h) ? co.indexOf(h) : 100, x: s[0], y: s[1], w: ctx.measureText(h.id).width + 4 * u, h: 12 * u });
  });
  items.sort((a, b) => a.pri - b.pri || a.x - b.x);
  const [W, Hf] = H.frame(), res = placePills(items, [...placed, ...collars, ...barBoxes], { W, H: Hf, unit: u, pad: 1.5 * u, drop: true, leaders: 'far' });
  ctx.save(); ctx.lineCap = 'round';
  res.forEach((p) => {
    if (!p.leader) return;
    const ex = Math.max(p.box[0], Math.min(p.box[2], p.x)), ey = Math.max(p.box[1], Math.min(p.box[3], p.y)), l = Math.hypot(ex - p.x, ey - p.y); if (l < 8 * u) return;
    ctx.beginPath(); ctx.moveTo(p.x + (ex - p.x) / l * 6.5 * u, p.y + (ey - p.y) / l * 6.5 * u); ctx.lineTo(ex, ey); ctx.strokeStyle = H.paper(0.85); ctx.lineWidth = 2.6 * u; ctx.stroke(); ctx.strokeStyle = H.MUTED; ctx.lineWidth = 0.9 * u; ctx.stroke();
  });
  font(500, 10, true); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 2.6 * u; ctx.strokeStyle = H.paper(0.9); ctx.fillStyle = H.INK;
  res.forEach((p) => { ctx.strokeText(p.hole.id, p.cx, p.cy); ctx.fillText(p.hole.id, p.cx, p.cy); placed.push(p.box); idBoxes.push(p.box); });
  ctx.restore();
}
