// Hatch, cross and dot fills for polygon layers, described once so the map
// (components/MapCanvas.jsx), the legend swatch (components/LegendSwatches.jsx)
// and both exporters (export/renderScene.js) draw the same tile. Each used to
// carry its own copy of the geometry, and the legends carried none at all: a
// hatched layer showed a flat swatch in every legend.
//
// The values are the ones the map has always drawn: a square tile two
// spacings wide, 1.5 px strokes and 2 px dots in the layer's fill colour at its
// fill opacity. `scale` is the export scale; strokes and dots keep a floor so a
// small scale cannot thin them to nothing.

export const FILL_PATTERNS = ['hatch', 'cross', 'dots'];
export const DEFAULT_PATTERN_SPACING = 6;

export function hasFillPattern(style) {
  return FILL_PATTERNS.includes(style?.fillPattern);
}

export function fillPatternSpec(style, scale = 1) {
  if (!hasFillPattern(style)) return null;
  const kind = style.fillPattern;
  const s = (Number(style.fillPatternSpacing) || DEFAULT_PATTERN_SPACING) * scale;
  const strokeWidth = Math.max(1, 1.5 * scale);
  const line = (x1, y1, x2, y2) => ({ type: 'line', x1, y1, x2, y2 });
  const shapes = kind === 'hatch'
    // The diagonal plus the two corner pieces that complete it across tiles.
    ? [line(0, s * 2, s * 2, 0), line(-s, s, s, -s), line(s, s * 3, s * 3, s)]
    : kind === 'cross'
      ? [line(0, s, s * 2, s), line(s, 0, s, s * 2)]
      : [{ type: 'dot', cx: s, cy: s, r: Math.max(1.5, 2 * scale) }];
  return {
    kind,
    spacing: s,
    size: s * 2,
    strokeWidth,
    color: style.fill || '#54a6ff',
    opacity: style.fillOpacity ?? 0.6,
    // Direction of the strokes, for anyone describing the fill in words.
    angle: kind === 'hatch' ? 45 : 0,
    shapes,
  };
}

// Pattern ids are document-wide. Anything used to build one (a layer id, a
// React useId) is reduced to characters that survive url(#…) unquoted.
export function patternIdPart(value) {
  return String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '') || 'x';
}
