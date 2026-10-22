// Lines and point symbols traced from a figure by colour: faults and trends
// (dashed, solid, or a thrust's teeth) and symbols (stars, diamonds, circles,
// squares, triangles). The person picks a colour; everything in it is found,
// and each find is reviewed before anything reaches the map.
//
// Lines:
//   1. the colour mask, with anything thicker than a line taken out (a
//      symbol, a legend swatch, a filled area of the same colour);
//   2. short solid blobs (dashes, dots) are chained by their own shape: a
//      dash to the next one along its axis, a dot in line with its
//      neighbours, across a gap up to the maximum. A chain is kept only when
//      its gaps (and a dotted line's dots) are regular, so lettering of the
//      same colour does not chain into a line;
//   3. the rest is thinned to a one-pixel skeleton (Zhang–Suen) and cut at
//      its junctions into simple pieces. Short spurs (a letter's arm, a
//      thrust's teeth: regular ones on one side make it a thrust) are
//      dropped, the pieces either side of a junction that run straight on are
//      joined again, and pieces whose ends face each other across a short gap
//      too. A dead straight level or upright stroke across a good part of the
//      figure is its frame or a panel's edge and is dropped, and so is a
//      skeleton that turns back and forth (a word of touching letters);
//   4. lines shorter than the minimum length are dropped; each is simplified
//      and called dashed or solid.
// Points:
//   1. compact blobs of the colour, holes filled, between the smallest and
//      largest size; a symbol with lines of its colour leaving it (a star on
//      a trend) is cut free by an opening;
//   2. lettering is not a symbol: a blob in a run of blobs of a size (a word),
//      in a crowd of small bits (broken-up small text) or level with two
//      others (a line of text), the counter of a letter on a card of the
//      colour, or a thin anti-aliased rim is left out;
//   3. the shape from the outline's distance from the centre around the
//      circle: its 3rd, 4th or 5th harmonic says triangle, square/diamond
//      (which by the corners' angle) or star; none (or a full disc) says
//      circle. Below 7 px only a star is told from a dot.
//
// Pure, like figureTrace.js: { data, width, height } in, pixel geometry out.
// Runs in the tracer's Web Worker.

import { rgbToLab, dilate, erode } from './figureTrace.js';

export const MARK_DEFAULTS = {
  tolerance: 18, // Lab ΔE to the nearest sample
  minLength: 40, // px: shorter lines are dropped
  maxGap: 14, // px: dash gaps up to this are joined
  minSize: 4, // px: smaller symbols are dropped
  maxSize: 48, // px: larger blobs are not symbols
  maxLineWidth: 9, // px: thicker strokes are areas or symbols, not lines
  maxDash: 50, // px: blobs up to this long are dashes or dots, chained by their shape
};

// ── colour ────────────────────────────────────────────────────────────────
function labImage(data, n) {
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const [L, A, B] = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    lab[i * 3] = L; lab[i * 3 + 1] = A; lab[i * 3 + 2] = B;
  }
  return lab;
}

function colourMask(image, lab, samples, tolerance, region) {
  const { data, width: w, height: h } = image;
  const n = w * h;
  const refs = samples.map((s) => rgbToLab(s[0], s[1], s[2]));
  const t2 = tolerance * tolerance;
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (data[i * 4 + 3] < 128) continue;
    if (region) {
      const x = i % w, y = (i - x) / w;
      if (x < region.x0 || x >= region.x1 || y < region.y0 || y >= region.y1) continue;
    }
    const L = lab[i * 3], A = lab[i * 3 + 1], B = lab[i * 3 + 2];
    for (const r of refs) {
      if ((L - r[0]) ** 2 + (A - r[1]) ** 2 + (B - r[2]) ** 2 <= t2) { m[i] = 1; break; }
    }
  }
  return m;
}

// Chamfer (3-4) distance to the nearest unset pixel, in pixels.
function distance(m, w, h) {
  const n = w * h;
  const d = new Float32Array(n);
  const INF = 1e9;
  for (let i = 0; i < n; i += 1) d[i] = m[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < n; i += 1) d[i] /= 3;
  return d;
}

// 8-connected components of the set pixels of `m`. Returns the label image
// and, per component, its pixel indexes.
function blobs(m, w, h) {
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const list = [];
  const stack = new Int32Array(n);
  for (let s = 0; s < n; s += 1) {
    if (!m[s] || label[s] !== -1) continue;
    const id = list.length, px = [];
    let top = 0;
    stack[top++] = s; label[s] = id;
    while (top) {
      const i = stack[--top];
      px.push(i);
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (m[j] && label[j] === -1) { label[j] = id; stack[top++] = j; }
        }
      }
    }
    list.push(px);
  }
  return { label, list };
}

