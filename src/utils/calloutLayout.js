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
  const paddingX = style.paddingX || 10;
  const paddingY = style.paddingY || 8;
  const width = callout.boxWidth
    ? Math.max(100, Math.min(callout.boxWidth, 400))
    : Math.max(120, Math.min(Math.max(title.length, subtext.length) * (fontSize * 0.58) + paddingX * 2 + 8, 280));
  const charsPerLine = Math.max(12, Math.floor((width - paddingX * 2) / Math.max(6, fontSize * 0.55)));
  const titleLines = Math.max(1, Math.ceil(title.length / charsPerLine));
  const subtextLines = subtext ? Math.max(1, Math.ceil(subtext.length / charsPerLine)) : 0;
  const titleHeight = titleLines * (fontSize + 3);
  const subtextHeight = subtextLines ? subtextLines * Math.max(11, fontSize - 1) + 6 : 0;
  const height = paddingY * 2 + titleHeight + subtextHeight;
  return { width, height };
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

export function resolveCalloutBoxes(callouts, map) {
  if (!map) return [];
  const size = map.getSize();
  const placed = [];
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

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

      if (callout.isManualPosition) {
        placed.push(candidate);
        return;
      }

      let attempts = 0;
      while (placed.some((other) => intersects(candidate, other)) && attempts < 40) {
        const dir = DIRECTIONS[Math.floor(attempts / 10) % 4];
        const step = box.height * 0.7;
        top += dir.dy * step;
        left += dir.dx * step;
        left = clamp(left, 6, Math.max(6, size.x - box.width - 6));
        top = clamp(top, 6, Math.max(6, size.y - box.height - 6));
        candidate = { ...candidate, top, left };
        attempts++;
      }

      placed.push(candidate);
    });

  return placed;
}
