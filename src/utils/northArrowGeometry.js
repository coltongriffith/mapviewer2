/**
 * The north arrow, as data.
 *
 * WHY THIS EXISTS. The rose was drawn three times — a React SVG on the editing
 * stage, a canvas path in the PNG exporter and a string of SVG in the vector
 * exporter — each with its own constants. They had already drifted (the stage
 * used R = 0.27h and centre 0.56h, the exporter 0.24h and 0.55h), and every
 * style hand-placed its own cardinal letter with a different fraction of the
 * height. That is how the "S" ended up sitting on the ring in the decorative
 * style, the "N" ended up clipped by the bottom edge in the simple arrow, and
 * no two styles agreed on where a letter goes.
 *
 * So the geometry lives here once and emits primitives; the three renderers
 * only know how to paint a polygon, a circle, a line and a run of text.
 *
 * LAYOUT. Everything is laid out in a 90 x 100 virtual box and then fitted
 * into the real one exactly as `preserveAspectRatio="xMidYMid meet"` would, so
 * proportions hold at any zone size or aspect ratio.
 *
 * Two rules make the styles interchangeable:
 *   1. Every style puts its cardinal letter on the same baseline.
 *   2. Every style's rose reaches the same outer radius.
 * Switching style therefore never moves the artwork, and the ink is centred in
 * the box with equal margins top and bottom.
 *
 * Colours are symbolic — 'fg' and 'bg' — because each renderer resolves them
 * from the project's theme.
 */

const VB_W = 90;
const VB_H = 100;

// Arial's cap height, which is what actually has to be spaced — not the em box.
const CAP = 0.716;

// Single-label styles (classic, arrow, surveyor).
const LABEL_SIZE = 15;
const LABEL_CAP = LABEL_SIZE * CAP;      // 10.74
const MARGIN = 8;                         // equal top and bottom
const LABEL_GAP = 7;                      // letter to rose
const LABEL_BASE = MARGIN + LABEL_CAP;    // 18.74
const R_OUT = (VB_H - 2 * MARGIN - LABEL_CAP - LABEL_GAP) / 2;  // 33.13
const CX = VB_W / 2;
const CY = MARGIN + LABEL_CAP + LABEL_GAP + R_OUT;              // 58.87

// Four-label style (decorative): the rose is centred, letters ring it.
const D_LABEL_SIZE = 12;
const D_LABEL_CAP = D_LABEL_SIZE * CAP;   // 8.59
const D_GAP = 6;                          // ring to letter, vertically
const D_GAP_H = 5;                        // ring to letter, horizontally
// Bounded by the widest letter ('W' ≈ 0.944em bold) clearing the left edge.
const D_R = 25.5;
const D_CY = VB_H / 2;
const D_LABEL_TOP_BASE = D_CY - D_R - D_GAP;              // glyph bottom above ring
const D_LABEL_BOTTOM_BASE = D_CY + D_R + D_GAP + D_LABEL_CAP;

const poly = (points, fill, opacity) => ({ kind: 'polygon', points, fill, opacity });
const circ = (cx, cy, r, o) => ({ kind: 'circle', cx, cy, r, ...o });
const line = (x1, y1, x2, y2, o) => ({ kind: 'line', x1, y1, x2, y2, ...o });
const text = (x, y, value, o) => ({ kind: 'text', x, y, value, size: LABEL_SIZE, weight: 700, anchor: 'middle', ...o });

/** A four-armed star: long N/S arms, shorter E/W arms, drawn as four triangles. */
function star(cx, cy, r, re, waist) {
  const n = [cx, cy - r], s = [cx, cy + r];
  const e = [cx + re, cy], w = [cx - re, cy];
  const ne = [cx + waist, cy - waist], se = [cx + waist, cy + waist];
  const sw = [cx - waist, cy + waist], nw = [cx - waist, cy - waist];
  return [
    poly([n, ne, [cx, cy], nw], 'fg', 1),
    poly([s, sw, [cx, cy], se], 'fg', 0.5),
    poly([e, se, [cx, cy], ne], 'fg', 0.3),
    poly([w, nw, [cx, cy], sw], 'fg', 0.3),
  ];
}

function classicShapes() {
  const rStar = R_OUT * 0.80;
  const shapes = [
    circ(CX, CY, R_OUT, { stroke: 'fg', strokeWidth: 1.2, opacity: 0.25 }),
    ...star(CX, CY, rStar, rStar * 0.60, rStar * 0.24),
    circ(CX, CY, rStar * 0.155, { fill: 'bg', stroke: 'fg', strokeWidth: 1.8 }),
    text(CX, LABEL_BASE, 'N'),
  ];
  return shapes;
}

function arrowShapes() {
  // A symmetric needle: filled to the north, hollow to the south. The old
  // shape was a five-sided nib whose flat base read as an ink pen.
  const wN = R_OUT * 0.32;
  const tip = [CX, CY - R_OUT];
  const tail = [CX, CY + R_OUT];
  const left = [CX - wN, CY];
  const right = [CX + wN, CY];
  return [
    poly([tip, right, left], 'fg', 1),
    { kind: 'polygon', points: [tail, right, left], fill: 'bg', stroke: 'fg', strokeWidth: 1.8, opacity: 1 },
    circ(CX, CY, wN * 0.40, { fill: 'bg', stroke: 'fg', strokeWidth: 1.8 }),
    text(CX, LABEL_BASE, 'N'),
  ];
}

