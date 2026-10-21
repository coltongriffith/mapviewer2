// One leader-line geometry for every renderer: the editor overlay, the shared
// view, the PNG/PDF canvas and the SVG export all draw the path this returns,
// so they cannot drift. Pure maths on screen points; callers pass points in
// whatever pixel space they draw in (the geometry scales linearly).
//
// The path always starts exactly at the anchor. A bend or curve changes only
// the annotation path, never the geographic point it labels.

// Where a leader meets its card: the middle of the side facing the anchor.
export function leaderEndpoint(anchorPx, box) {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const dx = anchorPx.x - cx;
  const dy = anchorPx.y - cy;
  if (Math.abs(dx) / box.width > Math.abs(dy) / box.height) {
    return dx > 0
      ? { x: box.left + box.width, y: cy }
      : { x: box.left, y: cy };
  }
  return dy > 0
    ? { x: cx, y: box.top + box.height }
    : { x: cx, y: box.top };
}

// shape: 'straight' (default, today's line), 'elbow' (a 45° leg from the
// anchor, then a level shelf into the card) or 'curve' (the same route,
// smoothed into one quadratic). Returns { start, bend, end, curve }: a
// straight leader has no bend. `scale` is the renderer's export scale, so a
// 3x export is the 1x path times three.
export function leaderGeometry(anchorPx, box, shape = 'straight', scale = 1) {
  const start = { x: anchorPx.x, y: anchorPx.y };
  const end = leaderEndpoint(start, box);
  if (shape !== 'elbow' && shape !== 'curve') return { start, bend: null, end, curve: false };
  const dx = end.x - start.x, dy = end.y - start.y;
  const side = end.y === box.top + box.height / 2;
  // The shelf is the leg that enters the card square to its edge; the rest of
  // the run is taken by the 45° leg, with a short shelf kept when it is steep.
  const along = side ? dx : dy, across = side ? dy : dx;
  const shelf = Math.sign(along) * Math.max(Math.abs(along) - Math.abs(across), Math.min(Math.abs(along), 12 * scale));
  const bend = side ? { x: end.x - shelf, y: end.y } : { x: end.x, y: end.y - shelf };
  return { start, bend, end, curve: shape === 'curve' };
}

// The point the leader leaves the anchor towards, which orients an arrowhead.
export const leaderTangentFrom = (g) => g.bend || g.end;

// The path as SVG `d`; the canvas exporter traces the same three points.
export function leaderSvgD(g) {
  const p = (pt) => `${pt.x} ${pt.y}`;
  if (!g.bend) return `M${p(g.start)} L${p(g.end)}`;
  return g.curve ? `M${p(g.start)} Q${p(g.bend)} ${p(g.end)}` : `M${p(g.start)} L${p(g.bend)} L${p(g.end)}`;
}

// The optional mark on the anchor: 'dot' (filled) or 'ring' (outlined), in
// the leader colour. Radius in px at 1x; renderers multiply by their scale.
export function anchorMark(style) {
  const m = style?.anchorMark;
  return m === 'dot' || m === 'ring' ? { r: m === 'dot' ? 3 : 3.5, filled: m === 'dot' } : null;
}
