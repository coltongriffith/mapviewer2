// Annotation shapes for Exploration Maps 3D, placed in the files' coordinates: dashed ellipses around a target,
// dimension lines and big arrows with text ("OPEN", "Grade increasing"). Loaded by studio.js the first time a
// figure has a shape. Drawn on the figure by projecting their world points, so they stay crisp at any export
// size, and on the section where they lie within its width.
// S.shapes: [{ id, type: "ellipse", at: [e, n, z?], rx, ry, rotation, vertical, text, color, width, dash }
//            | { id, type: "dimension" | "arrow", from: [e, n, z?], to: [e, n, z?], text, color, width, size, style }].
// A point without z sits on the terrain; color null takes the brand colours. views: where it is drawn, "both" (the
// default, also when unset), "3d" (the 3D figure only) or "section" (the section only).
import { sightTest } from './drape.js';
import { secFrame, toSection } from './section-geometry.js';
import { hits } from './layout.js';

let H, S;
export function init(host) { H = host; S = host.S; }

const TYPES = ['ellipse', 'dimension', 'arrow'], VIEWS = ['both', '3d', 'section'], RAD = Math.PI / 180, r1 = (v) => Math.round(v * 10) / 10;
// The ellipse's outline: rx along the rotation azimuth (degrees from north), ry across it, flat on the ground
// (z of the centre, or the terrain when it has none) or upright (vertical) with ry up and down.
export function ellipsePts(s, n = 96) {
  const a = (s.rotation || 0) * RAD, ux = Math.sin(a), uy = Math.cos(a), [cx, cy, cz] = s.at;
  return Array.from({ length: n + 1 }, (_, i) => {
    const c = Math.cos(2 * Math.PI * i / n) * s.rx, d = Math.sin(2 * Math.PI * i / n) * s.ry;
    return s.vertical ? [cx + ux * c, cy + uy * c, cz + d] : [cx + ux * c + uy * d, cy + uy * c - ux * d, cz];
  });
}
// Length of a dimension line: along the ground, or in 3D when both ends have an elevation.
export const dimLength = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], a[2] !== undefined && b[2] !== undefined ? b[2] - a[2] : 0);
export const lengthText = (m) => `${Math.round(m).toLocaleString('en-US')} m`;
// A wide arrow from p0 to p1 on screen: shaft half-width sh, head half-width hw, head length hl.
export function arrowShape([x0, y0], [x1, y1], sh, hw, hl) {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / L, uy = (y1 - y0) / L, nx = -uy, ny = ux, h = Math.min(hl, L * 0.6), bx = x1 - ux * h, by = y1 - uy * h;
  return [[x0 + nx * sh, y0 + ny * sh], [bx + nx * sh, by + ny * sh], [bx + nx * hw, by + ny * hw], [x1, y1], [bx - nx * hw, by - ny * hw], [bx - nx * sh, by - ny * sh], [x0 - nx * sh, y0 - ny * sh]];
}
// A point as [e, n] or [e, n, z], from an array or { x | e | east, y | n | north, z }.
export function toPoint(v, k = 'point') {
  const a = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x ?? v.e ?? v.east, v.y ?? v.n ?? v.north, v.z ?? v.elev] : null;
  if (!a || !Number.isFinite(+a[0]) || !Number.isFinite(+a[1])) throw new Error(`${k} must be [easting, northing] or [easting, northing, elevation] in the files' metres.`);
  return a[2] === undefined || a[2] === null || a[2] === '' || !Number.isFinite(+a[2]) ? [r1(+a[0]), r1(+a[1])] : [r1(+a[0]), r1(+a[1]), r1(+a[2])];
}

