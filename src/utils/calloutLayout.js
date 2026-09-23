export function estimateBox(callout) {
  if (callout.type === 'badge') {
    const chipChars = (callout.badgeValue || '').length;
    const chipW = Math.max(44, chipChars * 8 + 20);
    const labelW = Math.max(80, callout.boxWidth ? Math.min(callout.boxWidth, 260) : 160);
    return { width: chipW + labelW, height: 32 };
  }
  const title = callout.text || '';
  const subtext = callout.subtext || '';
  const style = callout.style || {};
  const fontSize = style.fontSize || 12;
  const paddingY = style.paddingY || 8;
  const width = callout.boxWidth
    ? Math.max(100, Math.min(callout.boxWidth, 400))
    : Math.max(120, Math.min(Math.max(title.length, subtext.length) * (fontSize * 0.58) + (style.paddingX || 10) * 2 + 8, 280));
  const paddingX = style.paddingX ?? Math.max(4, Math.min(10, width * 0.06));
  const charsPerLine = Math.max(12, Math.floor((width - paddingX * 2) / Math.max(6, fontSize * 0.55)));
  // A hard line break is a line, whatever its length: intercept lists are
  // written one result per line and must be sized as such.
  const countLines = (text) => text.split('\n').reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / charsPerLine)), 0);
  const titleLines = Math.max(1, countLines(title));
  const subtextLines = subtext ? countLines(subtext) : 0;
  const titleHeight = titleLines * (fontSize + 3);
  const subtextHeight = subtextLines ? subtextLines * Math.max(11, fontSize - 1) + 6 : 0;
  const logo = calloutLogoSize(callout, width - paddingX * 2);
  const height = paddingY * 2 + (logo ? logo.h + logo.gap : 0) + titleHeight + subtextHeight;
  return { width, height };
}

/**
 * An optional logo at the top of a callout card (callout.logo, set per callout;
 * none by default). `logo.width` is its width in CSS px at 1x, never wider than
 * the card's text area; height follows the image's aspect. Shared by the
 * editor card, the box estimate and every exporter.
 */
export function calloutLogoSize(callout, innerWidth) {
  const logo = callout?.logo;
  if (!logo?.image || callout.type === 'badge') return null;
  const w = Math.max(10, Math.min(Number(logo.width) || 70, innerWidth));
  return { w, h: w * (Number(logo.aspect) || 1), gap: 6 };
}

/**
 * The triangle at the anchor end of a leader, pointing at the anchor. Three
 * screen points; every renderer fills the same shape.
 */
export function arrowheadPoints(from, to, size = 8) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const bx = to.x - ux * size, by = to.y - uy * size;
  const w = size * 0.5;
  return [
    { x: to.x, y: to.y },
    { x: bx - uy * w, y: by + ux * w },
    { x: bx + uy * w, y: by - ux * w },
  ];
}

export function intersects(a, b, padding = 10) {
  return !(
    a.left + a.width + padding < b.left ||
    b.left + b.width + padding < a.left ||
    a.top + a.height + padding < b.top ||
    b.top + b.height + padding < a.top
  );
}

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

const DIRECTIONS = [
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
];

// The map panels a callout card must not sit on, from the resolved template
// zones. Shared by the editor overlay and the exporters so both place cards
// against the same obstacles.
export function panelObstacles(zones, layout = {}) {
  if (!zones) return [];
  const out = [];
  const add = (z, key) => {
    if (z && z.width > 0 && z.height > 0 && Number.isFinite(z.left) && Number.isFinite(z.top)) {
      out.push({ key, left: z.left, top: z.top, width: z.width, height: z.height });
    }
  };
  if (layout.showTitle !== false) add(zones.title, 'title');
  if (layout.showLegend !== false && (layout.legendItems || []).length) add(zones.legend, 'legend');
  if (layout.showNorthArrow !== false) add(zones.northArrow, 'north arrow');
  if (layout.showScaleBar !== false) add(zones.scaleBar, 'scale bar');
  add(zones.inset, 'inset');
  if (layout.logo) add(zones.logo, 'logo');
  return out;
}

/**
 * Card positions for every callout, in map-container pixels. Automatic cards
 * step away from earlier cards and from `obstacles` (panels); a card the user
 * dragged (isManualPosition) never moves. Any card still overlapping another
 * card or a panel carries `collidesWith` so the editor and the exporters can
 * warn instead of silently printing a card over the legend.
 */
export function resolveCalloutBoxes(callouts, map, { obstacles = [] } = {}) {
  if (!map) return [];
  const size = map.getSize();
  const placed = [];
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const hits = (c) => placed.some((other) => intersects(c, other)) || obstacles.some((o) => intersects(c, o, 4));

  callouts
    .slice()
    .sort((a, b) => (a.priority || 2) - (b.priority || 2))
    .forEach((callout) => {
      const anchor = callout.anchor;
      if (!anchor) return;
      const pt = map.latLngToContainerPoint([anchor.lat, anchor.lng]);
      const box = estimateBox(callout);
      let left = clamp(pt.x + (callout.offset?.x || 0), 6, Math.max(6, size.x - box.width - 6));
      let top = clamp(pt.y + (callout.offset?.y || 0), 6, Math.max(6, size.y - box.height - 6));
      let candidate = { ...callout, width: box.width, height: box.height, left, top, anchorPx: pt };

      if (!callout.isManualPosition) {
        const start = candidate;
        let attempts = 0;
        while (hits(candidate) && attempts < 40) {
          const dir = DIRECTIONS[Math.floor(attempts / 10) % 4];
          const step = box.height * 0.7;
          top += dir.dy * step;
          left += dir.dx * step;
          left = clamp(left, 6, Math.max(6, size.x - box.width - 6));
          top = clamp(top, 6, Math.max(6, size.y - box.height - 6));
          candidate = { ...candidate, top, left };
          attempts++;
        }
        // No free spot found: keep the original position rather than a
        // random point 40 steps away from its anchor.
        if (hits(candidate)) candidate = start;
      }

      const collidesWith = [
        ...placed.filter((other) => intersects(candidate, other, -1)).map((o) => `callout "${o.text || o.id}"`),
        ...obstacles.filter((o) => intersects(candidate, o, -1)).map((o) => o.key),
      ];
      placed.push(collidesWith.length ? { ...candidate, collidesWith } : candidate);
    });

  return placed;
}
