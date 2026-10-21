import { describe, it, expect } from 'vitest';
import { fillPatternSpec, hasFillPattern, patternIdPart, FILL_PATTERNS } from '../shared/fillPattern.js';

// One description of the hatch, cross and dot tiles, read by the map, the
// legend swatch and both exporters. These pin it to the values the map has
// always drawn, so moving the geometry here changed nothing on screen.

describe('fillPatternSpec', () => {
  it('describes nothing for a solid or unknown fill', () => {
    expect(fillPatternSpec({})).toBeNull();
    expect(fillPatternSpec({ fillPattern: 'none' })).toBeNull();
    expect(fillPatternSpec({ fillPattern: 'stripes' })).toBeNull();
    expect(fillPatternSpec(undefined)).toBeNull();
    expect(hasFillPattern({ fillPattern: 'none' })).toBe(false);
    FILL_PATTERNS.forEach((kind) => expect(hasFillPattern({ fillPattern: kind })).toBe(true));
  });

  it('keeps the map’s hatch: a 12 px tile of 1.5 px diagonals', () => {
    const spec = fillPatternSpec({ fillPattern: 'hatch', fill: '#ff0000', fillOpacity: 0.4 });
    expect(spec).toMatchObject({ kind: 'hatch', spacing: 6, size: 12, strokeWidth: 1.5, color: '#ff0000', opacity: 0.4, angle: 45 });
    expect(spec.shapes).toEqual([
      { type: 'line', x1: 0, y1: 12, x2: 12, y2: 0 },
      { type: 'line', x1: -6, y1: 6, x2: 6, y2: -6 },
      { type: 'line', x1: 6, y1: 18, x2: 18, y2: 6 },
    ]);
  });

  it('keeps the map’s cross and dots', () => {
    expect(fillPatternSpec({ fillPattern: 'cross' }).shapes).toEqual([
      { type: 'line', x1: 0, y1: 6, x2: 12, y2: 6 },
      { type: 'line', x1: 6, y1: 0, x2: 6, y2: 12 },
    ]);
    expect(fillPatternSpec({ fillPattern: 'cross' }).angle).toBe(0);
    expect(fillPatternSpec({ fillPattern: 'dots' }).shapes).toEqual([{ type: 'dot', cx: 6, cy: 6, r: 2 }]);
  });

  it('falls back to the map’s pattern colour and opacity', () => {
    expect(fillPatternSpec({ fillPattern: 'dots' })).toMatchObject({ color: '#54a6ff', opacity: 0.6 });
    // An explicit 0 is kept, not replaced by the default.
    expect(fillPatternSpec({ fillPattern: 'dots', fillOpacity: 0 }).opacity).toBe(0);
  });

  it('honours the layer’s spacing', () => {
    const spec = fillPatternSpec({ fillPattern: 'cross', fillPatternSpacing: 10 });
    expect(spec.size).toBe(20);
    expect(spec.shapes[1]).toEqual({ type: 'line', x1: 10, y1: 0, x2: 10, y2: 20 });
  });

  it('scales with the export, keeping a floor on strokes and dots', () => {
    const at2 = fillPatternSpec({ fillPattern: 'hatch' }, 2);
    expect(at2.size).toBe(24);
    expect(at2.strokeWidth).toBe(3);
    expect(fillPatternSpec({ fillPattern: 'hatch' }, 0.5).strokeWidth).toBe(1);
    expect(fillPatternSpec({ fillPattern: 'dots' }, 0.5).shapes[0].r).toBe(1.5);
    expect(fillPatternSpec({ fillPattern: 'dots' }, 3).shapes[0].r).toBe(6);
  });
});

describe('patternIdPart', () => {
  it('reduces ids to characters url(#…) accepts unquoted', () => {
    expect(patternIdPart(':r1:')).toBe('r1');
    expect(patternIdPart('layer 1/a"b')).toBe('layer1ab');
    expect(patternIdPart('')).toBe('x');
  });
});