// Where a new shape goes when no position is given: an upright ellipse round the top intercept, in the plane
// of the section and below the terrain; a dimension line along the section between the outermost collars, on
// the side of the drilling toward the camera; an "OPEN" arrow along the section beyond the last hole.
function defaults(type) {
  const G = H.G, P = H.project; if (!G || !P?.holes?.length) throw new Error('Load data first.');
  const [A, B] = H.sectionEnds(), F = secFrame(A, B), at = P.holes.map((h) => toSection(F, h.c)), ts = at.map((q) => q.t), t0 = Math.min(...ts), t1 = Math.max(...ts);
  const inB = ([x, y]) => x > G.B.x0 + 0.03 * G.bw && x < G.B.x1 - 0.03 * G.bw && y > G.B.y0 + 0.03 * G.bh && y < G.B.y1 - 0.03 * G.bh;
  const on = (t, o = 0) => [r1(A.x + F.d.x * t + F.n.x * o), r1(A.y + F.d.y * t + F.n.y * o)];
  if (type === 'ellipse') {
    const c = H.shownCallouts()[0], h = c?.h || P.holes[0], p = h.posAt(c ? c.ic.broad.mid : h.len / 2), rx = Math.round(Math.max(50, Math.min(0.12 * G.diagH, c ? c.ic.broad.len * 0.45 : 100)));
    return { at: [r1(p.x), r1(p.y), r1(p.z)], rx, ry: Math.round(Math.max(20, Math.min(rx * 0.5, 0.85 * (G.surf(p.x, p.y) - p.z)))), rotation: S.secAz, vertical: true, text: 'Target' };
  }
  if (type === 'dimension') {
    const cam = H.camera.position, sg = Math.sign((cam.x + G.cx - A.x) * F.n.x + (G.cy - cam.z - A.y) * F.n.y) || 1;
    let o = sg * (Math.max(...at.map((q) => q.off * sg)) + 0.05 * F.L);
    while (Math.abs(o) > 1 && !(inB(on(t0, o)) && inB(on(t1, o)))) o *= 0.9;
    return { from: on(t0, o), to: on(t1, o) };
  }
  const s = Math.min(t1 + 0.04 * F.L, 0.7 * F.L);
  return { from: on(s), to: on(Math.min(s + 0.2 * F.L, 0.88 * F.L)), text: 'OPEN' };
}
const HEX = /^#[0-9a-f]{6}$/i, num = (v, k, lo, hi) => { const x = +v; if (!Number.isFinite(x)) throw new Error(`${k} must be a number.`); return Math.max(lo, Math.min(hi, x)); };
function patch(s, x) {
  const at = x.at ?? x.centre ?? x.center; if (at !== undefined) s.at = toPoint(at, 'centre');
  ['from', 'to'].forEach((k) => { if (x[k] !== undefined) s[k] = toPoint(x[k], k); });
  ['rx', 'ry'].forEach((k, j) => { const v = x[k] ?? (Array.isArray(x.radii) ? x.radii[j] : undefined); if (v !== undefined) s[k] = num(v, k, 1, 1e5); });
  if (x.rotation !== undefined) s.rotation = ((num(x.rotation, 'rotation', -1e4, 1e4) % 360) + 360) % 360;
  if (x.vertical !== undefined) s.vertical = !!x.vertical;
  // An explicit text wins over label; null or "" clears it (a dimension then shows its length).
  const t = 'text' in x ? x.text : x.label; if (t !== undefined) s.text = t === null || t === '' ? null : String(t).slice(0, 80);
  if (x.color !== undefined) { if (x.color !== null && !HEX.test(String(x.color))) throw new Error('color must be a hex colour like #142126, or null for the brand colour.'); s.color = x.color && String(x.color).toLowerCase(); }
  if (x.width !== undefined) s.width = num(x.width, 'width', 0.5, 12);
  if (x.size !== undefined) s.size = num(x.size, 'size', 0.4, 3);
  if (x.dash !== undefined) s.dash = !!x.dash;
  if (x.views !== undefined) { if (!VIEWS.includes(x.views)) throw new Error('views must be "both", "3d" or "section".'); s.views = x.views; }
  if (x.style !== undefined) { if (!['outline', 'solid', 'line'].includes(x.style)) throw new Error('style must be "outline" (hollow), "solid" or "line" (a thin arrow with its text along it).'); s.style = x.style; }
  if (s.type === 'ellipse' && s.vertical && s.at.length < 3) throw new Error('An upright ellipse needs a centre with an elevation: [easting, northing, elevation].');
}
const done = () => { H.redraw(); renderUI(document.getElementById('shape-ui')); };
export function add(x = {}) {
  if (!TYPES.includes(x?.type)) throw new Error('addShape takes { type: "ellipse" | "dimension" | "arrow", ... }.');
  const n = S.shapes.reduce((mx, s) => Math.max(mx, +String(s.id).replace(/\D/g, '') || 0), 0) + 1, given = x.at ?? x.centre ?? x.center ?? x.from;
  const s = { id: `S${n}`, type: x.type, text: null, color: null, ...(x.type === 'ellipse' ? { rx: 120, ry: 70, rotation: 0, vertical: false, dash: true, width: 2.5 } : x.type === 'arrow' ? { style: 'outline', size: 1, width: 2.2 } : { width: 1.6 }) };
  patch(s, given === undefined ? { ...defaults(x.type), ...x } : x);
  if (given !== undefined && x.type === 'ellipse' && x.ry === undefined && !x.radii) s.ry = s.rx; // a circle unless told
  if (x.type !== 'ellipse' && (!s.from || !s.to)) throw new Error(`A ${x.type} needs from and to: [easting, northing] or [easting, northing, elevation].`);
  S.shapes = [...S.shapes, s]; done(); H.status(`${x.type[0].toUpperCase()}${x.type.slice(1)} added.`); return s.id;
}
const find = (id) => { const s = S.shapes.find((x) => x.id === id); if (!s) throw new Error(`No shape "${id}". Shapes: ${S.shapes.map((x) => x.id).join(', ') || 'none'}.`); return s; };
export function update(id, x = {}) { const s = find(id), next = structuredClone(s); patch(next, x); S.shapes = S.shapes.map((y) => (y === s ? next : y)); done(); }
export function remove(id) { const s = find(id); S.shapes = S.shapes.filter((y) => y !== s); done(); }

