// Figure layout helpers for Exploration Maps 3D: pure functions shared by the page (studio.js) and the
// hole tags (tags.js). Boxes are [x0, y0, x1, y1] in frame pixels.

export const hits = (a, b, pad = 0) => !(a[2] + pad < b[0] || a[0] - pad > b[2] || a[3] + pad < b[1] || a[1] - pad > b[3]);
export const overlapArea = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

// The figure's one layout pass. `boxes` is the list of everything already on the figure (fixed). place()
// takes candidate boxes for an item in order of preference (the nudges): the first clear of the boxes and,
// on a first pass, of the `soft` areas (the block's projected box); failing that, the first whose only
// blockers are deferred items of lower priority, which are then dropped. Deferred items (with draw) are
// drawn by flush(), in the order placed, so a dropped item is never drawn. Returns the box, or null (hidden).
export function makeLayout(W, H, pad = 0, boxes = []) {
  const meta = new Map(), inFrame = (b) => b[0] >= 0 && b[1] >= 0 && b[2] <= W && b[3] <= H;
  const blockers = (b) => boxes.filter((o) => hits(b, o, pad));
  const L = {
    boxes,
    clear: (b, soft = []) => inFrame(b) && !blockers(b).length && !soft.some((o) => hits(b, o, pad)),
    add(b, pri = Infinity, draw) { boxes.push(b); if (draw) meta.set(b, { pri, draw }); return b; },
    place(cands, pri = 1, draw, soft = []) {
      for (const s of [soft, []]) for (const b of cands) if (L.clear(b, s)) return L.add(b, pri, draw);
      for (const b of cands) {
        const bl = inFrame(b) ? blockers(b) : null;
        if (bl && bl.every((o) => meta.get(o)?.pri < pri)) { bl.forEach((o) => { boxes.splice(boxes.indexOf(o), 1); meta.delete(o); }); return L.add(b, pri, draw); }
      }
      return null;
    },
    flush() { const m = [...meta.entries()]; meta.clear(); m.forEach(([b, x]) => { if (boxes.includes(b)) x.draw(b); }); },
  };
  return L;
}

// Pill placement: each { x, y, w, h } (anchor and size) tries spots above, beside and further out, and
// takes the first clear of `avoid`, the frame edge and the pills already placed; failing that, the spot
// with the least overlap. Returns { cx, cy, box, leader } per item.
export function placePills(items, avoid, { W, H, unit = 1, pad = 4 }) {
  const placed = [], out = [];
  const spots = [[0, -1], [1, -0.7], [-1, -0.7], [0, -2], [1.3, -1.7], [-1.3, -1.7], [0, 1], [1.2, 0.6], [-1.2, 0.6], [0, -3], [1.6, -2.7], [-1.6, -2.7], [0, 2], [2, 0], [-2, 0], [0, -4], [2, -3.7], [-2, -3.7]];
  for (const it of items) {
    let best = null;
    for (const [sx, sy] of spots) {
      const cx = it.x + sx * (it.w / 2 + 8 * unit), cy = it.y + sy * (it.h + 6 * unit), box = [cx - it.w / 2 - pad, cy - it.h / 2 - pad, cx + it.w / 2 + pad, cy + it.h / 2 + pad];
      if (box[0] < 0 || box[1] < 0 || box[2] > W || box[3] > H) continue;
      const cost = [...avoid, ...placed].reduce((s, b) => s + (hits(box, b) ? overlapArea(box, b) + 1 : 0), 0);
      if (!best || cost < best.cost) best = { cx, cy, box, cost, far: Math.abs(sx) > 1.1 || Math.abs(sy) > 1.1 };
      if (cost === 0) break;
    }
    if (!best) best = { cx: it.x, cy: it.y - it.h, box: [it.x - it.w / 2, it.y - it.h * 1.5, it.x + it.w / 2, it.y - it.h / 2], far: false };
    placed.push(best.box); out.push({ ...it, cx: best.cx, cy: best.cy, box: best.box, leader: best.far });
  }
  return out;
}

// A press on the preview that moved under 4 px, or lasted under 150 ms, is a click: the camera stays put.
export const isClick = (dx, dy, ms) => Math.hypot(dx, dy) < 4 || ms < 150;

// Assay legend rows [label, colour, upper limit] from the colour limits and the display cut-off: highest
// first. Below the cut-off, intervals draw as the plain trace, so the row holding the cut-off starts at it
// and exactly one "<" row is left (the trace row, added by the caller, when there is a cut-off).
export function legendRows(bins, dc, colors) {
  const rows = [];
  for (let i = bins.length; i >= 0; i--) {
    const lo = i ? bins[i - 1] : -Infinity, hi = i < bins.length ? bins[i] : Infinity;
    if (dc !== null && dc !== undefined && hi <= dc) continue;
    const from = dc !== null && dc !== undefined && dc > lo ? dc : lo;
    rows.push([hi === Infinity ? `≥ ${from}` : from === -Infinity ? `< ${hi}` : `${from} – ${hi}`, colors[i], hi]);
  }
  return rows;
}

// Automatic footnotes as one line joined by " · ", wrapped at word breaks to maxLines; null when it needs
// more (the caller then sets them as a compact "Notes" block).
export function wrapNotes(notes, measure, maxW, maxLines = 2) {
  // A separator that falls at a line break is dropped.
  const words = notes.filter(Boolean).flatMap((n, i) => n.split(' ').filter(Boolean).map((w, k) => (i && !k ? `· ${w}` : w))), lines = [];
  if (!words.length) return [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && measure(t) > maxW) { lines.push(cur); cur = w.replace(/^· /, ''); } else cur = t;
  }
  lines.push(cur);
  return lines.length <= maxLines ? lines : null;
}

// One legend card instead of several: "auto" merges when three or more blocks have something to show
// (the holes block counts only beyond the plain collar row).
export function shouldMerge(sections, mode = 'auto') {
  if (mode === true || mode === false) return mode;
  return sections.filter((s) => s.rows.length > (s.key === 'holes' ? 1 : 0)).length >= 3;
}
