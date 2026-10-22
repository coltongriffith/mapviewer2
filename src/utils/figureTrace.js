// Tracing a figure's map units by colour.
//
// A company geology figure paints each unit in one colour, usually half
// transparent over imagery, with text, contacts, faults, trend lines and
// symbols drawn on top. To get the units back as polygons:
//   1. blur a little and compare every pixel with the picked samples in Lab
//      (perceptual distance), each pixel going to the nearest unit in
//      tolerance;
//   2. open each unit's mask (erode, then dilate) to drop lines and lettering
//      thinner than the line width, then close it (dilate, then erode) to
//      fill the gaps they leave;
//   3. hand the thin strips between two units (a contact line, a fault) to
//      the units either side, so neighbours meet instead of leaving a seam;
//   4. drop specks smaller than the minimum area (legend swatches, a stray
//      symbol) and fill holes smaller than it (a label, a collar dot);
//   5. round the mask's corners by a majority vote, walk its outline into
//      rings, simplify the pixel staircase and round it off.
//
// Pure: { data, width, height } in, pixel rings out. The dialog runs it in a
// Web Worker (figureTrace.worker.js) and maps the rings with the fit.

export const TRACE_DEFAULTS = {
  tolerance: 18, // Lab ΔE to the nearest sample
  lineWidth: 3, // opening radius in px: removes strokes up to ~2·r+1 wide
  gap: 3, // closing radius in px
  minAreaFraction: 0.0005, // of the work image
  simplify: 1.2, // px
  round: 3, // majority-vote radius in px, rounding the corners
  smooth: 2, // Chaikin passes
};

// ── colour ────────────────────────────────────────────────────────────────
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbToLab(r, g, b) {
  const R = LIN[Math.round(r)], G = LIN[Math.round(g)], B = LIN[Math.round(b)];
  const x = fLab((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = fLab(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = fLab((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// Separable box blur of the RGB channels, radius r.
function blurRgb(data, w, h, r) {
  const n = w * h;
  const out = new Float32Array(n * 3);
  const tmp = new Float32Array(n * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k += 1) {
        const o = (y * w + k) * 4; sr += data[o]; sg += data[o + 1]; sb += data[o + 2]; cnt += 1;
      }
      const t = (y * w + x) * 3; tmp[t] = sr / cnt; tmp[t + 1] = sg / cnt; tmp[t + 2] = sb / cnt;
    }
  }
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k += 1) {
        const t = (k * w + x) * 3; sr += tmp[t]; sg += tmp[t + 1]; sb += tmp[t + 2]; cnt += 1;
      }
      const t = (y * w + x) * 3; out[t] = sr / cnt; out[t + 1] = sg / cnt; out[t + 2] = sb / cnt;
    }
  }
  return out;
}

// ── binary morphology (square structuring element, separable) ─────────────
// count of set pixels in each [i-r, i+r] window along rows, then columns.
function windowPass(src, w, h, r, horizontal, test) {
  const out = new Uint8Array(w * h);
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  const pre = new Int32Array(len + 1);
  for (let l = 0; l < lines; l += 1) {
    const at = (i) => (horizontal ? l * w + i : i * w + l);
    for (let i = 0; i < len; i += 1) pre[i + 1] = pre[i] + src[at(i)];
    for (let i = 0; i < len; i += 1) {
      const lo = Math.max(0, i - r), hi = Math.min(len - 1, i + r);
      out[at(i)] = test(pre[hi + 1] - pre[lo], hi - lo + 1) ? 1 : 0;
    }
  }
  return out;
}
const all = (c, n) => c === n;
const any = (c) => c > 0;
export function erode(m, w, h, r) { return r > 0 ? windowPass(windowPass(m, w, h, r, true, all), w, h, r, false, all) : m; }
export function dilate(m, w, h, r) { return r > 0 ? windowPass(windowPass(m, w, h, r, true, any), w, h, r, false, any) : m; }
// Majority vote in a (2r+1)² window: rounds the square corners the opening
// and closing leave, before the outline is walked.
function majority(m, w, h, r) {
  const rows = new Uint16Array(w * h);
  const pre = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) pre[x + 1] = pre[x] + m[y * w + x];
    for (let x = 0; x < w; x += 1) rows[y * w + x] = pre[Math.min(w - 1, x + r) + 1] - pre[Math.max(0, x - r)];
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x += 1) {
    const cols = Math.min(w - 1, x + r) - Math.max(0, x - r) + 1;
    for (let y = 0; y < h; y += 1) pre[y + 1] = pre[y] + rows[y * w + x];
    for (let y = 0; y < h; y += 1) {
      const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r);
      out[y * w + x] = 2 * (pre[hi + 1] - pre[lo]) > cols * (hi - lo + 1) ? 1 : 0;
    }
  }
  return out;
}