// ---- Drawing ----
const colourOf = (s) => s.color || (s.type === 'arrow' ? S.accent : s.type === 'ellipse' ? H.pri() : H.INK);
const textOf = (s, a, b) => (s.type === 'dimension' && !s.text ? lengthText(dimLength(a, b)) : s.text || '');
// A text on a pale pill, centred at (x, y) and turned to ang (kept upright); its box goes into occ.
const pillSize = (ctx, K, t) => { K.font(700, 13); return [ctx.measureText(t).width + 12 * K.u, 20 * K.u]; };
function pill(ctx, K, t, x, y, ang, ink, occ, edge) {
  const { u } = K, [w, h] = pillSize(ctx, K, t);
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = H.paper(0.94); H.roundRect(ctx, -w / 2, -h / 2, w, h, 4 * u); ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1.3 * u; ctx.stroke(); }
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, 0, u * 0.6); ctx.restore();
  const r = Math.max(w, h) / 2; occ?.push([x - r, y - r, x + r, y + r]);
}
const stroke = (ctx, u, pts, colour, w, dash, faint) => {
  ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.globalAlpha = faint ? 0.4 : 1;
  ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = H.paper(0.5); ctx.lineWidth = w + 2 * u; if (!faint) ctx.stroke();
  ctx.setLineDash(dash ? [Math.max(7 * u, 3.6 * w), Math.max(5 * u, 2.6 * w)] : []); ctx.lineCap = dash ? 'butt' : 'round'; ctx.strokeStyle = colour; ctx.lineWidth = w; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
};
const head = (ctx, [x, y], ang, l, colour) => { ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-l, -l * 0.4); ctx.lineTo(-l, l * 0.4); ctx.closePath(); ctx.fillStyle = colour; ctx.fill(); ctx.restore(); };
// Draws one shape from screen points: ellipse runs (faint: where the terrain hides them), or the two ends of a
// dimension line or arrow. An ellipse's name goes beside it, above or below, where it is clear of occ.
function drawShape(ctx, K, s, geo, occ) {
  const { u, font, m } = K, c = colourOf(s), w = (s.width || 2) * u;
  if (s.type === 'ellipse') {
    (geo.faint || []).forEach((r) => stroke(ctx, u, r, c, w, s.dash !== false, true)); geo.runs.forEach((r) => stroke(ctx, u, r, c, w, s.dash !== false));
    const all = geo.runs.concat(geo.faint || []).flat(); if (!s.text || !all.length) return;
    const xs = all.map((q) => q[0]), ys = all.map((q) => q[1]), [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [pw, ph] = pillSize(ctx, K, s.text);
    const cands = [[x1 + 8 * u + pw / 2, (y0 + y1) / 2], [x0 - 8 * u - pw / 2, (y0 + y1) / 2], [(x0 + x1) / 2, y0 - 6 * u - ph / 2], [(x0 + x1) / 2, y1 + 6 * u + ph / 2]];
    const at = cands.find(([x, y]) => !(occ || []).some((b) => hits([x - pw / 2, y - ph / 2, x + pw / 2, y + ph / 2], b, 2 * u))) || cands[0];
    pill(ctx, K, s.text, at[0], at[1], 0, H.INK, occ, c); return;
  }
  let [a, b] = geo.ends; const t = textOf(s, s.from, s.to), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (s.type === 'dimension') {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 24 * u) return;
    stroke(ctx, u, [a, b], c, w, false); head(ctx, b, ang, 11 * u, c); head(ctx, a, ang + Math.PI, 11 * u, c);
    [a, b].forEach((p) => { ctx.beginPath(); ctx.moveTo(p[0] - Math.sin(ang) * 7 * u, p[1] + Math.cos(ang) * 7 * u); ctx.lineTo(p[0] + Math.sin(ang) * 7 * u, p[1] - Math.cos(ang) * 7 * u); ctx.lineWidth = w; ctx.strokeStyle = c; ctx.stroke(); });
    pill(ctx, K, t, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ang, H.INK, occ); return;
  }
  if (s.style === 'line') { lineArrow(ctx, K, s, a, b, ang, c, t, occ); return; }
  // The arrow: long enough for its text and head, drawn back from the tip where the view shortens it.
  const k = s.size || 1, sh = 15 * u * k, hw = 30 * u * k, hl = 34 * u * k;
  font(800, 14 * k); if ('letterSpacing' in ctx) ctx.letterSpacing = `${1.6 * u * k}px`;
  const tw = t ? ctx.measureText(t.toUpperCase()).width : 0, need = tw + hl + 26 * u * k, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < need) a = [b[0] - Math.cos(ang) * need, b[1] - Math.sin(ang) * need];
  if (a.some((v) => !Number.isFinite(v)) || Math.min(a[0], b[0]) > K.W + m || Math.max(a[0], b[0]) < -m) return;
  const poly = arrowShape(a, b, sh, hw, hl), solid = s.style === 'solid';
  ctx.beginPath(); poly.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.lineJoin = 'round';
  ctx.fillStyle = solid ? c : H.paper(0.82); ctx.fill(); ctx.strokeStyle = solid ? H.paper(0.9) : c; ctx.lineWidth = (solid ? 1.4 : s.width || 2.2) * u; ctx.stroke();
  if (t) {
    const L2 = Math.hypot(b[0] - a[0], b[1] - a[1]) - hl, mx = a[0] + Math.cos(ang) * L2 / 2, my = a[1] + Math.sin(ang) * L2 / 2;
    let r = ang; if (r > Math.PI / 2 || r < -Math.PI / 2) r += Math.PI;
    ctx.save(); ctx.translate(mx, my); ctx.rotate(r); ctx.fillStyle = solid ? H.textOn(c) : c; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t.toUpperCase(), 0, u * k); ctx.restore();
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]); occ?.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
}
// A thin arrow with its text written along it, above the line (style "line"), as an annotation on a block face
// ("Grade increasing"): set its ends at depth on the face and it lies in the face's perspective.
function lineArrow(ctx, K, s, a, b, ang, c, t, occ) {
  const { u, font } = K, k = s.size || 1, w = (s.width || 2.2) * u, hl = 16 * u * k, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < hl * 2 || a.some((v) => !Number.isFinite(v))) return;
  const light = H.textOn(c) !== '#ffffff', halo = light ? 'rgba(20,33,38,0.3)' : H.paper(0.75);
  ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0] - Math.cos(ang) * hl * 0.7, b[1] - Math.sin(ang) * hl * 0.7);
  ctx.strokeStyle = halo; ctx.lineWidth = w + 2 * u; ctx.stroke(); ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke(); ctx.lineCap = 'butt';
  head(ctx, b, ang, hl, c);
  if (t) {
    let r = ang; if (r > Math.PI / 2 || r < -Math.PI / 2) r += Math.PI;
    font(600, 16 * k); ctx.save(); ctx.translate((a[0] + b[0]) / 2 + Math.sin(r) * 13 * u * k, (a[1] + b[1]) / 2 - Math.cos(r) * 13 * u * k); ctx.rotate(r);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 3 * u; ctx.strokeStyle = halo; ctx.strokeText(t, 0, 0); ctx.fillStyle = c; ctx.fillText(t, 0, 0); ctx.restore();
  }
  occ?.push([Math.min(a[0], b[0]) - 8 * u, Math.min(a[1], b[1]) - 24 * u, Math.max(a[0], b[0]) + 8 * u, Math.max(a[1], b[1]) + 8 * u]);
}
// On the 3D figure, over the overlays and collars, under the callouts and labels.
export function draw(ctx, K, occ) {
  const G = H.G; if (!G || !S.shapes.length) return;
  const cam = H.camera, p = cam.position, d = cam.getWorldDirection(p.clone()), [W] = H.frame();
  const seen = sightTest(G.B, G.surf, G.zmax, S.projection === 'orthographic' ? { dir: [-d.x, d.z, -d.y / S.vex] } : { eye: [p.x + G.cx, G.cy - p.z, p.y / S.vex + G.zref] }, Math.max(0.5, (G.terr.hi - G.terr.lo) * 0.01));
  const toScreen = (x, y, z) => H.proj(G.V(x, y, z)), end = (q) => toScreen(q[0], q[1], q[2] ?? G.surf(q[0], q[1]));
  const k = { ...K, W }; ctx.save();
  S.shapes.forEach((s) => {
    if (s.views === 'section') return;
    // On the terrain: drawn only where it shows. At depth: faint where the terrain is in front of it.
    if (s.type === 'ellipse') {
      const runs = [[], []]; let cur = null, was;
      ellipsePts(s).forEach((q) => {
        const z = q[2] ?? G.surf(q[0], q[1]), p2 = toScreen(q[0], q[1], z), v = seen(q[0], q[1], z); if (p2[2] > 1) { cur = null; return; }
        if (cur && v !== was) { cur.push(p2); cur = null; } // the runs meet where the terrain starts to hide it
        if (!cur) runs[+!v].push(cur = []); cur.push(p2); was = v;
      });
      drawShape(ctx, k, s, { runs: runs[0], faint: s.at.length < 3 ? [] : runs[1] }, occ); return;
    }
    const a = end(s.from), b = end(s.to); if (a[2] > 1 || b[2] > 1) return;
    drawShape(ctx, k, s, { ends: [a, b] }, occ);
  });
  ctx.restore();
}
// On the section A–A′: the shapes within its width, an upright ellipse as seen across the section.
export function drawSection(ctx, { A, Bp, X, Y, w, K, Wc }) {
  const G = H.G; if (!G || !S.shapes.length) return;
  const F = secFrame(A, Bp), on = (q) => toSection(F, { x: q[0], y: q[1] }), inW = (q) => Math.abs(on(q).off) <= w, sc = X(1) - X(0);
  const at = (q) => [X(on(q).t), Y(q[2] ?? G.surf(q[0], q[1]))], k = { ...K, W: Wc };
  ctx.save();
  S.shapes.forEach((s) => {
    if (s.views === '3d') return;
    if (s.type === 'ellipse') {
      if (!s.vertical || !inW(s.at)) return;
      const a = (s.rotation || 0) * RAD, along = Math.abs(Math.sin(a) * F.d.x + Math.cos(a) * F.d.y) * s.rx; if (along < 0.25 * s.rx) return;
      const [cx, cy] = at(s.at), pts = Array.from({ length: 97 }, (_, i) => [cx + Math.cos(i * Math.PI / 48) * along * sc, cy + Math.sin(i * Math.PI / 48) * s.ry * sc]);
      drawShape(ctx, k, s, { runs: [pts] }); return;
    }
    if (inW(s.from) && inW(s.to)) drawShape(ctx, k, s, { ends: [at(s.from), at(s.to)] });
  });
  ctx.restore();
}

