// The editor stage has a fixed logical size for the chosen export shape and is
// CSS-scaled to fit the window (App.jsx constrainedStageSize). Layout, panels,
// the map and exports all work in logical pixels; only pointer input and
// getBoundingClientRect are in screen pixels. These convert between the two.

// Logical stage size for an aspect ratio: about one megapixel, so a square map
// is 1000×1000 and 16:9 is 1333×750, whatever the window size.
export const STAGE_AREA = 1_000_000;
export function logicalStageSize(ratio) {
  const width = Math.round(Math.sqrt(STAGE_AREA * ratio));
  return { width, height: Math.round(width / ratio) };
}

// Screen px per logical px for an element inside (or equal to) the scaled
// stage. 1 when nothing is scaled.
export function screenScale(el) {
  if (!el?.getBoundingClientRect || !el.offsetWidth) return 1;
  const s = el.getBoundingClientRect().width / el.offsetWidth;
  return Number.isFinite(s) && s > 0 ? s : 1;
}