// ── connected components (4-connected) ───────────────────────────────────
function components(mask, w, h, value) {
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const sizes = [];
  const touches = [];
  const stack = new Int32Array(n);
  for (let s = 0; s < n; s += 1) {
    if (mask[s] !== value || label[s] !== -1) continue;
    const id = sizes.length;
    let top = 0, size = 0, border = false;
    stack[top++] = s; label[s] = id;
    while (top) {
      const i = stack[--top]; size += 1;
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && mask[i - 1] === value && label[i - 1] === -1) { label[i - 1] = id; stack[top++] = i - 1; }
      if (x < w - 1 && mask[i + 1] === value && label[i + 1] === -1) { label[i + 1] = id; stack[top++] = i + 1; }
      if (y > 0 && mask[i - w] === value && label[i - w] === -1) { label[i - w] = id; stack[top++] = i - w; }
      if (y < h - 1 && mask[i + w] === value && label[i + w] === -1) { label[i + w] = id; stack[top++] = i + w; }
    }
    sizes.push(size); touches.push(border);
  }
  return { label, sizes, touches };
}

// ── outlines ──────────────────────────────────────────────────────────────
// Each set pixel contributes the sides it shares with an unset neighbour, as
// directed edges with the set pixel on their right (clockwise on screen).
// Edges are chained into rings; where two pixels meet only at a corner the
// walk turns right, so they stay separate rings, as the 4-connected labelling
// above counts them.
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // E, S, W, N

function traceRings(mask, w, h) {
  const W1 = w + 1;
  const outA = new Int32Array(W1 * (h + 1)).fill(-1);
  const outB = new Int32Array(W1 * (h + 1)).fill(-1);
  const ex = [], ey = [], ed = [];
  const add = (x, y, d) => {
    const id = ed.length; ex.push(x); ey.push(y); ed.push(d);
    const v = y * W1 + x;
    if (outA[v] === -1) outA[v] = id; else outB[v] = id;
  };
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, 0);
      if (!at(x + 1, y)) add(x + 1, y, 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, 2);
      if (!at(x - 1, y)) add(x, y + 1, 3);
    }
  }
  const used = new Uint8Array(ed.length);
  const rings = [];
  for (let s = 0; s < ed.length; s += 1) {
    if (used[s]) continue;
    const pts = [];
    let e = s, prevDir = -1;
    while (!used[e]) {
      used[e] = 1;
      if (ed[e] !== prevDir) pts.push([ex[e], ey[e]]);
      prevDir = ed[e];
      const nx = ex[e] + DX[ed[e]], ny = ey[e] + DY[ed[e]];
      const v = ny * W1 + nx;
      const a = outA[v], b = outB[v];
      if (b === -1 || used[b]) e = a;
      else if (used[a]) e = b;
      else e = ed[a] === (ed[e] + 1) % 4 ? a : b; // prefer the right turn
      if (e === -1) break;
    }
    // The first vertex may sit mid-run when the walk closed on a straight.
    if (pts.length > 2 && ed[s] === prevDir) pts.shift();
    // The set pixel right of the first edge: says which component the ring
    // bounds, and (for a hole) which outer ring it belongs to.
    const d = ed[s];
    const px = ex[s] + (d === 0 ? 0 : d === 1 ? -1 : d === 2 ? -1 : 0);
    const py = ey[s] + (d === 0 ? 0 : d === 1 ? 0 : d === 2 ? -1 : -1);
    rings.push({ pts, inside: py * w + px });
  }
  return rings;
}

export function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  return a / 2; // positive for clockwise on screen (y down)
}

