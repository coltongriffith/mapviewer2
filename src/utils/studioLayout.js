// The 2D Studio style's card sizes, read by the layout (templates/technicalResultsTemplate.js) and by the cards'
// drawing (utils/studioCards.js), so a zone always holds what is drawn in it. Kept small: it loads with the
// editor, while the drawing is in the export renderer and the lazy editor parts.

// Studio is opt-in (themeId 'studio') and drawn on the standard template; the technical templates keep their
// own panels and take only Studio's colours.
export const studioOn = (layout) => layout?.themeId === 'studio' && (layout.templateId || 'technical_results_v2') === 'technical_results_v2';

// The figure style's panel padding (shared/figureStyle.js, recorded when a brand kit is applied), else 14 px.
export const studioPad = (layout) => Math.max(8, Math.min(24, layout?.brandStyle?.style?.panel?.padding ?? 14));

// The caps line over the title: its own text, else the company name.
export const studioKicker = (layout) => String(layout?.studio?.kicker ?? layout?.companyName ?? '').trim().toUpperCase();
export const studioInfo = (layout) => [layout?.mapDate, layout?.projectNumber, layout?.mapScaleNote].filter(Boolean).join('  ·  ');

// Where the scale bar and north arrow go: 'title' (in the title card, under a rule), 'panel' (one card, the
// bar left of the arrow) or 'apart' (each its own card).
export function studioScaleHome(layout) {
  const s = layout?.studio || {}, scale = layout?.showScaleBar !== false, north = layout?.showNorthArrow !== false;
  if (!scale && !north) return null;
  if (s.titleScale && layout?.showTitle !== false) return 'title';
  return s.scaleNorth !== false && scale && north ? 'panel' : 'apart';
}

export const STUDIO_SCALE_ROW = 46;
export const STUDIO_PANEL = { w: 256, h: 70 };

// The title card's rows, each with its type size and top (px from the card's top): the caps kicker, the
// title (26 px, twice the body), the subtitle and the muted info line, then the scale row under a rule.
export function studioTitleRows(layout = {}) {
  const k = layout.titleFontScale ?? 1, top = layout.studio?.cards?.title?.accent === 'top' ? 4 : 0;
  const rows = [];
  let y = studioPad(layout) + top;
  const add = (kind, size, gap, advance) => { y += gap; rows.push({ kind, size, top: y }); y += advance; };
  if (studioKicker(layout)) add('kicker', 11 * k, 0, 11 * k + 8);
  add('title', 26 * k, 0, 26 * k * 1.12);
  if (layout.subtitle) add('subtitle', 14 * k, 4, 14 * k * 1.25);
  if (studioInfo(layout)) add('info', 11 * k, 4, 11 * k * 1.25);
  if (studioScaleHome(layout) === 'title') { add('rule', 0, 10, 0); add('scale', 0, 10, STUDIO_SCALE_ROW); }
  return { rows, height: Math.ceil(y + studioPad(layout)) };
}

// Zone sizes Studio sets, by element: [width, height], or nothing to keep the template's.
export function studioZoneSizes(layout, titleWidth) {
  if (!studioOn(layout)) return null;
  const home = studioScaleHome(layout), out = {};
  out.title = [titleWidth, Math.max(studioTitleRows(layout).height, layout.titleHeightPx ?? 0)];
  if (home === 'title') { out.scaleBar = [0, 0]; out.northArrow = [0, 0]; }
  if (home === 'panel') { out.scaleBar = [Math.max(200, Math.min(400, layout.scaleBarWidthPx || STUDIO_PANEL.w)), STUDIO_PANEL.h]; out.northArrow = [0, 0]; }
  if (home === 'apart') out.scaleBar = [Math.max(160, Math.min(400, layout.scaleBarWidthPx || 200)), 58];
  return out;
}
