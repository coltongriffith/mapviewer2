// Leaders and pills for Exploration Maps 3D (loaded with tags.js or look.js, not with the page): leaders routed
// around the cards, labels moved where theirs would detour, and collar pills placed clear of each other.
// Pure functions; boxes are [x0, y0, x1, y1] in frame pixels.
import { hits, overlapArea } from './layout.js';

// Whether the segment p→q passes through box b grown by pad (Liang–Barsky clipping).
export function segHits(p, q, b, pad = 0) {
  let t0 = 0, t1 = 1; const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [d, lo, hi, o] of [[dx, b[0] - pad, b[2] + pad, p[0]], [dy, b[1] - pad, b[3] + pad, p[1]]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
    let a = (lo - o) / d, c = (hi - o) / d; if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) return false;
  }
  return true;
}
const pathLen = (pts) => pts.reduce((t, p, i) => t + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
const inside = (pt, b) => pt[0] >= b[0] && pt[0] <= b[2] && pt[1] >= b[1] && pt[1] <= b[3];
// A leader from `from` to `to` that keeps off the boxes (cards, their text, markers): straight when clear,
// else the shortest route bending once or twice just outside the corners of the boxes in the way. Boxes
// holding either end are ignored. Returns the points, from first; straight when nothing clear is found.
export function routeLeader(from, to, boxes, pad = 0, frame = null) {
  const bs = boxes.filter((b) => !inside(from, b) && !inside(to, b)), clear = (p, q) => !bs.some((b) => segHits(p, q, b, pad));
  if (clear(from, to)) return [from, to];
  const ok = (p) => !bs.some((b) => inside(p, [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad])) && (!frame || inside(p, frame));
  const corners = bs.flatMap((b) => [[b[0] - 2 * pad, b[1] - 2 * pad], [b[2] + 2 * pad, b[1] - 2 * pad], [b[2] + 2 * pad, b[3] + 2 * pad], [b[0] - 2 * pad, b[3] + 2 * pad]]).filter(ok);
  let best = null; const take = (pts) => { if (!best || pathLen(pts) < pathLen(best)) best = pts; };
  corners.forEach((c) => { if (clear(from, c) && clear(c, to)) take([from, c, to]); });
  if (!best) corners.forEach((c) => { if (clear(from, c)) corners.forEach((d) => { if (d !== c && clear(c, d) && clear(d, to)) take([from, c, d, to]); }); });
  return best || [from, to];
}

// Where a label with an arrow sits: where it is when its leader runs straight or with one bend, at most 1.4
// times the straight distance; else (unless pinned: dragged there by hand) a spot around the tip, inside the
// frame and clear of the boxes, whose leader does: off `soft` (the block) if it can be, straight if it can be,
// then the nearest. A pinned label keeps its spot and a straight or one-bend leader, even across a box.
// Returns { at, pts }.
export function leaderSpot(at, tip, [bw, bh], boxes, { frame, soft = [], pad = 0, unit = 1, pinned = false } = {}) {
  const lead = (c) => { const pts = routeLeader(c, tip, boxes, pad, frame); return pts.length <= 3 && pathLen(pts) <= 1.4 * Math.hypot(tip[0] - c[0], tip[1] - c[1]) ? pts : null; };
  const own = lead(at); if (own) return { at, pts: own };
  const kept = () => { const pts = routeLeader(at, tip, boxes, pad, frame); return { at, pts: pts.length <= 3 ? pts : [at, tip] }; };
  if (pinned) return kept();
  let best = null;
  for (const r of [110, 170, 240, 340, 460]) for (let a = 0; a < 360; a += 30) {
    const t = a * Math.PI / 180, c = [tip[0] + Math.cos(t) * (r * unit + bw / 2), tip[1] + Math.sin(t) * (r * unit + bh / 2)], b = [c[0] - bw / 2, c[1] - bh / 2, c[0] + bw / 2, c[1] + bh / 2];
    if ((frame && !(b[0] >= frame[0] + pad && b[1] >= frame[1] + pad && b[2] <= frame[2] - pad && b[3] <= frame[3] - pad)) || boxes.some((o) => hits(b, o, pad))) continue;
    const pts = lead(c); if (!pts) continue;
    const score = (soft.some((o) => hits(b, o)) ? 2e6 : 0) + (pts.length > 2 ? 1e6 : 0) + Math.hypot(c[0] - at[0], c[1] - at[1]); // off the block, straight, near
    if (!best || score < best.score) best = { at: c, pts, score };
  }
  return best ? { at: best.at, pts: best.pts } : kept();
}

// Pill placement: each { x, y, w, h } (anchor and size) tries spots above, beside and further out, and
// takes the first clear of `avoid`, the frame edge and the pills already placed (leaders included); failing that, the spot
// with the least overlap, or (drop) none: items come in priority order, so the lowest-priority pills are
// the ones left out rather than drawn over another. Returns { cx, cy, box, leader } per item placed.
export function placePills(items, avoid, { W, H, unit = 1, pad = 4, drop = false, leaders = false }) { // leaders: false | 'far' | 'all'
  const placed = [], out = [];
  const spots = [[0, -1], [1, -0.7], [-1, -0.7], [0, -2], [1.3, -1.7], [-1.3, -1.7], [0, 1], [1.2, 0.6], [-1.2, 0.6], [0, -3], [1.6, -2.7], [-1.6, -2.7], [0, 2], [2, 0], [-2, 0], [0, -4], [2, -3.7], [-2, -3.7]];
  for (const it of items) {
    let best = null;
    for (const [sx, sy] of spots) {
      const cx = it.x + sx * (it.w / 2 + 8 * unit), cy = it.y + sy * (it.h + 6 * unit), box = [cx - it.w / 2 - pad, cy - it.h / 2 - pad, cx + it.w / 2 + pad, cy + it.h / 2 + pad];
      if (box[0] < 0 || box[1] < 0 || box[2] > W || box[3] > H) continue;
      const far = Math.abs(sx) > 1.1 || Math.abs(sy) > 1.1, at = [it.x, it.y];
      // With leaders, a leader (to a far pill, or to every one with 'all') crossing a marker or another pill
      // counts against a spot, but never drops the pill.
      const all = [...avoid, ...placed], cost = all.reduce((s, b) => s + (hits(box, b) ? overlapArea(box, b) + 1 : 0), 0);
      const score = (cost > 0 ? 1e7 + cost : 0) + ((leaders === 'all' || (leaders && far)) && all.some((b) => !inside(at, b) && segHits(at, [cx, cy], b)) ? 1 : 0);
      if (!best || score < best.score) best = { cx, cy, box, cost, score, far };
      if (score === 0) break;
    }
    if (drop && (!best || best.cost > 0)) continue;
    if (!best) best = { cx: it.x, cy: it.y - it.h, box: [it.x - it.w / 2, it.y - it.h * 1.5, it.x + it.w / 2, it.y - it.h / 2], far: false };
    placed.push(best.box); out.push({ ...it, cx: best.cx, cy: best.cy, box: best.box, leader: best.far });
  }
  return out;
}
