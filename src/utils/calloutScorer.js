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
//
// Layout 3 (layoutAlgorithm >= 3) adds one rule for ID labels: a title-only
// card such as a hole ID. Layout 2 placed it like an intercept card — a 188 px
// box, up to 180 px out, at 1 cost per px against 1e5 for covering any collar —
// so in a dense drill plan it took the nearest empty ground, often beside
// another hole. Now it is sized to its text and tried in screen px around its
// own anchor: within ID_CAP px with no leader needed, and only when no other
// anchor is as near the label as its own; beyond the cap it must carry a
// leader (a plain label gets one: pushLeader) that runs clear of other
// anchors. A label that still reads as another hole's is reported.

// Costs, in order of how badly each reads on a printed map.
const COST = { card: 1e6, leaderCard: 1e5, cross: 1e4, distance: 1, movement: 0.5, ambiguous: 2e6, pushed: 200 };
// Candidate cards sit this far (px) from the anchor, in 16 directions
// starting up-right, where a new card's default offset (20, -18) puts it.
const GAPS = [20, 44, 76, 120, 180];
// Layout 3: a card that has nowhere near goes further out on its leader
// rather than over an ID label.
const FAR_GAPS = [...GAPS, 260, 360];
const DIRS = Array.from({ length: 16 }, (_, k) => {
  const a = (k * 22.5 - 45) * (Math.PI / 180);
  return [Math.round(Math.cos(a) * 1e6) / 1e6, Math.round(Math.sin(a) * 1e6) / 1e6];
});

