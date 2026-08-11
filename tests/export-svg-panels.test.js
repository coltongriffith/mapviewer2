import { describe, it, expect } from 'vitest';
import {
  renderInsetSvg, renderLegendSvg, legendSwatchSvg, baselineFromTop,
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
