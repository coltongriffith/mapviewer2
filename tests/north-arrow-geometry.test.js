import { describe, it, expect } from 'vitest';
import { northArrowShapes } from '../src/utils/northArrowGeometry.js';

const STYLES = ['classic', 'arrow', 'decorative', 'surveyor'];
const W = 90, H = 100;

/** Bounding box of the ink, treating a letter as its cap box. */
function inkBounds(shapes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const s of shapes) {
    const pad = (s.strokeWidth || 0) / 2;
    if (s.kind === 'polygon') s.points.forEach(([x, y]) => { grow(x - pad, y - pad); grow(x + pad, y + pad); });
    else if (s.kind === 'circle') { grow(s.cx - s.r - pad, s.cy - s.r - pad); grow(s.cx + s.r + pad, s.cy + s.r + pad); }
    else if (s.kind === 'line') { grow(s.x1 - pad, s.y1 - pad); grow(s.x2 - pad, s.y2 - pad); }
    else if (s.kind === 'text') {
      // Arial bold: cap height 0.716em, and the widest cardinal ('W') 0.944em.
      const cap = s.size * 0.716;
      const wide = s.size * 0.944;
      const left = s.anchor === 'start' ? s.x : s.anchor === 'end' ? s.x - wide : s.x - wide / 2;
      grow(left, s.y - cap);
      grow(left + wide, s.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

const labels = (shapes) => shapes.filter((s) => s.kind === 'text');
const rose = (shapes) => shapes.filter((s) => s.kind !== 'text');

describe('north arrow geometry', () => {
  it.each(STYLES)('%s keeps every mark inside the panel', (style) => {
    const b = inkBounds(northArrowShapes(style, W, H));
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(W);
    // The simple arrow used to put its "N" baseline at 0.93h, so the glyph ran
    // past the bottom edge and the letter was clipped in the panel.
    expect(b.maxY).toBeLessThanOrEqual(H);
  });

  it.each(STYLES)('%s never lets a cardinal letter touch the rose', (style) => {
    const shapes = northArrowShapes(style, W, H);
    const art = inkBounds(rose(shapes));
    for (const label of labels(shapes)) {
      const cap = label.size * 0.716;
      const wide = label.size * 0.944;
      const left = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - wide : label.x - wide / 2;
      const box = { x0: left, y0: label.y - cap, x1: left + wide, y1: label.y };
      const overlaps = box.x1 > art.minX && box.x0 < art.maxX && box.y1 > art.minY && box.y0 < art.maxY;
      // The decorative style's "S" used to sit on the outer ring.
      expect(overlaps, `${style}: "${label.value}" overlaps the rose`).toBe(false);
    }
  });

  it.each(STYLES)('%s centres its ink vertically', (style) => {
    const b = inkBounds(northArrowShapes(style, W, H));
    expect(Math.abs(b.minY - (H - b.maxY))).toBeLessThan(2);
  });

  it('puts the cardinal letter in the same place in every single-label style', () => {
    const baselines = ['classic', 'arrow', 'surveyor'].map((style) => {
      const [n] = labels(northArrowShapes(style, W, H));
      return n.y;
    });
    expect(new Set(baselines).size).toBe(1);
  });

  it('gives every style the same outer radius, so switching does not resize the map', () => {
    const spans = STYLES.map((style) => {
      const b = inkBounds(rose(northArrowShapes(style, W, H)));
      return Math.round(b.maxY - b.minY);
    });
    // Decorative rings its rose with letters, so its artwork is deliberately
    // smaller; the other three share one outer extent.
    const single = spans.slice(0, 2).concat(spans[3]);
    expect(Math.max(...single) - Math.min(...single)).toBeLessThanOrEqual(3);
  });

  it('scales with the panel instead of assuming one size', () => {
    const small = inkBounds(northArrowShapes('classic', 45, 50));
    const large = inkBounds(northArrowShapes('classic', 180, 200));
    expect(large.maxY / small.maxY).toBeCloseTo(4, 1);
  });

  it('falls back to the compass rose for an unknown style', () => {
    expect(northArrowShapes('nonsense', W, H)).toEqual(northArrowShapes('classic', W, H));
  });
});