// ── skeleton ──────────────────────────────────────────────────────────────
/** Zhang–Suen thinning, in place. The image border is cleared first. */
export function thin(m, w, h) {
  for (let x = 0; x < w; x += 1) { m[x] = 0; m[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y += 1) { m[y * w] = 0; m[y * w + w - 1] = 0; }
  let live = [];
  for (let i = 0; i < w * h; i += 1) if (m[i]) live.push(i);
  const del = [];
  for (let changed = true; changed;) {
    changed = false;
    for (let pass = 0; pass < 2; pass += 1) {
      del.length = 0;
      for (const i of live) {
        if (!m[i]) continue;
        const p2 = m[i - w], p3 = m[i - w + 1], p4 = m[i + 1], p5 = m[i + w + 1];
        const p6 = m[i + w], p7 = m[i + w - 1], p8 = m[i - 1], p9 = m[i - w - 1];
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (a !== 1) continue;
        if (pass === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
        del.push(i);
      }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
    live = live.filter((i) => m[i]);
  }
  // A pixel with three or more neighbours that stay connected without it is
  // a staircase corner, not a junction: removed, it leaves a clean path.
  for (const i of live) if (m[i] && nbCount(m, i, w) >= 3 && nbGroups(m, i, w) === 1) m[i] = 0;
  return m;
}

const NB = (w) => [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
// The 8 neighbours clockwise from north; a run of set ones round the ring
// (a diagonal touching its two sides counts as touching them) is one group.
const RING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
function nbCount(m, i, w) { let c = 0; for (const [dx, dy] of RING) c += m[i + dy * w + dx]; return c; }
function nbGroups(m, i, w) {
  const on = RING.map(([dx, dy]) => m[i + dy * w + dx]);
  // neighbours k and k+1 round the ring always touch; k and k+2 touch when k is a 4-neighbour (even k)
  const parent = [0, 1, 2, 3, 4, 5, 6, 7];
  const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  for (let k = 0; k < 8; k += 1) {
    if (!on[k]) continue;
    if (on[(k + 1) % 8]) parent[find(k)] = find((k + 1) % 8);
    if (k % 2 === 0 && on[(k + 2) % 8]) parent[find(k)] = find((k + 2) % 8);
  }
  const roots = new Set();
  for (let k = 0; k < 8; k += 1) if (on[k]) roots.add(find(k));
  return roots.size;
}

// The skeleton cut at its junctions into simple pieces: { pts: [[x, y]…],
// ends: [junction cluster | -1, …] }.
function skeletonPieces(sk, w, h) {
  const n = w * h;
  const nb = NB(w);
  // A junction: three or more separate branches leave the pixel.
  const deg = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) if (sk[i]) deg[i] = nbGroups(sk, i, w);
  // Junction pixels and their clusters.
  const junc = new Int32Array(n).fill(-1);
  let clusters = 0;
  for (let s = 0; s < n; s += 1) {
    if (!sk[s] || deg[s] < 3 || junc[s] !== -1) continue;
    const stack = [s]; junc[s] = clusters;
    while (stack.length) {
      const i = stack.pop();
      for (const o of nb) { const j = i + o; if (sk[j] && deg[j] >= 3 && junc[j] === -1) { junc[j] = clusters; stack.push(j); } }
    }
    clusters += 1;
  }
  const seen = new Uint8Array(n);
  const isPath = (j) => sk[j] && junc[j] === -1;
  const pathNb = (i) => nb.map((o) => i + o).filter((j) => isPath(j));
  const juncOf = (i) => { for (const o of nb) if (junc[i + o] !== -1) return junc[i + o]; return -1; };
  const pieces = [];
  const walk = (s) => {
    const out = [s]; seen[s] = 1;
    for (let cur = s; ;) {
      // prefer a 4-neighbour, so the walk follows the line and not a corner
      const next = pathNb(cur).filter((j) => !seen[j]).sort((a, b) => Math.abs(a - cur) === 1 || Math.abs(a - cur) === w ? -1 : Math.abs(b - cur) === 1 || Math.abs(b - cur) === w ? 1 : 0)[0];
      if (next == null) break;
      seen[next] = 1; out.push(next); cur = next;
    }
    return out;
  };
  for (let s = 0; s < n; s += 1) {
    if (!isPath(s) || seen[s]) continue;
    if (pathNb(s).length > 1) continue; // start from an end
    const idx = walk(s);
    pieces.push({ idx, ends: [juncOf(idx[0]), juncOf(idx[idx.length - 1])] });
  }
  for (let s = 0; s < n; s += 1) { // loops: no end to start from
    if (!isPath(s) || seen[s]) continue;
    const idx = walk(s);
    pieces.push({ idx, ends: [juncOf(idx[0]), juncOf(idx[idx.length - 1])], loop: true });
  }
  // A junction cluster on its own (a dot) makes no piece.
  return pieces.map((p) => ({ ...p, pts: p.idx.map((i) => [i % w, (i - (i % w)) / w]) }));
}

function polyLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i += 1) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

// Unit vector pointing out of the piece at its end `e` (0: start, 1: end).
function endDir(pts, e, reach = 8) {
  const k = Math.min(pts.length - 1, Math.max(1, reach));
  const [a, b] = e === 0 ? [pts[k], pts[0]] : [pts[pts.length - 1 - k], pts[pts.length - 1]];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

function simplifyLine(pts, tol) {
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

// Total turn along a polyline, in radians.
function turning(pts) {
  let t = 0;
  for (let i = 2; i < pts.length; i += 1) {
    const a1 = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]), a2 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    t += Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
  }
  return t;
}
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const cv = (a) => { if (a.length < 2) return 0; const m = a.reduce((s, v) => s + v, 0) / a.length; return m ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) / m : 0; };

/**
 * Lines of one colour. Returns [{ points: [[x, y]…], length, width, dashed,
 * dash: [on, off] | null, pieces }] in image pixels, longest first.
 */
export function traceLines(mask, w, h, options = {}) {
  const o = { ...MARK_DEFAULTS, ...options };
  const n = w * h;
  // 1. A light closing joins strokes broken by anti-aliasing; anything wider
  // than a line (a symbol, a swatch, an area) is taken out with a margin.
  const m = mask;
  const dt = distance(m, w, h);
  const half = o.maxLineWidth / 2;
  const core = new Uint8Array(n);
  let anyCore = false;
  for (let i = 0; i < n; i += 1) if (dt[i] > half) { core[i] = 1; anyCore = true; }
  const thick = anyCore ? dilate(core, w, h, Math.ceil(half) + 2) : core;
  const lm = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) if (m[i] && !thick[i]) lm[i] = 1;

  // Short blobs (dashes, dots) are chained by their own shape below; the
  // skeleton is for the rest (solid lines, and anything joined up).
  const dashes = [];
  const long = new Uint8Array(n);
  for (const px of blobs(lm, w, h).list) {
    const d = blobShape(px, w, dt);
    // a dash is painted solid: a word of touching letters is not
    // (filled, and as wide across as its stroke)
    if (d.area >= 3 && d.length <= o.maxDash && d.area >= 0.5 * d.length * d.across && d.across <= 1.5 * d.stroke + 1) dashes.push(d);
    else for (const i of px) long[i] = 1;
  }

  // 2. Skeleton pieces; spurs dropped; straight runs through junctions joined.
  const sk = thin(long, w, h);
  let pieces = skeletonPieces(sk, w, h).map((p) => {
    const widths = p.idx.map((i) => dt[i] * 2);
    return { pts: p.pts, ends: p.ends, loop: !!p.loop, len: polyLength(p.pts) + 1, width: Math.max(1, median(widths)) };
  });
  // A dead straight level or upright stroke across a quarter of the figure
  // is a frame, a panel's edge or a grid line, not a mapped feature.
  const frame = (pts) => {
    const a = pts[0], b = pts[pts.length - 1];
    const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
    if (!((dy <= 1 && dx >= 0.12 * w) || (dx <= 1 && dy >= 0.12 * h))) return false;
    return pts.every(([x, y]) => (dy <= 1 ? Math.abs(y - a[1]) <= 1.5 : Math.abs(x - a[0]) <= 1.5));
  };
  // Spurs are kept aside: regular ones all on one side of a line are a
  // thrust's teeth.
  const spurs = [];
  pieces = pieces.filter((p) => {
    const atJ = (p.ends[0] !== -1) + (p.ends[1] !== -1);
    if (atJ === 1 && p.len < Math.max(6, 2.5 * p.width)) {
      const base = p.ends[0] !== -1 ? p.pts[0] : p.pts[p.pts.length - 1];
      const tip = p.ends[0] !== -1 ? p.pts[p.pts.length - 1] : p.pts[0];
      if (p.len >= 3) spurs.push({ j: p.ends[0] !== -1 ? p.ends[0] : p.ends[1], base, tip });
      return false;
    }
    return p.len >= 2 && !frame(p.pts);
  });
  // links[piece*2+end] = { to: piece*2+end, gap }
  const links = new Map();
  const parent = pieces.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const link = (a, b, gap) => { links.set(a, { to: b, gap }); links.set(b, { to: a, gap }); parent[find(a >> 1)] = find(b >> 1); };
  const endPt = (k) => { const p = pieces[k >> 1].pts; return (k & 1) ? p[p.length - 1] : p[0]; };
  const dirOf = (k) => endDir(pieces[k >> 1].pts, k & 1);
  const atJunction = new Map();
  pieces.forEach((p, i) => p.ends.forEach((j, e) => {
    if (j === -1 || p.loop) return;
    if (!atJunction.has(j)) atJunction.set(j, []);
    atJunction.get(j).push(i * 2 + e);
  }));
  for (const ends of atJunction.values()) {
    // pair the ends that run most nearly straight on (outward directions opposite)
    const pairs = [];
    for (let a = 0; a < ends.length; a += 1) {
      for (let b = a + 1; b < ends.length; b += 1) {
        if ((ends[a] >> 1) === (ends[b] >> 1)) continue;
        const da = dirOf(ends[a]), db = dirOf(ends[b]);
        const dot = da[0] * db[0] + da[1] * db[1];
        if (dot < (ends.length === 2 ? 0.5 : -0.9)) pairs.push([dot, ends[a], ends[b]]);
      }
    }
    pairs.sort((x, y) => x[0] - y[0]);
    for (const [, a, b] of pairs) {
      if (links.has(a) || links.has(b) || find(a >> 1) === find(b >> 1)) continue;
      link(a, b, 0);
    }
  }

  // 3. Dash gaps: free ends facing each other across a short gap.
  const free = [];
  pieces.forEach((p, i) => { if (!p.loop) for (const e of [0, 1]) if (!links.has(i * 2 + e)) free.push(i * 2 + e); });
  const cell = Math.max(4, o.maxGap);
  const grid = new Map();
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const k of free) { const [x, y] = endPt(k); const kk = key(x, y); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(k); }
  const cands = [];
  const COS = Math.cos((25 * Math.PI) / 180);
  for (const a of free) {
    const [ax, ay] = endPt(a), da = dirOf(a);
    const gx = Math.floor(ax / cell), gy = Math.floor(ay / cell);
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        for (const b of grid.get(`${gx + i},${gy + j}`) || []) {
          if (b <= a || (a >> 1) === (b >> 1)) continue;
          const pa = pieces[a >> 1], pb = pieces[b >> 1];
          if (Math.max(pa.width, pb.width) > 2 * Math.min(pa.width, pb.width) + 1) continue;
          // A piece must be longer than wide to carry a direction.
          if (pa.len < 1.5 * pa.width || pb.len < 1.5 * pb.width) continue;
          const [bx, by] = endPt(b), db = dirOf(b);
          const gxv = bx - ax, gyv = by - ay, d = Math.hypot(gxv, gyv);
          if (d > o.maxGap) continue;
          const dd = da[0] * db[0] + da[1] * db[1];
          if (dd > -0.85) continue;
          let ca = 1, cb = 1;
          if (d >= 2) {
            ca = (da[0] * gxv + da[1] * gyv) / d;
            cb = -(db[0] * gxv + db[1] * gyv) / d;
            if (ca < COS || cb < COS) continue;
          }
          cands.push([d * (1 + 4 * (1 - ca) + 4 * (1 - cb)), a, b, d]);
        }
      }
    }
  }
  cands.sort((x, y) => x[0] - y[0]);
  for (const [, a, b, d] of cands) {
    if (links.has(a) || links.has(b) || find(a >> 1) === find(b >> 1)) continue;
    link(a, b, d);
  }

  // Chains: walk from a piece end with no link along the links.
  const used = new Uint8Array(pieces.length);
  const chains = [];
  const walkChain = (startPiece, startEnd) => {
    const parts = []; // { piece, reversed, gapBefore }
    let p = startPiece, e = startEnd, gap = 0;
    for (;;) {
      used[p] = 1;
      parts.push({ piece: p, reversed: e === 1, gapBefore: gap });
      const out = p * 2 + (1 - e);
      const l = links.get(out);
      if (!l || used[l.to >> 1]) break;
      p = l.to >> 1; e = l.to & 1; gap = l.gap;
    }
    return parts;
  };
  pieces.forEach((pc, i) => {
    if (used[i]) return;
    if (pc.loop) { used[i] = 1; chains.push([{ piece: i, reversed: false, gapBefore: 0 }]); return; }
    for (const e of [0, 1]) if (!links.has(i * 2 + e)) { chains.push(walkChain(i, e)); return; }
  });
  pieces.forEach((_, i) => { if (!used[i]) chains.push(walkChain(i, 0)); }); // closed rings of pieces

  // Teeth: spurs at the chain's junctions, side by the line's direction there
  // ('left' of the way the line runs, on screen, as utils/geoStyle.js draws them).
  const spursAt = new Map();
  for (const sp of spurs) { if (!spursAt.has(sp.j)) spursAt.set(sp.j, []); spursAt.get(sp.j).push(sp); }
  const teethOf = (parts, pts, length) => {
    const js = new Set(parts.flatMap((p) => pieces[p.piece].ends.filter((j) => j !== -1)));
    const found = [...js].flatMap((j) => spursAt.get(j) || []);
    if (found.length < 3 || length / found.length > 120) return null;
    let left = 0;
    const at = [];
    for (const sp of found) {
      let k = 0, best = Infinity;
      pts.forEach(([x, y], i) => { const d = (x - sp.base[0]) ** 2 + (y - sp.base[1]) ** 2; if (d < best) { best = d; k = i; } });
      const a = pts[Math.max(0, k - 3)], b = pts[Math.min(pts.length - 1, k + 3)];
      const cross = (b[0] - a[0]) * (sp.tip[1] - sp.base[1]) - (b[1] - a[1]) * (sp.tip[0] - sp.base[0]);
      if (cross < 0) left += 1;
      at.push(k);
    }
    const side = left >= found.length * 0.8 ? 'left' : left <= found.length * 0.2 ? 'right' : null;
    if (!side) return null;
    at.sort((x, y) => x - y);
    const spacing = at.slice(1).map((k, i) => k - at[i]);
    return cv(spacing) <= 0.6 ? side : null;
  };

  // 4. Keep, check the dashes, simplify, describe.
  const out = [];
  const emit = (parts) => {
    const pts = [];
    let gaps = 0, dashLinks = 0;
    const lens = [], gapList = [];
    for (const part of parts) {
      const pc = pieces[part.piece];
      const seg = part.reversed ? [...pc.pts].reverse() : pc.pts;
      pts.push(...seg);
      lens.push(pc.len);
      if (part.gapBefore > 0) { gaps += part.gapBefore; dashLinks += 1; gapList.push(part.gapBefore); }
    }
    const length = polyLength(pts) + 1;
    if (length < o.minLength) return;
    // A mapped line runs on; the skeleton of a word of touching letters
    // turns back and forth.
    if (turning(simplifyLine(pts, 2)) > Math.max(1.6, (3 * length) / 100)) return;
    const dashed = dashLinks >= 2 && gaps / length >= 0.1;
    const width = median(parts.map((p) => pieces[p.piece].width));
    out.push({
      teeth: teethOf(parts, pts, length),
      points: simplifyLine(pts, 0.9),
      length: Math.round(length),
      width: +width.toFixed(1),
      dashed,
      dash: dashed ? [Math.round(median(lens.slice(1, -1).length ? lens.slice(1, -1) : lens)), Math.round(median(gapList))] : null,
      pieces: parts.length,
    });
  };
  for (const parts of chains) {
    // A chain of three or more pieces joined across gaps must look like a
    // dashed line: dashes of a regular length (the first and last may be cut),
    // gaps of a regular length. Lettering of the same colour does not.
    const dashParts = parts.filter((p, i) => i === 0 || p.gapBefore > 0);
    if (dashParts.length >= 3) {
      const inner = parts.map((p) => pieces[p.piece].len).slice(1, -1);
      const gapsOf = parts.filter((p) => p.gapBefore > 0).map((p) => p.gapBefore);
      const regular = (inner.length < 2 || cv(inner) <= 0.6) && cv(gapsOf) <= 0.6;
      if (!regular) {
        // split at the gaps: each run must stand on its own
        let run = [];
        for (const p of parts) {
          if (p.gapBefore > 0 && run.length) { emit(run); run = []; }
          run.push({ ...p, gapBefore: 0 });
        }
        if (run.length) emit(run);
        continue;
      }
    }
    emit(parts);
  }
  out.push(...dashLines(dashes, o));
  return out.sort((a, b) => b.length - a.length);
}

