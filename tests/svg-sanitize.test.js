import { describe, it, expect } from 'vitest';
import { sanitizeSvgDataUrl } from '../src/App.jsx';

// P1-24: uploaded SVG is embedded into saved projects, PUBLIC share snapshots,
// and exported files. It must not execute script or fetch a remote resource.

const wrap = (inner, attrs = '') =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" ${attrs}>${inner}</svg>`,
  )}`;

const clean = (dataUrl) => decodeURIComponent(sanitizeSvgDataUrl(dataUrl).split(',')[1]);

describe('script and active content', () => {
  it('removes <script>', () => {
    expect(clean(wrap('<script>alert(1)</script><rect/>'))).not.toMatch(/script/i);
  });

  it('removes <foreignObject>', () => {
    expect(clean(wrap('<foreignObject><body/></foreignObject>'))).not.toMatch(/foreignObject/i);
  });

  it('removes inline event handlers', () => {
    expect(clean(wrap('<rect onload="alert(1)" onclick="x()"/>'))).not.toMatch(/onload|onclick/i);
  });

  it('removes SMIL animation that can set attributes after load', () => {
    const out = clean(wrap('<rect><set attributeName="href" to="javascript:alert(1)"/></rect>'));
    expect(out).not.toMatch(/<set/i);
  });

  it('removes <animate>', () => {
    expect(clean(wrap('<rect><animate attributeName="x" to="5"/></rect>'))).not.toMatch(/<animate/i);
  });
});

describe('external resource loading', () => {
  it('removes <style> blocks entirely', () => {
    const out = clean(wrap('<style>@import url(https://evil.test/x.css);</style><rect/>'));
    expect(out).not.toMatch(/style|@import|evil/i);
  });

  it('strips style attributes containing url()', () => {
    const out = clean(wrap('<rect style="fill:url(https://evil.test/a.png)"/>'));
    expect(out).not.toMatch(/evil\.test/);
  });

  it('removes external <image> references', () => {
    expect(clean(wrap('<image href="https://evil.test/a.png"/>'))).not.toMatch(/evil\.test/);
  });

  it('removes protocol-relative references', () => {
    expect(clean(wrap('<image href="//evil.test/a.png"/>'))).not.toMatch(/evil\.test/);
  });

  it('strips external filter references', () => {
    const out = clean(wrap('<rect filter="url(https://evil.test/f.svg#x)"/>'));
    expect(out).not.toMatch(/evil\.test/);
  });

  it('strips javascript: hrefs', () => {
    // eslint-disable-next-line no-script-url
    const out = clean(wrap('<a href="javascript:alert(1)"><rect/></a>'));
    expect(out).not.toMatch(/javascript:/i);
  });
});

describe('what it preserves', () => {
  it('keeps ordinary shapes and colours', () => {
    const out = clean(wrap('<rect width="10" height="10" fill="#ff0000"/>'));
    expect(out).toMatch(/<rect/);
    expect(out).toMatch(/#ff0000/);
  });

  it('keeps internal fragment references (gradients, local filters)', () => {
    const out = clean(wrap(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>'
      + '<rect fill="url(#g)"/>',
    ));
    expect(out).toMatch(/linearGradient/);
    expect(out).toMatch(/url\(#g\)/);
  });
});

describe('rejection cases', () => {
  it('rejects a non-SVG document masquerading as one', () => {
    const html = `data:image/svg+xml,${encodeURIComponent('<html><body>hi</body></html>')}`;
    expect(sanitizeSvgDataUrl(html)).toBeNull();
  });

  it('rejects malformed XML', () => {
    const bad = `data:image/svg+xml,${encodeURIComponent('<svg><rect>')}`;
    expect(sanitizeSvgDataUrl(bad)).toBeNull();
  });

  it('rejects an oversized payload', () => {
    const huge = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg">${'<rect/>'.repeat(400000)}</svg>`)}`;
    expect(sanitizeSvgDataUrl(huge)).toBeNull();
  });

  it('passes through non-SVG data URLs untouched', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sanitizeSvgDataUrl(png)).toBe(png);
  });

  it('tolerates non-string input', () => {
    expect(sanitizeSvgDataUrl(null)).toBeNull();
    expect(sanitizeSvgDataUrl(undefined)).toBeUndefined();
  });
});
