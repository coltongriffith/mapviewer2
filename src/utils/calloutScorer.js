import { estimateBox, intersects } from './calloutLayout';
import { leaderGeometry } from '../../shared/leaderGeometry.js';

// The scored callout layout (project.layout.layoutAlgorithm >= 2). Lazily
// loaded: a project without the field keeps resolveCalloutBoxes' legacy
// stepping, exactly as before, until the user runs Auto-arrange.
//
// An automatic card that needs placing tries a fixed set of positions around
// its anchor and takes the cheapest: card overlaps, then leaders through cards
// (or cards over anchors), then leader crossings, then leader length and
// movement from its approved position. Pinned (dragged) cards never move and
// every automatic card sees them, whatever its priority. The result depends
// only on the callouts, the map view and the panels, so the editor, the shared
// view and every exporter that call it get the same layout.

// Costs, in order of how badly each reads on a printed map.
const COST = { card: 1e6, leaderCard: 1e5, cross: 1e4, distance: 1, movement: 0.5 };
// Candidate cards sit this far (px) from the anchor, in 16 directions
// starting up-right, where a new card's default offset (20, -18) puts it.
const GAPS = [20, 44, 76, 120, 180];
const DIRS = Array.from({ length: 16 }, (_, k) => {
  const a = (k * 22.5 - 45) * (Math.PI / 180);
  return [Math.round(Math.cos(a) * 1e6) / 1e6, Math.round(Math.sin(a) * 1e6) / 1e6];
});

// A leader as line segments (a curve sampled), for the collision tests.
function leaderPolyline(g, steps = 8) {
  if (!g.bend) return [g.start, g.end];
  if (!g.curve) return [g.start, g.bend, g.end];
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps, u = 1 - t;
    pts.push({
      x: u * u * g.start.x + 2 * u * t * g.bend.x + t * t * g.end.x,
      y: u * u * g.start.y + 2 * u * t * g.bend.y + t * t * g.end.y,
    });
  }
  return pts;
}

const hasLeader = (c) => c.type === 'leader' || c.type === 'boxed' || c.type === 'badge';
export const leaderOf = (c) => (hasLeader(c)
  ? leaderPolyline(leaderGeometry(c.anchorPx, c, c.type === 'badge' ? 'straight' : c.style?.leaderShape))
  : null);

const inset = (r, d = 1) => ({ left: r.left + d, top: r.top + d, width: r.width - d * 2, height: r.height - d * 2 });
const covers = (r, p, pad = 4) => p.x > r.left - pad && p.x < r.left + r.width + pad && p.y > r.top - pad && p.y < r.top + r.height + pad;
const overlapArea = (a, b) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

// Liang–Barsky: does segment a→b pass through rectangle r?
function segmentHitsRect(a, b, r) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.left, r.left + r.width - a.x, a.y - r.top, r.top + r.height - a.y];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}
export const lineHitsRect = (pts, r) => pts.some((pt, i) => i > 0 && segmentHitsRect(pts[i - 1], pt, r));

const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
// Proper crossings only: two leaders that merely share an anchor do not cross.
export function crossings(p, q) {
  let n = 0;
  for (let i = 1; i < p.length; i += 1) {
    for (let j = 1; j < q.length; j += 1) {
      const d1 = orient(q[j - 1], q[j], p[i - 1]), d2 = orient(q[j - 1], q[j], p[i]);
      const d3 = orient(p[i - 1], p[i], q[j - 1]), d4 = orient(p[i - 1], p[i], q[j]);
      if (d1 * d2 < 0 && d3 * d4 < 0) n += 1;
    }
  }
  return n;
}

// What card `c` (leader `lead`) collides with among `others`, as a cost. It
// stops counting once past `budget`; the cheap, decisive terms come first.
function clash(c, lead, others, anchors, obstacles, budget = Infinity) {
  let s = 0;
  for (const o of obstacles) if (intersects(c, o, 4)) s += COST.card + overlapArea(c, o);
  for (const p of others) if (intersects(c, p)) s += COST.card + overlapArea(c, p);
  // Every anchor, placed or not: a card must not hide the point it labels or
  // any other callout's point.
  for (const a of anchors) if (a === c.anchorPx ? lead && covers(c, a, 2) : covers(c, a)) s += COST.leaderCard;
  for (const p of others) {
    if (s >= budget) return s;
    if (lead && lineHitsRect(lead, inset(p))) s += COST.leaderCard;
    if (p.lead && lineHitsRect(p.lead, inset(c))) s += COST.leaderCard;
    if (lead && p.lead) s += COST.cross * crossings(lead, p.lead);
  }
  return s;
}