// A blob's centre, its long axis (from the second moments), its extent
// along that axis and its width.
function blobShape(px, w, dt) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, dmax = 0;
  for (const i of px) { const x = i % w, y = (i - x) / w; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; if (dt[i] > dmax) dmax = dt[i]; }
  const A = px.length, cx = sx / A, cy = sy / A;
  const vx = sxx / A - cx * cx, vy = syy / A - cy * cy, c = sxy / A - cx * cy;
  const theta = 0.5 * Math.atan2(2 * c, vx - vy);
  const ux = Math.cos(theta), uy = Math.sin(theta);
  let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
  for (const i of px) {
    const x = i % w, y = (i - x) / w, t = (x - cx) * ux + (y - cy) * uy, q = -(x - cx) * uy + (y - cy) * ux;
    if (t < lo) lo = t; if (t > hi) hi = t; if (q < lo2) lo2 = q; if (q > hi2) hi2 = q;
  }
  const length = hi - lo + 1, across = hi2 - lo2 + 1;
  return {
    x: cx, y: cy, area: A, ux, uy, length, across, stroke: 2 * dmax, width: Math.max(1, Math.min(across, 2 * dmax)),
    // a dash has a direction; a dot (no longer than about wide) has none
    dir: length >= 1.8 * across,
    a: [cx + ux * (lo + 0.5), cy + uy * (lo + 0.5)], b: [cx + ux * (hi - 0.5), cy + uy * (hi - 0.5)],
  };
}