// Layout 3 ID labels: edge gaps (px) near enough to read without a leader
// (up to ID_CAP), then pushed out on a leader. ID_CLEAR keeps the label off
// its own collar symbol (12 px by default).
const ID_CAP = 20, ID_CLEAR = 8;
const ID_GAPS = [8, 11, 14, 17, 20, 32, 48, 68, 92];
// An ID label: a title-only callout on one feature (a collar clicked, or a
// published result's hole) — not a layer or neighbour-holder label.
export const isIdLabel = (c) => !!c.featureId && c.type !== 'badge' && !c.subtext && !c.logo?.image && /^[^\n]{1,24}$/.test(c.text || '');
// An ID label's text width in px, measured in the callout font at the
// editor's title weight (800; the exporters draw 700, never wider), so its
// box always holds it: one word never wraps, and the exporters do not split
// it. Without a canvas (tests, workers), a per-glyph estimate that errs wide.
let measurer;
export function idTextWidth(text, fontSize, font) {
  try { measurer = measurer || document.createElement('canvas').getContext('2d'); } catch { measurer = null; }
  if (measurer?.measureText) {
    measurer.font = `800 ${fontSize}px ${font || 'Inter'}, Arial, sans-serif`;
    const w = measurer.measureText(text).width;
    if (w > 0) return w;
  }
  return [...text].reduce((w, ch) => w + fontSize * (/[WM@%]/.test(ch) ? 1.02 : /[A-Z#&]/.test(ch) ? 0.8 : /[-.,:;' ]/.test(ch) ? 0.45 : 0.66), 0);
}
// Px from point p to the nearest edge of box r (0 inside).
export const boxDistance = (r, p) => Math.hypot(Math.max(r.left - p.x, 0, p.x - r.left - r.width), Math.max(r.top - p.y, 0, p.y - r.top - r.height));
// Px from p to segment a→b.
function segDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

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
export const leaderOf = (c) => (hasLeader(c) || c.pushLeader
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
// `theirs` false leaves out other cards' leaders running through `c`.
function clash(c, lead, others, anchors, obstacles, budget = Infinity, theirs = true) {
  let s = 0;
  for (const o of obstacles) if (intersects(c, o, 4)) s += COST.card + overlapArea(c, o);
  for (const p of others) if (intersects(c, p)) s += COST.card + overlapArea(c, p);
  // Every anchor, placed or not: a card must not hide the point it labels or
  // any other callout's point.
  for (const a of anchors) if (a === c.anchorPx ? lead && covers(c, a, 2) : covers(c, a)) s += COST.leaderCard;
  for (const p of others) {
    if (s >= budget) return s;
    if (lead && lineHitsRect(lead, inset(p))) s += COST.leaderCard;
    if (theirs && p.lead && lineHitsRect(p.lead, inset(c))) s += COST.leaderCard;
    if (lead && p.lead) s += COST.cross * crossings(lead, p.lead);
  }
  return s;
}

// Layout 3: the other anchor an ID label could be read as labelling, if any:
// one within 6 px of being as near the label as its own anchor, or, for a
// label out on a leader, one its leader passes within 5 px of.
function misread(c, anchors) {
  const own = c.anchorPx, d = boxDistance(c, own);
  return anchors.find((a) => Math.hypot(a.x - own.x, a.y - own.y) > 1 && (boxDistance(c, a) < d + 6
    || (d > ID_CAP && c.lead && c.lead.some((pt, k) => k > 0 && segDistance(a, c.lead[k - 1], pt) < 5))));
}

// `fresh` (Auto-arrange) ignores where automatic cards were. Otherwise a
// card's saved offset is its approved position: a card whose approved
// position collides with nothing stays exactly there, and one that now
// collides is re-placed, costed for every pixel it moves away. So a layout the
// user approved stays put until something lands on it.
function place(callouts, map, { obstacles = [], fresh = false, algorithm = 2, font } = {}) {
  if (!map) return [];
  const size = map.getSize();
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const rank = (a, b) => (a.callout.priority || 2) - (b.callout.priority || 2) || a.index - b.index;
  const items = callouts.map((callout, index) => ({ callout, index })).filter((i) => i.callout.anchor);
  const anchors = [];
  const cardAt = (i, left, top) => {
    const c = { ...i.base, left: clamp(left, 6, Math.max(6, size.x - i.base.width - 6)), top: clamp(top, 6, Math.max(6, size.y - i.base.height - 6)) };
    if (i.id && !hasLeader(c) && boxDistance(c, c.anchorPx) > ID_CAP) c.pushLeader = true;
    c.lead = leaderOf(c);
    return c;
  };
  // Layout 3's extra cost for an ID label read as another anchor's.
  const idCost = (i, c) => (!i.id ? 0 : misread(c, anchors) ? COST.ambiguous : boxDistance(c, c.anchorPx) < ID_CLEAR ? COST.leaderCard : 0);
  for (const i of items) {
    const pt = map.latLngToContainerPoint([i.callout.anchor.lat, i.callout.anchor.lng]);
    anchors.push(pt);
    i.id = algorithm >= 3 && isIdLabel(i.callout);
    // An ID label is a tag, not a card: tight padding, and as wide as its
    // measured text plus padding (and a 1 px border each side, with a px to
    // spare) rather than estimateBox's 100 px floor or the 188 px a callout
    // starts with.
    const st = i.callout.style || {}, fs = st.fontSize || 12;
    const c0 = i.id ? { ...i.callout, style: { ...st, paddingX: Math.min(st.paddingX ?? 10, 5), paddingY: Math.min(st.paddingY ?? 8, 3) }, fit: true } : i.callout;
    const box = estimateBox(c0);
    if (i.id) box.width = Math.ceil(idTextWidth(c0.text, fs, font) + c0.style.paddingX * 2 + 4);
    i.base = { ...c0, width: box.width, height: box.height, anchorPx: pt };
    i.card = cardAt(i, pt.x + (i.callout.offset?.x || 0), pt.y + (i.callout.offset?.y || 0));
  }

  // The cheapest candidate for item `i` among `others`.
  // Layout 3: placed ID labels are hard obstacles for automatic cards, so an
  // ID label is placed (and re-placed) seeing only ID labels and pinned cards
  // — a card never takes its spot; the card moves.
  const seen = (i, others) => (i.id ? others.filter((c) => c.fit || c.isManualPosition) : others);
  const choose = (i, all, approved) => {
    const others = seen(i, all);
    const { anchorPx: pt, width, height } = i.base;
    const hw = width / 2, hh = height / 2;
    const cands = approved ? [approved] : [];
    for (const gap of i.id ? ID_GAPS : algorithm >= 3 ? FAR_GAPS : GAPS) {
      for (const [ux, uy] of DIRS) {
        // Centre the card along the direction so its edge is `gap` away.
        const t = gap + Math.min(ux ? hw / Math.abs(ux) : Infinity, uy ? hh / Math.abs(uy) : Infinity);
        cands.push(cardAt(i, pt.x + ux * t - hw, pt.y + uy * t - hh));
      }
    }
    let best = Infinity, card = cands[0];
    for (const c of cands) {
      const end = c.lead ? c.lead[c.lead.length - 1] : { x: c.left + hw, y: c.top + hh };
      // An ID label is costed by its gap to its own anchor, and pays to leave
      // the cap: any clean spot within reach without a leader comes first.
      const s0 = (i.id ? COST.distance * 3 * boxDistance(c, pt) + (boxDistance(c, pt) > ID_CAP ? COST.pushed : 0) : COST.distance * Math.hypot(end.x - pt.x, end.y - pt.y))
        + (approved ? COST.movement * Math.hypot(c.left - approved.left, c.top - approved.top) : 0);
      if (s0 >= best) continue;
      const s = s0 + idCost(i, c) + clash(c, c.lead, others, anchors, obstacles, best - s0);
      if (s < best) { best = s; card = c; }
    }
    return card;
  };
  // Free: nothing worse than a few leader crossings (they cost, but do not
  // unsettle a card).
  // Layout 3: an ID label is not unsettled by another card's leader crossing
  // it — that card is the one to move.
  const free = (i, placed) => idCost(i, i.card) + clash(i.card, i.card.lead, seen(i, placed.filter((c) => c !== i.card)), anchors, obstacles, Infinity, !i.id) < COST.leaderCard;

  // Pinned (dragged) cards first: they never move, and every automatic card
  // must see them, whatever its priority.
  const pinned = items.filter((i) => i.callout.isManualPosition);
  const start = new Map(items.map((i) => [i, i.card]));
  const settle = (auto) => {
    for (const i of items) i.card = start.get(i);
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
    return { auto, placed, cards: auto.map((i) => i.card), bad: auto.reduce((n, i) => n + (free(i, placed) ? 0 : i.id ? 100 : 1), 0) };
  };
  // Layout 3 seats ID labels first: they need the few spots beside their
  // anchor, and the cards after them can reach on a leader. Auto-arrange also
  // tries the most crowded first, and keeps that if it leaves fewer ID labels
  // (then cards) in conflict.
  const byIndex = items.filter((i) => !i.callout.isManualPosition).sort((a, b) => (b.id - a.id) || rank(a, b));
  let best = settle(byIndex);
  if (fresh && byIndex.some((i) => i.id)) {
    const crowd = new Map(byIndex.map((i) => [i, i.id ? anchors.filter((a) => Math.hypot(a.x - i.base.anchorPx.x, a.y - i.base.anchorPx.y) < 60).length : 0]));
    const alt = settle([...byIndex].sort((a, b) => (b.id - a.id) || crowd.get(b) - crowd.get(a) || rank(a, b)));
    if (alt.bad < best.bad) best = alt;
    best.auto.forEach((i, k) => { i.card = best.cards[k]; });
  }
  const { auto, placed } = best;

  // Anything still in conflict is reported, never dropped: a card overlapping
  // one placed before it or a panel, and a leader running through any card.
  const order = [...pinned, ...auto];
  return order.map((i, n) => {
    const p = i.card;
    const collidesWith = [
      ...order.slice(0, n).map((o) => o.card).filter((o) => intersects(p, o, -1)).map((o) => `callout "${o.text || o.id}"`),
      ...obstacles.filter((o) => intersects(p, o, -1)).map((o) => o.key),
      ...(p.lead ? placed.filter((o) => o !== p && lineHitsRect(p.lead, inset(o))).map((o) => `leader crosses "${o.text || o.id}"`) : []),
      ...(i.id && misread(p, anchors) ? ['too near another point'] : []),
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
// Pinned cards, anchors and ids are untouched. It arranges for the latest
// layout (3), which the editor then saves as the project's layoutAlgorithm.
export function autoArrangeCallouts(callouts, map, { obstacles = [], algorithm = 3, font } = {}) {
  const byIndex = new Map(place(callouts, map, { obstacles, fresh: true, algorithm, font }).map((p) => [p.index, p.card]));
  return callouts.map((c, i) => {
    const p = byIndex.get(i);
    return !p || c.isManualPosition ? c : { ...c, offset: { x: p.left - p.anchorPx.x, y: p.top - p.anchorPx.y } };
  });
}
