import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkerSvgIcon } from '../src/utils/markerIcons.jsx';
import { LEGEND_SYMBOLS, customLegendItem } from '../src/utils/legendCustomization.js';
import { LegendAreaSwatch } from '../src/components/LegendSwatches.jsx';
import { renderVectorsSvg } from '../src/export/renderScene.js';

// The public share page is the copy that matters most: it is what a reader
// actually receives, and its author never sees it.
//
// It carried its own legend swatch with no branch for hexagon or pin, so an
// author could pick hexagon, see a hexagon in the editor and in the exported
// PNG and SVG, and have the share link show a circle. Five hand-written copies
// of one shape table, and this was the last one still behind.
//
// Booting the whole share viewer needs a stored project, so these render the
// swatch component every legend surface now delegates to — with the exact
// styles customLegendItem produces, which is what the surfaces pass it.

const POINT_SYMBOLS = LEGEND_SYMBOLS.filter((s) => s.type === 'points');

function renderSwatchFor(symbol) {
  const item = customLegendItem({ id: 'x', label: 'X', symbol, color: '#123456' });
  const { container } = render(
    <MarkerSvgIcon
      type={item.style.markerShape}
      size={14}
      color={item.style.markerColor}
      fillColor={item.style.markerFill}
    />,
  );
  return container.querySelector('svg');
}

describe('every selectable symbol renders in a shared legend', () => {
  it.each(POINT_SYMBOLS.map((s) => s.value))('%s draws something', (symbol) => {
    const svg = renderSwatchFor(symbol);
    expect(svg, `${symbol} produced no swatch`).toBeTruthy();
    // Geometry, not an empty frame.
    expect(svg.innerHTML.trim().length, `${symbol} rendered an empty swatch`).toBeGreaterThan(0);
  });

  it('draws hexagon and pin as themselves, not as a circle', () => {
    // The two the share page was missing. Named rather than left to the sweep
    // below, because they are the reported defect.
    const circle = renderSwatchFor('circle').innerHTML;
    expect(renderSwatchFor('hexagon').innerHTML, 'hexagon falls back to a circle').not.toBe(circle);
    expect(renderSwatchFor('pin').innerHTML, 'pin falls back to a circle').not.toBe(circle);
  });

  it('gives every point symbol a distinct swatch', () => {
    // Two symbols that render identically would leave a reader unable to tell
    // the entries apart, which is the same failure with a different cause.
    const seen = new Map();
    POINT_SYMBOLS.forEach(({ value }) => {
      const html = renderSwatchFor(value).innerHTML;
      const clash = seen.get(html);
      expect(clash, `"${value}" and "${clash}" render identically`).toBeUndefined();
      seen.set(html, value);
    });
  });

  it('carries the chosen colour through', () => {
    // outerHTML, not innerHTML: the path-based icons (star) colour themselves
    // with a stroke on the <svg> itself rather than on each child, so an
    // innerHTML check reports a working symbol as colourless.
    POINT_SYMBOLS.forEach(({ value }) => {
      const html = renderSwatchFor(value).outerHTML.toLowerCase();
      expect(html, `${value} ignored the chosen colour`).toContain('#123456');
    });
  });
});

// The editor and the share page both draw polygon rows with LegendAreaSwatch.
// A hatched layer used to get a flat tint there; it now gets the map's tile.
// The map and the SVG export build that tile from one description, so at 1x
// the swatch must hold exactly the elements the exported map does.
describe('patterned area swatches', () => {
  const square = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]]] } };
  const mapPattern = (style) => {
    const svg = renderVectorsSvg({
      template: {},
      map: { latLngToContainerPoint: ({ lat, lng }) => ({ x: lng, y: lat }) },
      project: { layers: [{ id: 'l', role: 'property_boundary', type: 'polygon', geojson: { type: 'FeatureCollection', features: [square] }, style }], layout: {} },
    }, 1);
    return new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`, 'image/svg+xml').querySelector('pattern');
  };
  const shapeOf = (pattern) => ({
    size: [pattern.getAttribute('width'), pattern.getAttribute('height')],
    children: [...pattern.children].map((el) => ({
      tag: el.tagName.toLowerCase(),
      attrs: Object.fromEntries([...el.attributes].map((a) => [a.name, a.value])),
    })),
  });

  it.each(['hatch', 'cross', 'dots'])('a %s layer shows the map’s tile', (kind) => {
    const style = { fill: '#aa3300', fillOpacity: 0.5, stroke: '#111111', fillPattern: kind };
    const { container } = render(<LegendAreaSwatch style={style} />);
    const pattern = container.querySelector('pattern');
    expect(pattern, `${kind} swatch has no pattern`).toBeTruthy();
    expect(pattern.children.length).toBeGreaterThan(0);
    expect(shapeOf(pattern)).toEqual(shapeOf(mapPattern(style)));
    expect(container.querySelector('rect').getAttribute('fill')).toBe(`url(#${pattern.id})`);
    // No flat tint behind the tile: the map has none either.
    expect(container.querySelector('.legend-swatch').style.background).toMatch(/none/);
  });

  it('gives each swatch its own pattern id', () => {
    const style = { fillPattern: 'hatch', fill: '#ff0000' };
    const { container } = render(<><LegendAreaSwatch style={style} /><LegendAreaSwatch style={style} /></>);
    const ids = [...container.querySelectorAll('pattern')].map((p) => p.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('leaves a solid swatch as a flat tint with no pattern', () => {
    const { container } = render(<LegendAreaSwatch style={{ fill: '#336699', fillOpacity: 0.3, stroke: '#112233' }} />);
    const swatch = container.querySelector('.legend-swatch');
    expect(swatch.children).toHaveLength(0);
    expect(swatch.style.background).toBe('rgba(51, 102, 153, 0.3)');
  });
});