// Dashes and dots chained into dashed and dotted lines: each joined to the
// next along its own direction (a dash) or in line with its neighbours (a
// dot), across a gap up to the maximum, at a regular spacing. A chain is kept
// when it has three or more dashes (four dots) of a regular size, regular
// gaps, and is at least the minimum length; lettering of the line's colour
// does not make such a chain. A lone dash long enough is a short solid line.
function dashLines(dashes, o) {
  const reach = o.maxGap + o.maxDash;
  const grid = new Map();
  dashes.forEach((d, i) => { const k = `${Math.floor(d.x / reach)},${Math.floor(d.y / reach)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const COS = Math.cos((25 * Math.PI) / 180);
  const gapOf = (d, e) => Math.max(0, Math.hypot(e.x - d.x, e.y - d.y) - (d.length + e.length) / 2);
  const pairs = [];
  dashes.forEach((d, i) => {
    const gx = Math.floor(d.x / reach), gy = Math.floor(d.y / reach);
    for (let a = -1; a <= 1; a += 1) {
      for (let b = -1; b <= 1; b += 1) {
        for (const j of grid.get(`${gx + a},${gy + b}`) || []) {
          if (j <= i) continue;
          const e = dashes[j], vx = e.x - d.x, vy = e.y - d.y, dist = Math.hypot(vx, vy);
          if (!dist) continue;
          const gap = gapOf(d, e);
          if (gap > o.maxGap || gap < 0.5) continue;
          if (Math.max(d.width, e.width) > 2 * Math.min(d.width, e.width) + 1) continue;
          // a dash points along the line it belongs to
          if (d.dir && Math.abs((vx * d.ux + vy * d.uy) / dist) < COS) continue;
          if (e.dir && Math.abs((vx * e.ux + vy * e.uy) / dist) < COS) continue;
          pairs.push([gap, i, j]);
        }
      }
    }
  });
  pairs.sort((a, b) => a[0] - b[0]);
  const nbrs = dashes.map(() => []);
  const parent = dashes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  // A second link must carry on in line with the first, across a like gap.
  const fits = (i, j) => nbrs[i].every((k) => {
    const d = dashes[i], v1 = [dashes[k].x - d.x, dashes[k].y - d.y], v2 = [dashes[j].x - d.x, dashes[j].y - d.y];
    const g1 = gapOf(d, dashes[k]), g2 = gapOf(d, dashes[j]);
    return (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2)) <= -COS && Math.abs(g1 - g2) <= Math.max(4, 0.6 * Math.max(g1, g2));
  });
  for (const [, i, j] of pairs) {
    if (nbrs[i].length >= 2 || nbrs[j].length >= 2 || find(i) === find(j)) continue;
    if (!fits(i, j) || !fits(j, i)) continue;
    nbrs[i].push(j); nbrs[j].push(i); parent[find(i)] = find(j);
  }
  const out = [];
  const seen = new Uint8Array(dashes.length);
  const walk = (s) => {
    const run = [s]; seen[s] = 1;
    for (let cur = s, next = nbrs[s][0]; next != null && !seen[next];) {
      run.push(next); seen[next] = 1;
      const after = nbrs[next].find((k) => k !== cur);
      cur = next; next = after;
    }
    return run;
  };
  const runs = [];
  dashes.forEach((_, s) => { if (!seen[s] && nbrs[s].length <= 1) runs.push(walk(s)); });
  dashes.forEach((_, s) => { if (!seen[s]) runs.push(walk(s)); }); // closed rings of dashes
  for (const run of runs) {
    const ds = run.map((k) => dashes[k]);
    if (run.length === 1) {
      const d = ds[0];
      if (d.dir && d.length >= o.minLength && d.length >= 3 * d.width) {
        out.push({ teeth: null, points: [d.a, d.b].map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]), length: Math.round(d.length), width: +d.width.toFixed(1), dashed: false, dash: null, pieces: 1 });
      }
      continue;
    }
    const dotted = ds.every((d) => !d.dir);
    if (run.length < (dotted ? 4 : 3)) continue;
    const gaps = ds.slice(1).map((e, k) => gapOf(ds[k], e));
    const lens = ds.map((d) => d.length);
    const inner = lens.length > 2 ? lens.slice(1, -1) : lens;
    // regular: within 45 % of the mean, or within 4 px (a small gap measures noisily)
    const regular = (a) => cv(a) <= 0.45 || Math.max(...a) - Math.min(...a) <= 4;
    // Dots must be regular in size and spacing (lettering is not); dashes,
    // which already point along the line, in their gaps.
    if (cv(ds.map((d) => d.width)) > 0.4) continue;
    if (dotted ? !regular(gaps) || !regular(inner) : !(cv(gaps) <= 0.6 || Math.max(...gaps) - Math.min(...gaps) <= 6)) continue;
    // the dashes' ends in order along the chain
    const pts = [];
    ds.forEach((d, k) => {
      if (!d.dir) { pts.push([d.x, d.y]); return; }
      const nx = (ds[k + 1] || d).x - (ds[k - 1] || d).x, ny = (ds[k + 1] || d).y - (ds[k - 1] || d).y;
      const fwd = nx * d.ux + ny * d.uy >= 0;
      pts.push(...(fwd ? [d.a, d.b] : [d.b, d.a]));
    });
    const length = polyLength(pts) + 1;
    if (length < o.minLength) continue;
    out.push({
      teeth: null,
      points: simplifyLine(pts.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]), 0.9),
      length: Math.round(length),
      width: +median(ds.map((d) => d.width)).toFixed(1),
      dashed: true,
      dash: [Math.round(median(lens)), Math.round(median(gaps))],
      pieces: run.length,
    });
  }
  return out;
}

// ── points ────────────────────────────────────────────────────────────────
function fillHoles(px, w) {
  // px: pixel indexes of one blob → the blob with its holes filled, in a crop.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of px) { const x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const cw = x1 - x0 + 3, ch = y1 - y0 + 3; // one pixel of margin all round
  const crop = new Uint8Array(cw * ch);
  for (const i of px) { const x = i % w, y = (i - x) / w; crop[(y - y0 + 1) * cw + (x - x0 + 1)] = 1; }
  const outside = new Uint8Array(cw * ch);
  const stack = [0]; outside[0] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % cw, y = (i - x) / cw;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
      const j = yy * cw + xx;
      if (!crop[j] && !outside[j]) { outside[j] = 1; stack.push(j); }
    }
  }
  const pts = [];
  for (let i = 0; i < cw * ch; i += 1) if (!outside[i]) { const x = i % cw, y = (i - x) / cw; pts.push([x + x0 - 1, y + y0 - 1]); }
  return { pts, box: [x0, y0, x1, y1] };
}

/**
 * The shape of a filled blob ([[x, y]…] pixel positions). Returns { shape,
 * confidence, size, fill, elongation, cx, cy }.
 */
export function classifyShape(pts) {
  const A = pts.length;
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= A; cy /= A;
  let sxx = 0, syy = 0, sxy = 0, rmax = 0;
  for (const [x, y] of pts) {
    const dx = x - cx, dy = y - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    const r = Math.hypot(dx, dy) + 0.5;
    if (r > rmax) rmax = r;
  }
  const tr = (sxx + syy) / A, det = (sxx * syy - sxy * sxy) / (A * A);
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
  const elongation = Math.sqrt(l1 / l2);
  const fill = A / (Math.PI * rmax * rmax);
  // The outline's distance from the centre, round the circle: the farthest
  // pixel edge in each angular bin (empty bins taken from their neighbours).
  const N = 48;
  const prof = new Float32Array(N);
  for (const [x, y] of pts) {
    // the pixel's four corners, so a small blob still fills the bins
    for (const [ox, oy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      const dx = x + ox - cx, dy = y + oy - cy;
      const b = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * N) % N;
      const r = Math.hypot(dx, dy);
      if (r > prof[b]) prof[b] = r;
    }
  }
  const sm = Array.from(prof, (_, i) => (prof[(i + N - 1) % N] + 2 * prof[i] + prof[(i + 1) % N]) / 4);
  const mean = sm.reduce((s, v) => s + v, 0) / N || 1;
  const harm = (k) => {
    let re = 0, im = 0;
    for (let i = 0; i < N; i += 1) { const t = -Math.PI + ((i + 0.5) / N) * 2 * Math.PI; re += sm[i] * Math.cos(k * t); im += sm[i] * Math.sin(k * t); }
    return { mag: (2 / N) * Math.hypot(re, im) / mean, phase: Math.atan2(im, re) };
  };
  const H = { 3: harm(3), 4: harm(4), 5: harm(5) };
  const ranked = [3, 4, 5].sort((a, b) => H[b].mag - H[a].mag);
  const top = ranked[0], second = H[ranked[1]].mag;
  const confidence = +Math.min(1, (H[top].mag - second) / Math.max(0.05, H[top].mag)).toFixed(2);
  const size = +(2 * rmax).toFixed(1);
  // Below 7 px only a star's points are read; anything else is a dot.
  if (size < 7 && !(H[5].mag >= 0.25 && fill < 0.6 && top === 5)) return { size, fill: +fill.toFixed(2), elongation: +elongation.toFixed(2), cx, cy, shape: 'circle', confidence: 0.3 };
  const base = { size, fill: +fill.toFixed(2), elongation: +elongation.toFixed(2), cx, cy };
  // A small disc's pixel steps read as corners: its fill tells it from a
  // square or diamond (π/4 of a circle's) unless a 3rd or 5th harmonic says otherwise.
  if ((H[top].mag < 0.06 && fill > 0.7) || (fill >= 0.85 && H[3].mag < 0.08 && H[5].mag < 0.08)) return { ...base, shape: 'circle', confidence: +Math.min(1, (0.06 - H[top].mag) / 0.04 + 0.3).toFixed(2) };
  if (top === 5 && H[5].mag >= 0.1) return { ...base, shape: 'star', confidence };
  if (top === 3 && H[3].mag >= 0.08) {
    // the corner nearest straight up (−90°, y down) or straight down
    const peak = H[3].phase / 3; // a corner at peak + n·120°
    const up = [0, 1, 2].some((j) => Math.abs(Math.atan2(Math.sin(peak + (j * 2 * Math.PI) / 3 + Math.PI / 2), Math.cos(peak + (j * 2 * Math.PI) / 3 + Math.PI / 2))) < Math.PI / 6);
    return { ...base, shape: up ? 'triangle' : 'triangle_down', confidence };
  }
  if (top === 4 && H[4].mag >= 0.05) {
    // corners on the axes: a diamond; between them: a square
    const peak = H[4].phase / 4; // a corner at peak + n·90°
    const off = Math.abs(Math.atan2(Math.sin(4 * peak), Math.cos(4 * peak))); // 0: on the axes, π: at 45°
    const diamond = off < Math.PI / 2;
    // A small disc's pixel steps read as a square's corners: below 11 px a
    // square must be clearly one.
    if (size >= 11 || diamond || (fill <= 0.78 && H[4].mag >= 0.12)) return { ...base, shape: diamond ? 'diamond' : 'square', confidence };
  }
  return { ...base, shape: 'circle', confidence: 0.2 };
}

/**
 * Point symbols of one colour. Returns [{ x, y, size, shape, confidence }]
 * in image pixels.
 */
export function tracePoints(mask, w, h, options = {}) {
  const o = { ...MARK_DEFAULTS, ...options };
  const n = w * h;
  const { label, list } = blobs(mask, w, h);
  const info = list.map((px) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const i of px) {
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    // elongation from the second moments: a line piece at any angle reads long
    const A = px.length, vx = sxx / A - (sx / A) ** 2, vy = syy / A - (sy / A) ** 2, cxy = sxy / A - (sx / A) * (sy / A);
    const disc = Math.sqrt(Math.max(0, ((vx - vy) / 2) ** 2 + cxy * cxy));
    const elong = Math.sqrt(((vx + vy) / 2 + disc) / Math.max(0.08, (vx + vy) / 2 - disc));
    return { box: [x0, y0, x1, y1], area: A, long: Math.max(x1 - x0, y1 - y0) + 1, short: Math.min(x1 - x0, y1 - y0) + 1, elong };
  });
  // grid of blob boxes for the neighbour test
  const cell = Math.max(8, o.maxSize);
  const grid = new Map();
  info.forEach((b, id) => {
    if (b.area < 3) return;
    for (let gx = Math.floor(b.box[0] / cell); gx <= Math.floor(b.box[2] / cell); gx += 1) {
      for (let gy = Math.floor(b.box[1] / cell); gy <= Math.floor(b.box[3] / cell); gy += 1) {
        const k = `${gx},${gy}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id);
      }
    }
  });
  const boxGap = (a, b) => Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2]) - 1, Math.max(a[1], b[1]) - Math.min(a[3], b[3]) - 1);
  const nearby = (box, size) => {
    const reach = Math.max(2, 0.35 * size);
    const ids = new Set();
    for (let gx = Math.floor((box[0] - reach) / cell); gx <= Math.floor((box[2] + reach) / cell); gx += 1) {
      for (let gy = Math.floor((box[1] - reach) / cell); gy <= Math.floor((box[3] + reach) / cell); gy += 1) {
        for (const id of grid.get(`${gx},${gy}`) || []) if (boxGap(box, info[id].box) <= reach) ids.add(id);
      }
    }
    return [...ids];
  };
  // Letters of one word are of a size (the same height, area within 3×) and
  // not long and thin like a dash or a piece of line.
  const similar = (b, size, area) => b.elong < 3 && b.long >= 0.6 * size && b.long <= 1.67 * size && b.area >= area / 3 && b.area <= 3 * area;
  const wordOf = info.map((_, i) => i);
  const root = (i) => { while (wordOf[i] !== i) { wordOf[i] = wordOf[wordOf[i]]; i = wordOf[i]; } return i; };
  info.forEach((b, id) => {
    if (b.area < 3 || b.long > o.maxSize || b.elong >= 3) return;
    for (const j of nearby(b.box, b.long)) if (j !== id && similar(info[j], b.long, b.area)) wordOf[root(j)] = root(id);
  });
  const wordSize = new Map();
  info.forEach((_, i) => { const r = root(i); wordSize.set(r, (wordSize.get(r) || 0) + 1); });
  const word = info.map((_, i) => wordSize.get(root(i)));
  const minArea = Math.max(4, Math.round((o.minSize * o.minSize) / 3));
  const compact = (c) => c.elongation <= 1.6 && c.fill >= 0.25 && c.size >= o.minSize && c.size <= o.maxSize;

  const found = [];
  const consider = (pts, own, cut) => {
    const s = classifyShape(pts);
    if (!compact(s)) return;
    // Painted, not a rim: a symbol has a solid core. The anti-aliased edge of
    // something else (a grey fringe round dark lettering) is one or two pixels thin.
    const on = new Set(pts.map(([x, y]) => y * w + x));
    let core = 0;
    for (const i of on) if (on.has(i - 1) && on.has(i + 1) && on.has(i - w) && on.has(i + w) && on.has(i - w - 1) && on.has(i - w + 1) && on.has(i + w - 1) && on.has(i + w + 1)) core += 1;
    if (core < (s.size >= 8 ? 0.2 * pts.length : 1)) return;
    const R = s.size / 2;
    // A symbol stands on its own. Lettering does not: a run of three or
    // more blobs of the colour, of a size, close together (a word) …
    if (!cut && word[own] >= 3) return;
    if (cut) {
      const box = [Math.floor(s.cx - R), Math.floor(s.cy - R), Math.ceil(s.cx + R), Math.ceil(s.cy + R)];
      const like = nearby(box, s.size).filter((id) => id !== own && similar(info[id], s.size, pts.length));
      if (like.length >= 2) return;
    }
    // … or a crowd of small bits of the colour round it (lettering broken up
    // by anti-aliasing, a block of small text).
    {
      const box = [Math.floor(s.cx - R), Math.floor(s.cy - R), Math.ceil(s.cx + R), Math.ceil(s.cy + R)];
      const bits = nearby(box, 1.7 * s.size).filter((id) => id !== own && info[id].area >= Math.max(3, 0.15 * pts.length) && info[id].long <= 2 * s.size && info[id].elong < 3);
      if (bits.length >= 3) return;
      // … or two or more of them on its line of text, level with it
      const row = nearby([box[0] - s.size, box[1], box[2] + s.size, box[3]], s.size).filter((id) => {
        const b = info[id];
        return id !== own && b.area >= Math.max(3, 0.2 * pts.length) && b.long <= 2 * s.size && b.elong < 3 && Math.abs((b.box[1] + b.box[3]) / 2 - s.cy) <= 0.35 * s.size;
      });
      if (row.length >= 2) return;
    }
    // … and neither does the counter of a letter (the hole in an "o" on a
    // card of the same colour): the ring round it is mostly that colour. A
    // symbol cut from lines leaving it has only the lines in its ring, not
    // the rest of a label pill or panel.
    const R2 = R + Math.max(6, 0.6 * R);
    let ring = 0, same = 0, mine = 0;
    for (let y = Math.max(0, Math.floor(s.cy - R2)); y <= Math.min(h - 1, Math.ceil(s.cy + R2)); y += 1) {
      for (let x = Math.max(0, Math.floor(s.cx - R2)); x <= Math.min(w - 1, Math.ceil(s.cx + R2)); x += 1) {
        const d = Math.hypot(x - s.cx, y - s.cy);
        if (d <= R + 1 || d > R2) continue;
        ring += 1;
        const i = y * w + x;
        if (mask[i]) { if (label[i] === own) mine += 1; else same += 1; }
      }
    }
    if (ring && (same / ring > 0.25 || mine / ring > 0.2)) return;
    found.push({ x: +s.cx.toFixed(1), y: +s.cy.toFixed(1), size: s.size, shape: s.shape, confidence: s.confidence, cut: !!cut });
  };

  // Blobs that are a symbol as they stand; the others (a symbol with lines
  // leaving it, a star on a trend line) wait for the openings below.
  const pending = new Uint8Array(n);
  let anyPending = false;
  list.forEach((px, id) => {
    const b = info[id];
    if (b.area < minArea) return;
    if (b.area > 4 * o.maxSize * o.maxSize && b.short > o.maxSize) return; // an area, not a symbol
    const filled = fillHoles(px, w);
    const s = classifyShape(filled.pts);
    if (b.long <= o.maxSize && s.elongation <= 1.6 && s.fill >= 0.25) { consider(filled.pts, id, false); return; }
    for (const i of px) pending[i] = 1;
    anyPending = true;
  });
  // Opened with a growing radius: lines up to 2r+1 px wide fall away and
  // the symbols on them separate. Each is taken back with the pixels of the
  // colour just round it, so its points are not rounded off.
  // A symbol cut free must be clearly thicker than the strokes it was cut
  // from (the lines leaving it); a chunk of lettering run together into one
  // blob is no thicker than the rest of the letters.
  const dt = anyPending ? distance(mask, w, h) : null;
  const strokeOf = (own, part) => {
    const inPart = new Set(part);
    const v = list[own].filter((i) => !inPart.has(i)).map((i) => dt[i]).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length * 0.9)] : 0;
  };
  for (let r = 1; r <= 3 && anyPending; r += 1) {
    const opened = dilate(erode(pending, w, h, r), w, h, r);
    const grown = dilate(opened, w, h, r + 1);
    const rec = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) if (pending[i] && grown[i]) rec[i] = 1;
    const parts = blobs(rec, w, h).list;
    anyPending = false;
    for (const px of parts) {
      if (px.length < minArea) continue;
      const filled = fillHoles(px, w);
      const c = classifyShape(filled.pts);
      let thickest = 0;
      for (const i of px) if (dt[i] > thickest) thickest = dt[i];
      if (compact(c) && thickest >= Math.max(2.5, 1.6 * strokeOf(label[px[0]], px))) {
        consider(filled.pts, label[px[0]], true);
        // taken: not looked at again with a larger radius
        const R = c.size / 2 + r + 2;
        for (let y = Math.max(0, Math.floor(c.cy - R)); y <= Math.min(h - 1, Math.ceil(c.cy + R)); y += 1) {
          for (let x = Math.max(0, Math.floor(c.cx - R)); x <= Math.min(w - 1, Math.ceil(c.cx + R)); x += 1) pending[y * w + x] = 0;
        }
      } else {
        anyPending = true;
      }
    }
  }
  return found;
}

/**
 * Detect lines or points for each picked colour. `sets` are { kind: 'line' |
 * 'point', samples: [[r, g, b]…], tolerance? }. Returns one entry per set:
 * { lines } or { points } in image pixels.
 */
export function detectMarks(image, sets, options = {}) {
  const o = { ...MARK_DEFAULTS, ...options };
  const { data, width: w, height: h } = image;
  const lab = labImage(data, w * h);
  return sets.map((set) => {
    const mask = colourMask(image, lab, set.samples || [], set.tolerance ?? o.tolerance, o.region);
    return set.kind === 'point' ? { points: tracePoints(mask, w, h, o) } : { lines: traceLines(mask, w, h, o) };
  });
}

/** The style most of a set's finds suggest: 'dashed' | 'solid' | 'thrust' for lines, a marker shape for points. */
export function suggestStyle(kind, found) {
  if (!found?.length) return kind === 'point' ? 'circle' : 'solid';
  const tally = new Map();
  for (const f of found) {
    const k = kind === 'point' ? f.shape : f.teeth ? 'thrust' : f.dashed ? 'dashed' : 'solid';
    tally.set(k, (tally.get(k) || 0) + (kind === 'point' ? 1 : f.length));
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