function surveyorShapes() {
  const rc = R_OUT * 0.84;
  const baseOff = rc * 0.30;
  const halfW = rc * 0.20;
  return [
    line(CX, CY - R_OUT, CX, CY + R_OUT, { stroke: 'fg', strokeWidth: 1.6, opacity: 0.32 }),
    line(CX - R_OUT, CY, CX + R_OUT, CY, { stroke: 'fg', strokeWidth: 1.6, opacity: 0.32 }),
    circ(CX, CY, rc, { stroke: 'fg', strokeWidth: 2.0, opacity: 0.24 }),
    circ(CX, CY, rc * 0.52, { stroke: 'fg', strokeWidth: 1.2, opacity: 0.16 }),
    poly([[CX, CY - rc], [CX - halfW, CY - baseOff], [CX + halfW, CY - baseOff]], 'fg', 1),
    {
      kind: 'polygon',
      points: [[CX, CY + rc], [CX - halfW, CY + baseOff], [CX + halfW, CY + baseOff]],
      fill: 'bg', stroke: 'fg', strokeWidth: 1.6, opacity: 1,
    },
    circ(CX, CY, rc * 0.10, { fill: 'fg' }),
    text(CX, LABEL_BASE, 'N'),
  ];
}

function decorativeShapes() {
  const rStar = D_R * 0.82;
  const tick = D_R * 0.12;
  const ticks = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    const len = deg % 90 === 0 ? tick * 1.6 : tick;
    return line(
      CX + (D_R - len) * Math.cos(rad), D_CY + (D_R - len) * Math.sin(rad),
      CX + D_R * Math.cos(rad), D_CY + D_R * Math.sin(rad),
      { stroke: 'fg', strokeWidth: deg % 90 === 0 ? 1.5 : 0.9, opacity: deg % 90 === 0 ? 0.5 : 0.25 },
    );
  });
  const label = (x, y, value, anchor) => ({
    kind: 'text', x, y, value, size: D_LABEL_SIZE, weight: 700, anchor,
  });
  return [
    circ(CX, D_CY, D_R, { stroke: 'fg', strokeWidth: 1.3, opacity: 0.22 }),
    circ(CX, D_CY, D_R - 3, { stroke: 'fg', strokeWidth: 0.7, opacity: 0.12 }),
    ...ticks,
    ...star(CX, D_CY, rStar, rStar * 0.60, rStar * 0.24),
    circ(CX, D_CY, rStar * 0.17, { fill: 'bg', stroke: 'fg', strokeWidth: 1.6 }),
    label(CX, D_LABEL_TOP_BASE, 'N', 'middle'),
    label(CX, D_LABEL_BOTTOM_BASE, 'S', 'middle'),
    // Anchored at the ring's edge rather than centred on a guessed x, so the
    // widest letter cannot run off the side of the panel.
    label(CX + D_R + D_GAP_H, D_CY + D_LABEL_CAP / 2, 'E', 'start'),
    label(CX - D_R - D_GAP_H, D_CY + D_LABEL_CAP / 2, 'W', 'end'),
  ];
}

const BUILDERS = {
  classic: classicShapes,
  arrow: arrowShapes,
  decorative: decorativeShapes,
  surveyor: surveyorShapes,
};

/**
 * Primitives for one north arrow, in the coordinate space of a box `w` x `h`
 * whose top-left corner is (0, 0) — callers translate.
 *
 * Lengths that are not coordinates (radii, stroke widths, font sizes) are
 * already scaled, so a renderer never has to know about the virtual box.
 */
export function northArrowShapes(style, w, h) {
  const build = BUILDERS[style] || BUILDERS.classic;
  const s = Math.min(w / VB_W, h / VB_H);
  const ox = (w - VB_W * s) / 2;
  const oy = (h - VB_H * s) / 2;
  const px = (x) => ox + x * s;
  const py = (y) => oy + y * s;

  return build().map((shape) => {
    switch (shape.kind) {
      case 'polygon':
        return { ...shape, points: shape.points.map(([x, y]) => [px(x), py(y)]), strokeWidth: (shape.strokeWidth || 0) * s };
      case 'circle':
        return { ...shape, cx: px(shape.cx), cy: py(shape.cy), r: shape.r * s, strokeWidth: (shape.strokeWidth || 0) * s };
      case 'line':
        return { ...shape, x1: px(shape.x1), y1: py(shape.y1), x2: px(shape.x2), y2: py(shape.y2), strokeWidth: (shape.strokeWidth || 0) * s };
      case 'text':
        return { ...shape, x: px(shape.x), y: py(shape.y), size: shape.size * s };
      default:
        return shape;
    }
  });
}

export const NORTH_ARROW_FONT = 'Arial, Helvetica, sans-serif';