// Douglas–Peucker on a closed ring, split at its two farthest-apart points.
function simplifyOpen(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [ax, ay] = pts[i0], [bx, by] = pts[i1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1, bestD = tol;
    for (let i = i0 + 1; i < i1; i += 1) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}
export function simplifyRing(pts, tol) {
  if (pts.length < 4) return pts;
  let far = 0, farD = -1;
  for (let i = 1; i < pts.length; i += 1) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > farD) { farD = d; far = i; }
  }
  const a = simplifyOpen(pts.slice(0, far + 1), tol);
  const b = simplifyOpen([...pts.slice(far), pts[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length; i += 1) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 0; j < k; j += 1) out.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k]);
  }
  return out;
}
export function chaikin(pts, passes) {
  let out = pts;
  for (let p = 0; p < passes && out.length >= 3; p += 1) {
    const next = [];
    for (let i = 0; i < out.length; i += 1) {
      const [ax, ay] = out[i], [bx, by] = out[(i + 1) % out.length];
      next.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    out = next;
  }
  return out;
}

/**
 * Classify the image against the picked units. `units` are { samples:
 * [[r,g,b]…], tolerance? }. Returns an Int8Array of unit indexes (−1 for
 * none) and each pixel's Lab distance to its unit (for overlaps).
 */
function classify(image, units, opts) {
  const { data, width: w, height: h } = image;
  const rgb = blurRgb(data, w, h, 1);
  const labs = units.map((u) => (u.samples || []).map((s) => rgbToLab(s[0], s[1], s[2])));
  const tol = units.map((u) => (u.tolerance ?? opts.tolerance) ** 2);
  const n = w * h;
  const label = new Int8Array(n).fill(-1);
  const dist = new Float32Array(n).fill(Infinity);
  const region = opts.region;
  for (let i = 0; i < n; i += 1) {
    if (data[i * 4 + 3] < 128) continue;
    if (region) {
      const x = i % w, y = (i - x) / w;
      if (x < region.x0 || x >= region.x1 || y < region.y0 || y >= region.y1) continue;
    }
    const [L, A, B] = rgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    for (let u = 0; u < labs.length; u += 1) {
      for (const s of labs[u]) {
        const d = (L - s[0]) ** 2 + (A - s[1]) ** 2 + (B - s[2]) ** 2;
        if (d <= tol[u] && d < dist[i]) { dist[i] = d; label[i] = u; }
      }
    }
  }
  return { label, dist };
}

/**
 * Trace each unit. Returns one entry per unit: { polygons: [{ outer, holes,
 * area }], pixels } with rings in image pixels (closed implicitly).
 */
export function traceColours(image, units, options = {}) {
  const opts = { ...TRACE_DEFAULTS, ...options };
  const { width: w, height: h } = image;
  const n = w * h;
  const { label } = classify(image, units, opts);
  const minArea = Math.max(12, Math.round((opts.minArea ?? opts.minAreaFraction * n)));

  // 2. Open then close each unit; where two closed units overlap, the pixel
  // keeps the unit it was classified as, or the first that claims it.
  const final = new Int8Array(n).fill(-1);
  units.forEach((_, u) => {
    let m = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) if (label[i] === u) m[i] = 1;
    m = dilate(erode(m, w, h, opts.lineWidth), w, h, opts.lineWidth);
    m = erode(dilate(m, w, h, opts.gap), w, h, opts.gap);
    for (let i = 0; i < n; i += 1) if (m[i] && (final[i] === -1 || label[i] === u)) final[i] = u;
  });

  // 3. Strips between units: what closing the union of all units fills that
  // no single unit claimed. Grown into from the neighbours, a pixel a pass.
  if (opts.gap > 0 && units.length > 1) {
    const union = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) if (final[i] !== -1) union[i] = 1;
    const closed = erode(dilate(union, w, h, opts.gap + 1), w, h, opts.gap + 1);
    for (let pass = 0; pass <= opts.gap * 2; pass += 1) {
      let changed = 0;
      const prev = final.slice();
      for (let i = 0; i < n; i += 1) {
        if (!closed[i] || prev[i] !== -1) continue;
        const x = i % w;
        let nb = -1;
        if (x > 0 && prev[i - 1] >= 0) nb = prev[i - 1];
        else if (x < w - 1 && prev[i + 1] >= 0) nb = prev[i + 1];
        else if (i >= w && prev[i - w] >= 0) nb = prev[i - w];
        else if (i + w < n && prev[i + w] >= 0) nb = prev[i + w];
        if (nb >= 0) { final[i] = nb; changed += 1; }
      }
      if (!changed) break;
    }
  }

  // 4–5. Per unit: specks out, small holes filled, outlines traced.
  return units.map((_, u) => {
    let m = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) if (final[i] === u) m[i] = 1;
    if (opts.round > 0) m = majority(m, w, h, opts.round);
    const parts = components(m, w, h, 1);
    for (let i = 0; i < n; i += 1) if (m[i] && parts.sizes[parts.label[i]] < minArea) m[i] = 0;
    const holes = components(m, w, h, 0);
    for (let i = 0; i < n; i += 1) if (!m[i] && !holes.touches[holes.label[i]] && holes.sizes[holes.label[i]] < minArea) m[i] = 1;
    const comp = components(m, w, h, 1);
    const rings = traceRings(m, w, h);
    const byComp = new Map();
    for (const ring of rings) {
      const area = ringArea(ring.pts);
      const id = comp.label[ring.inside];
      // The staircase straightened first, then rounded over short segments
      // only, so a long straight edge does not round its corners away.
      const straight = simplifyRing(ring.pts, opts.simplify);
      const clean = opts.smooth ? simplifyRing(chaikin(densify(straight, 3), opts.smooth), 0.3) : straight;
      if (clean.length < 3) continue;
      const entry = byComp.get(id) || { outer: null, holes: [], area: comp.sizes[id] };
      if (area > 0) entry.outer = clean; else entry.holes.push(clean);
      byComp.set(id, entry);
    }
    const polygons = [...byComp.values()].filter((p) => p.outer).sort((a, b) => b.area - a.area);
    return { polygons, pixels: polygons.reduce((s, p) => s + p.area, 0) };
  });
}

/** Average colour of a (2r+1)² patch, for the eyedropper. */
export function samplePatch(image, x, y, r = 1) {
  const { data, width: w, height: h } = image;
  let sr = 0, sg = 0, sb = 0, c = 0;
  for (let j = Math.max(0, Math.round(y) - r); j <= Math.min(h - 1, Math.round(y) + r); j += 1) {
    for (let i = Math.max(0, Math.round(x) - r); i <= Math.min(w - 1, Math.round(x) + r); i += 1) {
      const o = (j * w + i) * 4; sr += data[o]; sg += data[o + 1]; sb += data[o + 2]; c += 1;
    }
  }
  return c ? [Math.round(sr / c), Math.round(sg / c), Math.round(sb / c)] : [0, 0, 0];
}
