/**
 * Corner-anchor layout system.
 * Items are anchored to one of four corners (tl/tr/bl/br) and stack within
 * that corner in stackIndex order.  TL/TR stack downward; BL/BR stack upward.
 *
 * Each item: { id, anchorCorner, stackIndex, width, height, enabled }
 * Returns: { [id]: { top, left, width, height } }
 */

const GAP = 10;

export function resolveAnchoredLayout(items, mapSize, safeMargins) {
  const W = mapSize?.width || 1600;
  const H = mapSize?.height || 1000;
  const s = { top: 22, right: 22, bottom: 22, left: 22, ...(safeMargins || {}) };

  // Bucket enabled items by corner, sorted by stackIndex
  const corners = { tl: [], tr: [], bl: [], br: [] };
  for (const item of items) {
    if (item.enabled === false) continue;
    const c = item.anchorCorner || 'tl';
    if (corners[c]) corners[c].push(item);
  }
  for (const c of Object.keys(corners)) {
    corners[c].sort((a, b) => (a.stackIndex ?? 0) - (b.stackIndex ?? 0));
  }

  const zones = {};

  // TL — stack downward
  let tlY = s.top;
  for (const item of corners.tl) {
    zones[item.id] = { top: tlY, left: s.left, width: item.width, height: item.height };
    tlY += item.height + GAP;
  }

  // TR — stack downward
  let trY = s.top;
  for (const item of corners.tr) {
    zones[item.id] = { top: trY, left: W - s.right - item.width, width: item.width, height: item.height };
    trY += item.height + GAP;
  }

  // BL — stack upward (stackIndex 0 = bottom-most)
  let blY = H - s.bottom;
  for (const item of corners.bl) {
    blY -= item.height;
    zones[item.id] = { top: blY, left: s.left, width: item.width, height: item.height };
    blY -= GAP;
  }

  // BR — stack upward
  let brY = H - s.bottom;
  for (const item of corners.br) {
    brY -= item.height;
    zones[item.id] = { top: brY, left: W - s.right - item.width, width: item.width, height: item.height };
    brY -= GAP;
  }

  return zones;
}

export const DEFAULT_LAYOUT_ITEMS = [
  { id: 'title',      anchorCorner: 'tl', stackIndex: 0, width: 480, height: 90,  enabled: true },
  { id: 'logo',       anchorCorner: 'tl', stackIndex: 1, width: 168, height: 74,  enabled: true },
  { id: 'inset',      anchorCorner: 'tr', stackIndex: 0, width: 244, height: 190, enabled: true },
  { id: 'legend',     anchorCorner: 'bl', stackIndex: 1, width: 300, height: 168, enabled: true },
  { id: 'scaleBar',   anchorCorner: 'bl', stackIndex: 0, width: 230, height: 64,  enabled: true },
  { id: 'northArrow', anchorCorner: 'br', stackIndex: 0, width: 74,  height: 100, enabled: true },
  { id: 'footer',     anchorCorner: 'br', stackIndex: 1, width: 400, height: 40,  enabled: true },
];

export const CORNER_LABELS = { tl: 'Top Left', tr: 'Top Right', bl: 'Bottom Left', br: 'Bottom Right' };
export const ITEM_LABELS = {
  title: 'Title', logo: 'Logo', inset: 'Inset', legend: 'Legend',
  scaleBar: 'Scale Bar', northArrow: 'North Arrow', footer: 'Footer',
};
