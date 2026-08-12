import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkerSvgIcon } from '../src/utils/markerIcons.jsx';
import { LEGEND_SYMBOLS, customLegendItem } from '../src/utils/legendCustomization.js';

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