// `fresh` (Auto-arrange) ignores where automatic cards were. Otherwise a
// card's saved offset is its approved position: a card whose approved
// position collides with nothing stays exactly there, and one that now
// collides is re-placed, costed for every pixel it moves away. So a layout the
// user approved stays put until something lands on it.
function place(callouts, map, { obstacles = [], fresh = false } = {}) {
  if (!map) return [];
  const size = map.getSize();
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const rank = (a, b) => (a.callout.priority || 2) - (b.callout.priority || 2) || a.index - b.index;
  const items = callouts.map((callout, index) => ({ callout, index })).filter((i) => i.callout.anchor);
  const anchors = [];
  const cardAt = (i, left, top) => {
    const c = { ...i.base, left: clamp(left, 6, Math.max(6, size.x - i.base.width - 6)), top: clamp(top, 6, Math.max(6, size.y - i.base.height - 6)) };
    c.lead = leaderOf(c);
    return c;
  };
  for (const i of items) {
    const pt = map.latLngToContainerPoint([i.callout.anchor.lat, i.callout.anchor.lng]);
    const box = estimateBox(i.callout);
    anchors.push(pt);
    i.base = { ...i.callout, width: box.width, height: box.height, anchorPx: pt };
    i.card = cardAt(i, pt.x + (i.callout.offset?.x || 0), pt.y + (i.callout.offset?.y || 0));
  }

  // The cheapest candidate for item `i` among `others`.
  const choose = (i, others, approved) => {
    const { anchorPx: pt, width, height } = i.base;
    const hw = width / 2, hh = height / 2;
    const cands = approved ? [approved] : [];
    for (const gap of GAPS) {
      for (const [ux, uy] of DIRS) {
        // Centre the card along the direction so its edge is `gap` away.
        const t = gap + Math.min(ux ? hw / Math.abs(ux) : Infinity, uy ? hh / Math.abs(uy) : Infinity);
        cands.push(cardAt(i, pt.x + ux * t - hw, pt.y + uy * t - hh));
      }
    }
    let best = Infinity, card = cands[0];
    for (const c of cands) {
      const end = c.lead ? c.lead[c.lead.length - 1] : { x: c.left + hw, y: c.top + hh };
      const s0 = COST.distance * Math.hypot(end.x - pt.x, end.y - pt.y)
        + (approved ? COST.movement * Math.hypot(c.left - approved.left, c.top - approved.top) : 0);
      if (s0 >= best) continue;
      const s = s0 + clash(c, c.lead, others, anchors, obstacles, best - s0);
      if (s < best) { best = s; card = c; }
    }
    return card;
  };
  // Free: nothing worse than a few leader crossings (they cost, but do not
  // unsettle a card).
  const free = (i, placed) => clash(i.card, i.card.lead, placed.filter((c) => c !== i.card), anchors, obstacles) < COST.leaderCard;

  // Pinned (dragged) cards first: they never move, and every automatic card
  // must see them, whatever its priority.
  const pinned = items.filter((i) => i.callout.isManualPosition);
  const auto = items.filter((i) => !i.callout.isManualPosition).sort(rank);
  const placed = [...pinned, ...auto].map((i) => i.card);
  const replace = (i, next) => { placed[placed.indexOf(i.card)] = next; i.card = next; };
  if (fresh) {
    // Greedy, in priority order, against the cards placed so far…
    placed.length = pinned.length;
    for (const i of auto) { i.card = choose(i, placed, null); placed.push(i.card); }
  }
  // …then any card that still collides is re-placed against the whole layout
  // (for a saved layout, this is the only step: free cards stay put).
  for (let pass = 0; pass < (fresh ? 2 : 1); pass += 1) {
    for (const i of auto) {
      if (!free(i, placed)) replace(i, choose(i, placed.filter((c) => c !== i.card), fresh ? null : i.card));
    }
  }

  // Anything still in conflict is reported, never dropped: a card overlapping
  // one placed before it or a panel, and a leader running through any card.
  const order = [...pinned, ...auto];
  return order.map((i, n) => {
    const p = i.card;
    const collidesWith = [
      ...order.slice(0, n).map((o) => o.card).filter((o) => intersects(p, o, -1)).map((o) => `callout "${o.text || o.id}"`),
      ...obstacles.filter((o) => intersects(p, o, -1)).map((o) => o.key),
      ...(p.lead ? placed.filter((o) => o !== p && lineHitsRect(p.lead, inset(o))).map((o) => `leader crosses "${o.text || o.id}"`) : []),
    ];
    const card = { ...p, ...(collidesWith.length ? { collidesWith } : {}) };
    delete card.lead;
    return { index: i.index, card };
  }).sort((a, b) => rank({ callout: a.card, index: a.index }, { callout: b.card, index: b.index }));
}

// Same contract as resolveCalloutBoxes: cards in drawing (priority) order.
export function resolveScoredBoxes(callouts, map, options) {
  return place(callouts, map, options).map((p) => p.card);
}

// Auto-arrange: a fresh scored layout saved as each automatic card's offset.
// Pinned cards, anchors and ids are untouched.
export function autoArrangeCallouts(callouts, map, { obstacles = [] } = {}) {
  const byIndex = new Map(place(callouts, map, { obstacles, fresh: true }).map((p) => [p.index, p.card]));
  return callouts.map((c, i) => {
    const p = byIndex.get(i);
    return !p || c.isManualPosition ? c : { ...c, offset: { x: p.left - p.anchorPx.x, y: p.top - p.anchorPx.y } };
  });
}
