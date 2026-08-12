import { describe, it, expect } from 'vitest';
import {
  applyLegendCustomization, customLegendItem, nextCustomLegendId,
  LEGEND_SYMBOLS, isLegendSymbol, DEFAULT_LEGEND_COLOR,
} from '../src/utils/legendCustomization.js';

// Legend entries are derived from the layers on the map, which is what keeps
// them honest: delete a layer and its entry goes, trim every shape out of a
// layer and its entry goes too. Editing therefore has to be a layer of
// overrides on top of that derivation, not a replacement for it — a
// hand-maintained list drifts from the map, and a legend that disagrees with
// the map is worse than none on a document someone raises money against.

const derived = [
  { id: 'layer-1', label: 'Claims', type: 'polygon', style: { fill: '#93c5fd' } },
  { id: 'layer-2', label: 'Drillholes', type: 'points', markerShape: 'circle', style: {} },
  { id: 'overlay-rail', label: 'Railway Network', type: 'line', style: {} },
];

describe('applyLegendCustomization', () => {
  it('passes derived entries through untouched when nothing is customised', () => {
    expect(applyLegendCustomization(derived, {})).toEqual(derived);
    expect(applyLegendCustomization(derived, undefined)).toEqual(derived);
  });

  it('renames an entry without disturbing its swatch', () => {
    const [claims] = applyLegendCustomization(derived, {
      legendOverrides: { 'layer-1': { label: 'Hatchet Lake Claims' } },
    });
    expect(claims.label).toBe('Hatchet Lake Claims');
    // The swatch is the layer's own styling. A legend swatch that disagrees
    // with the shape on the map is the one thing a legend must never do.
    expect(claims.style).toEqual({ fill: '#93c5fd' });
    expect(claims.type).toBe('polygon');
  });

  it('removes an entry', () => {
    const out = applyLegendCustomization(derived, {
      legendOverrides: { 'layer-2': { hidden: true } },
    });
    expect(out.map((i) => i.id)).toEqual(['layer-1', 'overlay-rail']);
  });

  it('treats a blank rename as no rename, not as an empty label', () => {
    // The user cleared the box. The derived name is the sensible fallback; an
    // empty legend row is not.
    const out = applyLegendCustomization(derived, {
      legendOverrides: { 'layer-1': { label: '   ' } },
    });
    expect(out[0].label).toBe('Claims');
  });

  it('trims a rename', () => {
    const out = applyLegendCustomization(derived, {
      legendOverrides: { 'layer-1': { label: '  Padded  ' } },
    });
    expect(out[0].label).toBe('Padded');
  });

  it('ignores an override for an entry that no longer exists', () => {
    // Delete a layer and its override is inert rather than resurrecting a row.
    const out = applyLegendCustomization(derived, {
      legendOverrides: { 'layer-gone': { label: 'Ghost' } },
    });
    expect(out).toHaveLength(3);
    expect(out.some((i) => i.label === 'Ghost')).toBe(false);
  });

  it('keeps a rename waiting for a layer that comes back', () => {
    // Re-importing a claim block must not silently lose the name its author
    // gave it.
    const layout = { legendOverrides: { 'layer-1': { label: 'Renamed' } } };
    expect(applyLegendCustomization([], layout)).toEqual([]);
    expect(applyLegendCustomization(derived, layout)[0].label).toBe('Renamed');
  });

  it('appends custom entries after the derived ones', () => {
    const out = applyLegendCustomization(derived, {
      legendCustomItems: [{ id: 'custom-1', label: 'Mill site', symbol: 'square', color: '#ff0000' }],
    });
    expect(out).toHaveLength(4);
    expect(out[3].label).toBe('Mill site');
    expect(out[3].custom).toBe(true);
  });

  it('lets a custom entry be renamed and removed like any other', () => {
    const custom = [{ id: 'custom-1', label: 'Mill site', symbol: 'square', color: '#ff0000' }];
    expect(applyLegendCustomization([], {
      legendCustomItems: custom,
      legendOverrides: { 'custom-1': { label: 'Processing plant' } },
    })[0].label).toBe('Processing plant');
    expect(applyLegendCustomization([], {
      legendCustomItems: custom,
      legendOverrides: { 'custom-1': { hidden: true } },
    })).toEqual([]);
  });

  it('drops a malformed custom entry rather than rendering a blank row', () => {
    const out = applyLegendCustomization([], {
      legendCustomItems: [null, { label: 'no id' }, { id: 'custom-2', label: 'Fine' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('Fine');
  });
});

describe('customLegendItem', () => {
  it('gives a point symbol both the fill and the outline colour', () => {
    // The legend swatch reads markerFill for the interior and markerColor for
    // the outline; one colour has to supply both or the swatch renders hollow.
    const item = customLegendItem({ id: 'c1', label: 'Adit', symbol: 'triangle', color: '#00ff00' });
    expect(item.type).toBe('points');
    expect(item.markerShape).toBe('triangle');
    expect(item.style.markerFill).toBe('#00ff00');
    expect(item.style.markerColor).toBe('#00ff00');
  });

  it('builds a line entry that the renderers understand', () => {
    const item = customLegendItem({ id: 'c1', label: 'Access road', symbol: 'line', color: '#123456' });
    expect(item.type).toBe('line');
    expect(item.style.stroke).toBe('#123456');
    expect(item.style.strokeWidth).toBeGreaterThan(0);
  });

  it('builds an area entry with a translucent fill and a solid edge', () => {
    const item = customLegendItem({ id: 'c1', label: 'Lease', symbol: 'area', color: '#123456' });
    expect(item.type).toBe('polygon');
    expect(item.style.fill).toBe('#123456');
    expect(item.style.stroke).toBe('#123456');
    expect(item.style.fillOpacity).toBeLessThan(1);
  });

  it('falls back to a known symbol and colour rather than rendering nothing', () => {
    const item = customLegendItem({ id: 'c1', label: 'X', symbol: 'not-a-shape' });
    expect(item.type).toBe('points');
    expect(item.markerShape).toBe('circle');
    expect(item.style.markerColor).toBe(DEFAULT_LEGEND_COLOR);
  });

  it('gives an unnamed entry a placeholder rather than an empty row', () => {
    expect(customLegendItem({ id: 'c1' }).label).toBe('New item');
  });
});

describe('the standard symbol set', () => {
  // Every symbol has to be drawn by three separate renderers: the editor
  // (utils/markerIcons.jsx), the PNG exporter (drawCanvasMarkerShape) and the
  // SVG exporter (svgMarkerShape). A symbol offered here that one of them does
  // not know renders in the editor and vanishes from the client's PDF.
  const POINT_SHAPES = LEGEND_SYMBOLS.filter((s) => s.type === 'points').map((s) => s.value);

  it('offers point shapes, a line and an area', () => {
    expect(POINT_SHAPES.length).toBeGreaterThan(4);
    expect(LEGEND_SYMBOLS.some((s) => s.type === 'line')).toBe(true);
    expect(LEGEND_SYMBOLS.some((s) => s.type === 'polygon')).toBe(true);
  });

  it('has no duplicate values and labels every option', () => {
    const values = LEGEND_SYMBOLS.map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
    LEGEND_SYMBOLS.forEach((s) => expect(s.label.length).toBeGreaterThan(0));
  });

  it('offers only shapes the editor can actually draw', async () => {
    // Called, not grepped. A source-text search reported "star" as undrawable
    // because it is served from MARKER_ICON_PATHS rather than a switch case —
    // the string was absent, the capability was not.
    const { markerShapeInner, MARKER_ICON_PATHS } = await import('../src/utils/markerIcons.jsx');
    const fallback = markerShapeInner('definitely-not-a-shape', 10, 10, 8, '#000', '#000');
    POINT_SHAPES.forEach((shape) => {
      if (shape === 'circle') return; // legitimately the fallback
      const drawnGeometrically = markerShapeInner(shape, 10, 10, 8, '#000', '#000') !== fallback;
      const drawnFromPath = Boolean(MARKER_ICON_PATHS[shape]);
      expect(
        drawnGeometrically || drawnFromPath,
        `the editor renders "${shape}" as a plain circle — it would not match the export`,
      ).toBe(true);
    });
  });

  it('offers only shapes both exporters can draw', async () => {
    // These two are string-built, so the check is textual — but scoped to the
    // one function, and asserted against a real branch rather than a mention.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/export/renderScene.js', 'utf8');
    const fn = (name) => {
      const start = src.indexOf(`function ${name}`);
      return src.slice(start, src.indexOf('\n}', start));
    };
    const svgFn = fn('svgMarkerShape');
    const canvasFn = fn('drawCanvasMarkerShape');
    POINT_SHAPES.forEach((shape) => {
      if (shape === 'circle') return;
      expect(svgFn, `SVG export cannot draw "${shape}"`).toContain(`'${shape}'`);
      expect(canvasFn, `PNG export cannot draw "${shape}"`).toContain(`'${shape}'`);
    });
  });

  it('recognises its own values', () => {
    LEGEND_SYMBOLS.forEach((s) => expect(isLegendSymbol(s.value)).toBe(true));
    expect(isLegendSymbol('nope')).toBe(false);
  });
});

describe('nextCustomLegendId', () => {
  it('does not collide with an existing id', () => {
    const existing = [{ id: 'custom-1' }, { id: 'custom-2' }];
    expect(existing.map((e) => e.id)).not.toContain(nextCustomLegendId(existing));
  });

  it('survives ids that were deleted out of order', () => {
    // Add three, delete the second, add again: the naive length+1 would reuse
    // an id that is still on the page.
    const existing = [{ id: 'custom-1' }, { id: 'custom-3' }];
    const id = nextCustomLegendId(existing);
    expect(['custom-1', 'custom-3']).not.toContain(id);
  });

  it('starts somewhere sensible when empty', () => {
    expect(nextCustomLegendId([])).toBe('custom-1');
  });
});
