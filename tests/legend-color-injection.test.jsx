import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkerSvgIcon, markerShapeInner, markerIconSvgFragment } from '../src/utils/markerIcons.jsx';
import { customLegendItem, LEGEND_SYMBOLS } from '../src/utils/legendCustomization.js';

// A legend colour on a shared map is untrusted input.
//
// markerShapeInner returns raw SVG markup, and MarkerSvgIcon installs it with
// dangerouslySetInnerHTML. A colour carrying a quote and a tag therefore
// escapes its attribute and injects arbitrary elements. Two of the three
// callers sanitised and the third did not — and the third is the one the
// public share viewer reaches, where the payload's author and its reader are
// not the same person and the share RPC checks only size and top-level shape.
//
// Reproduced before fixing: `#000" /><rect width="9999" height="9999"
// fill="red"` rendered a full-bleed red overlay across the panel. CSP blocks
// inline script, but it does not stop content manipulation or a convincing
// fake banner over someone else's map.

const PAYLOADS = [
  ['attribute break + element', '#000" /><rect width="9999" height="9999" fill="red" data-pwned="1'],
  ['script tag', '#000"><script>window.__pwned=1</script><rect data-pwned="1" fill="'],
  ['event handler', '#000" onload="window.__pwned=1" data-pwned="1'],
  ['foreignObject', '#000" /><foreignObject data-pwned="1"><div>hi</div></foreignObject><rect fill="'],
  ['closing svg', '#000" /></svg><div data-pwned="1">outside</div><svg><rect fill="'],
  ['unclosed quote', '#000'],
  ['url()', 'url(javascript:alert(1))'],
  ['expression', 'expression(alert(1))'],
];

const POINT_SHAPES = LEGEND_SYMBOLS.filter((s) => s.type === 'points').map((s) => s.value);

function renderWith(shape, color, fillColor) {
  const { container } = render(
    <MarkerSvgIcon type={shape} size={14} color={color} fillColor={fillColor} />,
  );
  return container;
}

describe('a hostile legend colour cannot inject markup', () => {
  it.each(PAYLOADS)('%s — via markerColor', (_name, payload) => {
    const container = renderWith('square', payload, '#ffffff');
    expect(container.querySelector('[data-pwned]'), container.innerHTML).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('foreignObject')).toBeNull();
  });

  it.each(PAYLOADS)('%s — via markerFill', (_name, payload) => {
    const container = renderWith('square', '#000000', payload);
    expect(container.querySelector('[data-pwned]'), container.innerHTML).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('holds for every symbol the picker offers, not just the one tested', () => {
    const payload = '#000" /><rect width="9999" height="9999" data-pwned="1" fill="red';
    POINT_SHAPES.forEach((shape) => {
      const container = renderWith(shape, payload, payload);
      expect(container.querySelector('[data-pwned]'), `${shape} let markup through`).toBeNull();
    });
  });

  it('is enforced by the string builder, not only by its callers', () => {
    // The durable placement. Sanitising at each call site is what left the gap:
    // two callers did it, one did not.
    const markup = markerShapeInner('square', 10, 10, 8, '#000" /><rect data-pwned="1', '#fff');
    expect(markup).not.toContain('data-pwned');
  });

  it('is enforced for the SVG export fragment too', () => {
    // Exported .svg files are opened by other people in other programs.
    const markup = markerIconSvgFragment('square', 10, 10, 16, '#000" /><rect data-pwned="1', '#fff');
    expect(markup).not.toContain('data-pwned');
  });

  it('sanitises at the data boundary as well', () => {
    // Defence in depth: a hostile payload should not even reach a renderer.
    const item = customLegendItem({ id: 'x', label: 'X', symbol: 'square', color: '"><script>x</script>' });
    expect(item.style.markerColor).not.toContain('<');
    expect(item.style.markerFill).not.toContain('<');
  });

  it('still lets ordinary colours through unchanged', () => {
    // A sanitiser that eats valid input is its own outage.
    ['#123456', '#abc', 'rgb(1, 2, 3)', 'rgba(1, 2, 3, 0.5)', 'red', 'darkslateblue'].forEach((c) => {
      const item = customLegendItem({ id: 'x', label: 'X', symbol: 'square', color: c });
      expect(item.style.markerColor, `${c} was rejected`).toBe(c);
    });
  });

  it('renders a visible swatch even when the colour is rejected', () => {
    // Falling back to nothing would turn an injection attempt into a blank
    // legend, which is its own kind of broken map.
    const container = renderWith('square', 'javascript:alert(1)', 'javascript:alert(1)');
    const rect = container.querySelector('rect');
    expect(rect).toBeTruthy();
    expect(rect.getAttribute('fill')).toMatch(/^#/);
  });
});