// ---- The Layout panel ----
export function renderUI(el) {
  if (!el) return;
  const esc = H.esc, open = new Set([...el.querySelectorAll('details[open]')].map((x) => x.dataset.id)), NAME = { ellipse: 'Ellipse', dimension: 'Dimension line', arrow: 'Arrow' };
  const xyz = (s, k, label) => { const q = s[k] || []; return ['E', 'N', 'Z'].map((ax, j) => `<label class="field"><span>${label} ${ax}${j === 2 ? ' (empty: on the terrain)' : ''}</span><input type="number" step="any" data-sh="${esc(s.id)}" data-pt="${k}" data-j="${j}" value="${q[j] ?? ''}"></label>`).join(''); };
  el.innerHTML = S.shapes.map((s) => {
    const i = esc(s.id), nb = (k, label, v, a = '') => `<label class="field"><span>${label}</span><input type="number" step="any" data-sh="${i}" data-k="${k}" value="${v ?? ''}" ${a}></label>`;
    return `<div class="file"><div class="file-head"><span class="name">${NAME[s.type]}</span><span class="row"><input type="color" data-sh="${i}" data-k="color" value="${esc(colourOf(s))}" aria-label="Colour of ${NAME[s.type]} ${i}"><button class="btn" type="button" data-shx="${i}" aria-label="Remove ${NAME[s.type]} ${i}">Remove</button></span></div>
      <div class="grid2"><label class="field"><span>${s.type === 'dimension' ? 'Text (empty: the length)' : 'Text'}</span><input type="text" data-sh="${i}" data-k="text" value="${esc(s.text ?? '')}" maxlength="80" placeholder="${s.type === 'dimension' ? esc(lengthText(dimLength(s.from, s.to))) : ''}"></label>
      <label class="field"><span>Show on</span><select data-sh="${i}" data-k="views" aria-label="Where ${NAME[s.type]} ${i} shows">${[['both', '3D and section'], ['3d', '3D figure only'], ['section', 'Section only']].map(([v, t]) => `<option value="${v}" ${(s.views || 'both') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <details data-id="${i}" ${open.has(s.id) ? 'open' : ''}><summary>Position and size</summary><div class="grid2">
        ${s.type === 'ellipse' ? `${xyz(s, 'at', 'Centre')}${nb('rx', 'Radius along (m)', s.rx, 'min="1"')}${nb('ry', s.vertical ? 'Radius up and down (m)' : 'Radius across (m)', s.ry, 'min="1"')}${nb('rotation', 'Azimuth (°)', s.rotation)}
          <label class="check"><input type="checkbox" data-sh="${i}" data-k="vertical" ${s.vertical ? 'checked' : ''}>Upright</label><label class="check"><input type="checkbox" data-sh="${i}" data-k="dash" ${s.dash !== false ? 'checked' : ''}>Dashed</label>`
          : `${xyz(s, 'from', 'From')}${xyz(s, 'to', 'To')}${s.type === 'arrow' ? `${nb('size', 'Size', s.size, 'min="0.4" max="3" step="0.1"')}<label class="field"><span>Style</span><select data-sh="${i}" data-k="style"><option value="outline" ${!s.style || s.style === 'outline' ? 'selected' : ''}>Hollow</option><option value="solid" ${s.style === 'solid' ? 'selected' : ''}>Solid</option><option value="line" ${s.style === 'line' ? 'selected' : ''}>Line with text</option></select></label>` : ''}`}
      </div></details></div>`;
  }).join('');
  el.querySelectorAll('[data-sh]').forEach((c) => c.addEventListener('change', () => {
    const s = S.shapes.find((x) => x.id === c.dataset.sh); if (!s) return;
    let o;
    if (c.dataset.pt) { const q = [...(s[c.dataset.pt] || [])]; q[+c.dataset.j] = c.value === '' ? undefined : +c.value; o = { [c.dataset.pt]: q.slice(0, q[2] === undefined ? 2 : 3) }; }
    else o = { [c.dataset.k]: c.type === 'checkbox' ? c.checked : c.type === 'number' ? +c.value : c.dataset.k === 'text' && c.value === '' ? null : c.value };
    Promise.resolve().then(() => H.api.updateShape(s.id, o)).catch((e) => { H.status(e.message); renderUI(el); });
  }));
  el.querySelectorAll('[data-shx]').forEach((b) => b.addEventListener('click', () => H.api.removeShape(b.dataset.shx).catch((e) => H.status(e.message))));
}
