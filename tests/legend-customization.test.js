import { describe, it, expect } from 'vitest';
import {
  applyLegendCustomization, customLegendItem, nextCustomLegendId,
  LEGEND_SYMBOLS, isLegendSymbol, DEFAULT_LEGEND_COLOR,
} from '../src/utils/legendCustomization.js';
import { markerShapeInner, MARKER_ICON_PATHS } from '../src/utils/markerIcons.jsx';

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

  it('draws a visibly different swatch for every point shape', () => {
    // Not just "is it handled" — two shapes that render identically would pass
    // a handled check and still leave the reader unable to tell them apart.
    const drawn = new Map();
    POINT_SHAPES.forEach((shape) => {
      const markup = markerShapeInner(shape, 10, 10, 8, '#000000', '#ffffff')
        || `path:${shape}`;
      const clash = drawn.get(markup);
      expect(clash, `"${shape}" and "${clash}" render identically`).toBeUndefined();
      drawn.set(markup, shape);
    });
  });
});

// Every surface that draws a legend point swatch must use the shared marker
// renderer.
//
// There were FIVE hand-written copies of the shape table. Two had quietly
// fallen behind — one drew a circle for every shape, another had never gained
// hexagon or pin — so an author could pick hexagon, see it in the editor and
// in the export, and have the public share page show a circle. Caught in
// review on the share path, which is the copy that matters most and the one I
// missed.
//
// This is a source check, deliberately: the components are not exported and
// the failure is structural — someone writing a sixth copy — rather than
// something a rendered assertion would notice.
describe('legend swatches all come from one renderer', () => {
  const LEGEND_SURFACES = [
    'src/App.jsx',
    'src/components/ReadOnlyMapStage.jsx',
    'src/components/LegendEditor.jsx',
  ];

  it.each(LEGEND_SURFACES)('%s does not re-implement the shape table', async (file) => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(file, 'utf8');
    // The tell-tale of a hand-rolled swatch: branching on a shape name to pick
    // geometry. Picker option lists name shapes too, but do not branch on them.
    const branches = src.match(/shape === '/g) || [];
    expect(
      branches.length,
      `${file} branches on marker shape itself — use MarkerSvgIcon so every symbol renders`,
    ).toBe(0);
  });

  it('each legend surface uses the shared renderer', async () => {
    const { readFileSync } = await import('node:fs');
    LEGEND_SURFACES.forEach((file) => {
      const src = readFileSync(file, 'utf8');
      if (!/LegendPointSwatch|legend-symbol-marker|SymbolPreview/.test(src)) return;
      expect(src, `${file} draws legend symbols without MarkerSvgIcon`).toContain('MarkerSvgIcon');
    });
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

// ── Headings and order ───────────────────────────────────────────────────────
//
// Entries carried a `group` from the day the legend was built, and every
// renderer threw it away. A technical figure reads "Mineral Tenure / Bedrock
// Geology / Soil Geochemistry" as three sections, so the headings are back —
// off by default, so a saved map keeps its exact legend until someone asks.

import {
  groupLegendItems, orderLegendItems, moveLegendItem, legendRowCount, DEFAULT_LEGEND_GROUP,
} from '../src/utils/legendCustomization.js';

const grouped = [
  { id: 'a', label: 'Property', group: 'Mineral Tenure', type: 'polygon', style: {} },
  { id: 'b', label: 'Finlayson', group: 'Bedrock Geology', type: 'polygon', style: {} },
  { id: 'c', label: 'Discovery Zone', group: 'Project Areas', type: 'points', style: {} },
  { id: 'd', label: 'Snowcap', group: 'Bedrock Geology', type: 'polygon', style: {} },
  { id: 'e', label: 'No group', type: 'line', style: {} },
];

describe('groupLegendItems', () => {
  it('is one unheaded group unless headings are switched on', () => {
    expect(groupLegendItems(grouped, {})).toEqual([{ heading: null, items: grouped }]);
    expect(groupLegendItems(grouped, { legendGrouped: false })).toEqual([{ heading: null, items: grouped }]);
  });

  it('gathers entries under their heading in first-appearance order', () => {
    const out = groupLegendItems(grouped, { legendGrouped: true });
    expect(out.map((g) => g.heading)).toEqual(['Mineral Tenure', 'Bedrock Geology', 'Project Areas', DEFAULT_LEGEND_GROUP]);
    expect(out[1].items.map((i) => i.id)).toEqual(['b', 'd']);
  });

  it('counts a row per heading only when headings are on', () => {
    expect(legendRowCount(grouped, {})).toBe(5);
    expect(legendRowCount(grouped, { legendGrouped: true })).toBe(9);
  });
});

describe('regrouping and reordering', () => {
  it('renames the heading an entry sits under', () => {
    const out = applyLegendCustomization(grouped, { legendOverrides: { e: { group: 'Reference' } } });
    expect(out.find((i) => i.id === 'e').group).toBe('Reference');
    // A cleared box is not a rename to nothing.
    const cleared = applyLegendCustomization(grouped, { legendOverrides: { a: { group: '  ' } } });
    expect(cleared.find((i) => i.id === 'a').group).toBe('Mineral Tenure');
  });

  it('puts named ids first and leaves the rest in derived order', () => {
    expect(orderLegendItems(grouped, ['c', 'a']).map((i) => i.id)).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(orderLegendItems(grouped, []).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // An id for a layer that has since been deleted is inert.
    expect(orderLegendItems(grouped, ['gone', 'e']).map((i) => i.id)).toEqual(['e', 'a', 'b', 'c', 'd']);
  });

  it('orders custom entries alongside derived ones', () => {
    const out = applyLegendCustomization(grouped, {
      legendCustomItems: [{ id: 'custom-1', label: 'Mill site', symbol: 'square', color: '#000000' }],
      legendOrder: ['custom-1', 'a'],
    });
    expect(out.map((i) => i.id).slice(0, 2)).toEqual(['custom-1', 'a']);
  });

  it('moves one entry a single step and clamps at the ends', () => {
    expect(moveLegendItem(['a', 'b', 'c'], 'c', 'up')).toEqual(['a', 'c', 'b']);
    expect(moveLegendItem(['a', 'b', 'c'], 'a', 'up')).toEqual(['a', 'b', 'c']);
    expect(moveLegendItem(['a', 'b', 'c'], 'c', 'down')).toEqual(['a', 'b', 'c']);
    expect(moveLegendItem(['a', 'b', 'c'], 'zz', 'down')).toEqual(['a', 'b', 'c']);
  });
});
