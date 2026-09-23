// One definition of how a point symbol is drawn, shared by the editor map, the
// share page, the legend swatches and every exporter (PNG, SVG, PDF).
//
// SIZE CONVENTION
//   `markerSize` is the symbol's DIAMETER — the width of its bounding box — in
//   CSS pixels at 1x. A size-12 circle is 12 px across on screen and 36 px
//   across in a 3x PNG. Stroke width is also in CSS px at 1x and is centred on
//   the outline, exactly as a canvas or SVG stroke is.
//
// Before this module the editor drew a circle with radius max(4, size / 2) and
// every other shape at max(8, size) with hard-coded stroke widths, while the
// exporters drew radius size / 2 with the layer's stroke. Any size of 8 or less
// therefore looked identical on screen and different in the PNG, and shapes
// such as the drill-hole pin even pointed different ways.
//
// No clamps beyond a 1 px floor: a size the user sets is the size drawn.

export const DEFAULT_POINT_SIZE = 8; // what every exporter has always used when unset
export const POINT_SIZE_MIN = 1;
export const POINT_SIZE_MAX = 64;
export const DEFAULT_POINT_STROKE = 1.5;

export function clampPointSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(POINT_SIZE_MIN, Math.min(POINT_SIZE_MAX, Math.round(n * 10) / 10));
}

/**
 * The drawable symbol for a fully resolved feature style (template role, layer,
 * class and feature override already merged — see getFeatureStyle).
 * → { size, shape, fill, stroke, strokeWidth }
 */
export function resolvePointSymbol(style = {}) {
  const raw = Number(style.markerSize);
  const size = Number.isFinite(raw) && raw > 0 ? Math.max(POINT_SIZE_MIN, raw) : DEFAULT_POINT_SIZE;
  const stroke = style.markerColor || style.stroke || '#111111';
  const sw = Number(style.strokeWidth);
  return {
    size,
    shape: style.markerShape || 'circle',
    stroke,
    fill: style.markerFill || style.fill || style.markerColor || '#ffffff',
    strokeWidth: Number.isFinite(sw) && sw >= 0 ? sw : DEFAULT_POINT_STROKE,
  };
}

const f = (n) => Number(n.toFixed(2));

/**
 * SVG path data for a symbol of radius r (= size / 2) centred on (cx, cy).
 * The single geometry for every renderer: the editor icons, SVG export, and
 * the PNG/PDF canvas (via Path2D). Open sub-paths (cross, drill-hole stem)
 * are stroked only.
 */
export function symbolPath(shape, cx, cy, r) {
  const P = (x, y) => `${f(x)} ${f(y)}`;
  switch (shape) {
    case 'triangle_down':
      return `M${P(cx - r, cy - r)}L${P(cx + r, cy - r)}L${P(cx, cy + r)}Z`;
    case 'triangle':
      return `M${P(cx, cy - r)}L${P(cx + r, cy + r)}L${P(cx - r, cy + r)}Z`;
    case 'square':
      return `M${P(cx - r, cy - r)}L${P(cx + r, cy - r)}L${P(cx + r, cy + r)}L${P(cx - r, cy + r)}Z`;
    case 'diamond':
      return `M${P(cx, cy - r)}L${P(cx + r, cy)}L${P(cx, cy + r)}L${P(cx - r, cy)}Z`;
    case 'star': {
      const r2 = r * 0.45;
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const ri = i % 2 === 0 ? r : r2;
        return P(cx + ri * Math.cos(a), cy + ri * Math.sin(a));
      });
      return `M${pts.join('L')}Z`;
    }
    case 'cross':
      return `M${P(cx, cy - r)}L${P(cx, cy + r)}M${P(cx - r, cy)}L${P(cx + r, cy)}`;
    case 'drillhole':
      return `M${P(cx, cy - r)}L${P(cx + r, cy + r * 0.5)}L${P(cx - r, cy + r * 0.5)}Z`
        + `M${P(cx, cy + r * 0.5)}L${P(cx, cy + r)}`;
    case 'hexagon': {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (i * Math.PI) / 3 - Math.PI / 2;
        return P(cx + r * Math.cos(a), cy + r * Math.sin(a));
      });
      return `M${pts.join('L')}Z`;
    }
    case 'pin': {
      const cr = r * 0.58;
      const py = cy - r * 0.28;
      return `M${P(cx + cr, py)}A${f(cr)} ${f(cr)} 0 1 0 ${P(cx - cr, py)}A${f(cr)} ${f(cr)} 0 1 0 ${P(cx + cr, py)}Z`
        + `M${P(cx - cr * 0.55, py + cr * 0.4)}L${P(cx + cr * 0.55, py + cr * 0.4)}L${P(cx, cy + r)}Z`;
    }
    default: // circle
      return `M${P(cx + r, cy)}A${f(r)} ${f(r)} 0 1 0 ${P(cx - r, cy)}A${f(r)} ${f(r)} 0 1 0 ${P(cx + r, cy)}Z`;
  }
}

/**
 * A standalone SVG document for one symbol at `scale`, padded so the centred
 * stroke is not clipped. → { svg, box } where box is the pixel width/height.
 */
export function symbolSvg(symbol, scale = 1, { opacity = 1 } = {}) {
  const r = (symbol.size * scale) / 2;
  const sw = symbol.strokeWidth * scale;
  const box = Math.ceil(symbol.size * scale + sw + 2);
  const c = box / 2;
  const esc = (v) => String(v).replace(/[^#A-Za-z0-9(),.%\s-]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">`
    + `<path d="${symbolPath(symbol.shape, c, c, r)}" fill="${esc(symbol.fill)}" stroke="${esc(symbol.stroke)}" stroke-width="${f(sw)}" stroke-linejoin="round" opacity="${opacity}"/></svg>`;
  return { svg, box };
}
