import { describe, it, expect } from 'vitest';
import {
  renderInsetSvg, renderLegendSvg, legendSwatchSvg, baselineFromTop, renderVectorsSvg,
} from '../src/export/renderScene.js';

// The PNG and SVG exports are two hand-written renderers of one layout, and
// they had drifted. The SVG had no satellite-locator branch at all, so a
// project using the locator silently exported the old vector cartoon instead
// of the imagery on screen; several panels used hand-picked baselines that
// only agreed with the canvas at one font size; and the legend ignored
// transparency outright.
//
// These lock the SVG side to what the canvas does. They are deliberately about
// positions and presence, not appearance — appearance is what nobody checks.

function scene(layout = {}) {
  return {
    width: 1000,
    height: 800,
    template: { id: 'technical_results' },
    project: {
      layout: {
        insetTitle: 'Inset Map',
        insetLabel: 'Saskatchewan',
        ...layout,
      },
      layers: [],
    },
  };
}

const attr = (svg, tag, name) => {
  const m = new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`).exec(svg);
  return m ? m[1] : null;
};

describe('renderInsetSvg — satellite locator', () => {
  it('embeds the rasterised locator instead of the vector cartoon', () => {
    const svg = renderInsetSvg(
      scene({ insetMode: 'satellite_locator', autoInsetRegion: { name: 'Saskatchewan', bbox: [-110, 49, -101, 60], coordinates: [] } }),
      1, [], 'data:image/png;base64,AAAA',
    );
    expect(svg).toContain('<image');
    expect(svg).toContain('data:image/png;base64,AAAA');
    // The vector locator's backdrop gradient must not also be drawn.
    expect(svg).not.toContain('locatorBg');
  });

  it('clips the imagery to the panel so it cannot bleed past the card', () => {
    const defs = [];
    const svg = renderInsetSvg(
      scene({ insetMode: 'satellite_locator', autoInsetRegion: { name: 'Saskatchewan', bbox: [-110, 49, -101, 60], coordinates: [] } }),
      1, defs, 'data:image/png;base64,AAAA',
    );
    expect(attr(svg, 'image', 'clip-path')).toMatch(/^url\(#/);
    expect(defs.join('')).toContain('<clipPath');
  });

  it('names the jurisdiction, as the PNG does', () => {
    const svg = renderInsetSvg(
      scene({ insetMode: 'satellite_locator', autoInsetRegion: { name: 'Saskatchewan', bbox: [-110, 49, -101, 60], coordinates: [] } }),
      1, [], 'data:image/png;base64,AAAA',
    );
    expect(svg).toContain('Saskatchewan');
    expect(svg).toContain('Inset Map');
  });

  it('falls back to the vector locator when the imagery could not be captured', () => {
    // Tiles blocked, or a tainted canvas. An empty panel would be worse than
    // the cartoon, and worse than what the canvas path does.
    const svg = renderInsetSvg(
      scene({ insetMode: 'satellite_locator', autoInsetRegion: { name: 'Saskatchewan', bbox: [-110, 49, -101, 60], coordinates: [] } }),
      1, [], null,
    );
    expect(svg).not.toContain('<image');
    expect(svg).toContain('Saskatchewan');
  });
});

describe('legendSwatchSvg', () => {
  const at = (item, s = 2) => legendSwatchSvg(item, 100, 200, s);

  it('scales the dash pattern, not just the line', () => {
    // The dash array was passed through unscaled, so a dashed legend line came
    // out with a much finer pattern than the same layer on the map.
    const svg = at({ type: 'line', style: { stroke: '#000000', dashArray: '6 3' } }, 2);
    expect(attr(svg, 'line', 'stroke-dasharray')).toBe('12 6');
  });

  it('scales the line width', () => {
    const svg = at({ type: 'line', style: { stroke: '#000000', strokeWidth: 4 } }, 2);
    // 4 * 0.6 * 2 = 4.8, against a floor of `scale`.
    expect(Number(attr(svg, 'line', 'stroke-width'))).toBeCloseTo(4.8, 2);
  });

  it('puts the polygon swatch where the canvas puts it', () => {
    const svg = at({ type: 'polygon', style: {} }, 2);
    // rowY + swatchY * scale = 200 + 2*2
    expect(Number(attr(svg, 'rect', 'y'))).toBe(204);
    expect(Number(attr(svg, 'rect', 'height'))).toBe(24);
  });

  it('puts the line swatch where the canvas puts it', () => {
    const svg = at({ type: 'line', style: {} }, 2);
    // rowY + lineY * scale = 200 + 8*2. It was drawn a scaled pixel lower.
    expect(Number(attr(svg, 'line', 'y1'))).toBe(216);
  });

  it('uses the same default polygon fill as the canvas', () => {
    expect(attr(at({ type: 'polygon', style: {} }), 'rect', 'fill')).toBe('#93c5fd');
  });
});

describe('renderLegendSvg', () => {
  const items = [{ type: 'polygon', label: 'Hatchet Lake', style: {} }];

  it('honours a transparent legend', () => {
    const opaque = renderLegendSvg(scene({ legendItems: items }), 1, []);
    const clear = renderLegendSvg(scene({ legendItems: items, legendTransparent: true }), 1, []);
    // The panel card is drawn for one and not the other; both keep the text.
    expect(opaque).toContain('Hatchet Lake');
    expect(clear).toContain('Hatchet Lake');
    expect(clear.match(/<rect/g).length).toBeLessThan(opaque.match(/<rect/g).length);
  });

  it('centres row labels rather than pinning them to a baseline', () => {
    // A fixed alphabetic baseline stayed put while the canvas re-centred, so
    // the labels slid against their swatches at any legendFontScale but 1.
    const svg = renderLegendSvg(scene({ legendItems: items }), 1, []);
    expect(svg).toContain('dominant-baseline="middle"');
  });

  it('moves the title baseline with the font scale, as the canvas does', () => {
    const svgDefs = [];
    const small = renderLegendSvg(scene({ legendItems: items, legendFontScale: 1 }), 1, svgDefs);
    const large = renderLegendSvg(scene({ legendItems: items, legendFontScale: 2 }), 1, svgDefs);
    const titleY = (s) => Number(/<text[^>]*font-weight="700"[^>]*y="([\d.]+)"/.exec(s)?.[1]
      ?? /y="([\d.]+)"[^>]*font-weight="700"/.exec(s)?.[1]);
    // The canvas keeps the TOP of the title fixed, so a larger font pushes the
    // baseline down. A hardcoded y would have made these equal.
    expect(titleY(large)).toBeGreaterThan(titleY(small));
  });
});

describe('baselineFromTop', () => {
  it('drops the baseline in proportion to the font size', () => {
    expect(baselineFromTop(100, 10)).toBeCloseTo(108, 5);
    expect(baselineFromTop(100, 20)).toBeCloseTo(116, 5);
  });
});

describe('legend headings and swatches in the SVG', () => {
  const items = [
    { id: 'a', type: 'polygon', label: 'Property', group: 'Mineral Tenure', style: { dashArray: '8 5' } },
    { id: 'b', type: 'points', label: 'Discovery Zone', group: 'Project Areas', style: { customMarkerDataUri: 'data:image/png;base64,AAAA' } },
  ];

  it('draws no heading unless headings are on', () => {
    expect(renderLegendSvg(scene({ legendItems: items }), 1, [])).not.toContain('em-legend-heading');
  });

  it('draws one heading per group, and pushes rows down to make room', () => {
    const svg = renderLegendSvg(scene({ legendItems: items, legendGrouped: true }), 1, []);
    expect(svg.match(/em-legend-heading/g).length).toBe(2);
    expect(svg).toContain('MINERAL TENURE');
    expect(svg).toContain('PROJECT AREAS');
    const flat = renderLegendSvg(scene({ legendItems: items }), 1, []);
    // Offset of the first swatch from the top of the legend card: the card is
    // bottom-anchored in this template, so it grows upward as rows are added.
    const panelY = (s) => Number(/<rect[^>]* y="([\d.]+)"/.exec(s)[1]);
    const firstRowY = (s) => Number(/class="em-legend-item"><rect x="[\d.]+" y="([\d.]+)"/.exec(s)[1]);
    expect(firstRowY(svg) - panelY(svg)).toBeGreaterThan(firstRowY(flat) - panelY(flat));
  });

  it('dashes a dashed layer’s polygon swatch, as the editor does', () => {
    const svg = legendSwatchSvg(items[0], 100, 200, 2);
    expect(svg).toContain('stroke-dasharray=');
    expect(legendSwatchSvg({ type: 'polygon', style: {} }, 100, 200, 2)).not.toContain('stroke-dasharray=');
  });

  it('shows an uploaded icon instead of a shape', () => {
    const svg = legendSwatchSvg(items[1], 100, 200, 2);
    expect(svg).toContain('<image');
    expect(svg).toContain('data:image/png;base64,AAAA');
  });
});

describe('patterned polygon swatches', () => {
  // A hatched layer drew hatched on the map and as a flat tint in every
  // legend. The swatch now carries the map's own tile; these compare the two
  // as the SVG writes them, ids and placement aside.
  const square = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]]] } };
  const layerOf = (id, style) => ({ id, name: id, role: 'property_boundary', type: 'polygon', geojson: { type: 'FeatureCollection', features: [square] }, style });
  const mapScene = (layers) => ({
    template: {},
    map: { latLngToContainerPoint: ({ lat, lng }) => ({ x: lng, y: lat }) },
    project: { layers, layout: {} },
  });
  const patterns = (svg) => [...svg.matchAll(/<pattern id="([^"]+)"[^>]*>(.*?)<\/pattern>/g)].map((m) => ({ id: m[1], body: m[2] }));

  it.each(['hatch', 'cross', 'dots'])('a %s swatch holds the tile the map is filled with', (kind) => {
    const style = { fill: '#aa3300', fillOpacity: 0.5, stroke: '#111111', fillPattern: kind, fillPatternSpacing: 5 };
    [1, 2].forEach((s) => {
      const [onMap] = patterns(renderVectorsSvg(mapScene([layerOf('claims', style)]), s));
      const defs = [];
      const swatch = legendSwatchSvg({ type: 'polygon', style }, 100, 200, s, defs);
      const [inLegend] = patterns(defs.join(''));
      expect(inLegend.body, `${kind} at ${s}x`).toBe(onMap.body);
      expect(inLegend.body.length).toBeGreaterThan(0);
      expect(attr(swatch, 'rect', 'fill')).toBe(`url(#${inLegend.id})`);
      // The tile starts at the swatch's corner, as it does in the editor.
      expect(defs.join('')).toContain(`x="100.00" y="${(200 + 2 * s).toFixed(2)}"`);
    });
  });

  it('gives every swatch its own pattern id, across two legends', () => {
    const items = [
      { id: 'a', type: 'polygon', label: 'Hatched', style: { fillPattern: 'hatch', fill: '#ff0000' } },
      { id: 'b', type: 'polygon', label: 'Dotted', style: { fillPattern: 'dots', fill: '#0000ff' } },
    ];
    const svgDefs = [];
    const first = renderLegendSvg(scene({ legendItems: items }), 1, svgDefs);
    const second = renderLegendSvg(scene({ legendItems: items }), 1, svgDefs);
    const ids = patterns(svgDefs.join('')).map((p) => p.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    // Each legend points at its own two.
    const refs = (svg) => [...svg.matchAll(/fill="url\(#([^)]+)\)"/g)].map((m) => m[1]);
    expect(refs(first)).toHaveLength(2);
    expect(refs(second).filter((id) => refs(first).includes(id))).toEqual([]);
  });

  it('names map patterns per layer, so two layers cannot share an id', () => {
    // Same kind, spacing and colour, different opacity: the old id came from
    // the first three only, so the second layer printed in the first's opacity.
    const svg = renderVectorsSvg(mapScene([
      layerOf('a', { fillPattern: 'hatch', fill: '#ff0000', fillOpacity: 0.2 }),
      layerOf('b', { fillPattern: 'hatch', fill: '#ff0000', fillOpacity: 0.9 }),
    ]), 1);
    const ids = patterns(svg).map((p) => p.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('leaves a solid swatch exactly as it was', () => {
    const style = { fill: '#336699', fillOpacity: 0.3, stroke: '#112233' };
    const defs = [];
    expect(legendSwatchSvg({ type: 'polygon', style }, 100, 200, 2, defs)).toBe(
      '<rect x="100.00" y="204.00" width="36.00" height="24.00" fill="#336699" fill-opacity="0.3" stroke="#112233" stroke-width="2.00" />',
    );
    expect(defs).toEqual([]);
    expect(legendSwatchSvg({ type: 'polygon', style: { ...style, fillPattern: 'none' } }, 100, 200, 2)).not.toContain('<pattern');
  });
});
