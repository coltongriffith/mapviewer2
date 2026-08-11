import { describe, it, expect } from 'vitest';
import { serializeOverlaySvg } from '../src/export/renderScene.js';

// The satellite locator's outline and marker reach the export by being
// serialised out of Leaflet's live overlay pane and rasterised. That step has
// one way to go wrong that no amount of "did anything draw?" checking can see:
// the picture comes out complete but in the wrong PLACE, while the imagery
// under it stays put.
//
// It went wrong exactly that way. Leaflet gives the overlay <svg> an inline
// transform AND a viewBox whose origin matches it. On the page they compose
// into one offset. Serialised alone, the transform applies a second time and
// the whole overlay shifts by the pad — around 22x13px in a 220x132 inset, so
// the project marker no longer sits on its own ground.

function overlaySvg({ transform = 'translate(-22px, -13px)' } = {}) {
  // Shaped like the real thing: Leaflet sets viewBox to "minX minY w h" and
  // positions the element with a matching transform.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-22 -13 264 158');
  svg.style.transform = transform;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M0 0 L100 0 L100 60 Z');
  path.setAttribute('stroke', '#ffffff');
  svg.appendChild(path);
  return svg;
}

function decode(uri) {
  return decodeURIComponent(uri.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
}

describe('serializeOverlaySvg', () => {
  it('drops the element transform, which would otherwise be applied twice', () => {
    const markup = decode(serializeOverlaySvg(overlaySvg(), 264, 158));
    // The root must carry no transform. The viewBox already positions the
    // drawing; keeping the transform as well displaces the export.
    const root = markup.slice(0, markup.indexOf('>') + 1);
    expect(root).not.toMatch(/transform/i);
  });

  it('keeps the viewBox, which is what positions the drawing', () => {
    const markup = decode(serializeOverlaySvg(overlaySvg(), 264, 158));
    expect(markup).toContain('viewBox="-22 -13 264 158"');
  });

  it('sizes the image to the measured rect and declares the namespace', () => {
    const markup = decode(serializeOverlaySvg(overlaySvg(), 264, 158));
    expect(markup).toContain('width="264"');
    expect(markup).toContain('height="158"');
    expect(markup).toContain('http://www.w3.org/2000/svg');
  });

  it('carries the drawn geometry through', () => {
    const markup = decode(serializeOverlaySvg(overlaySvg(), 264, 158));
    expect(markup).toContain('M0 0 L100 0 L100 60 Z');
  });

  it('does not mutate the live element it copies', () => {
    // It runs against the map the user is looking at. Stripping the transform
    // from the original rather than the clone would move the on-screen inset.
    const svg = overlaySvg();
    serializeOverlaySvg(svg, 264, 158);
    expect(svg.style.transform).toBe('translate(-22px, -13px)');
  });

  it('is unbothered by an overlay that has no transform', () => {
    const markup = decode(serializeOverlaySvg(overlaySvg({ transform: '' }), 264, 158));
    expect(markup).toContain('viewBox="-22 -13 264 158"');
    expect(markup).toContain('M0 0 L100 0 L100 60 Z');
  });
});
