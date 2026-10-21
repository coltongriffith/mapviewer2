import { describe, it, expect, vi, beforeAll } from 'vitest';
import { resolveScoredBoxes } from '../src/utils/calloutScorer.js';
import { placeCallouts, calloutCardMetrics, renderCalloutsSvg } from '../src/export/renderScene.js';
import { technicalResultsTemplate } from '../src/templates/technicalResultsTemplate.js';
import { holeIdCallout } from './fixtures/dense-drill-plan.js';

// A layout 3 hole-ID box is sized from the ID measured in the callout font,
// not a per-character guess: a wide ID (WWWWWW-01) used to get an 88 px box
// at 12 px, which the editor wrapped and the canvas and SVG exporters, which
// never split a single word, ran past the box edge (the SVG clips it).

// A stand-in "font" with real wide glyphs: W is a full em.
const GLYPH = (ch) => (/[WM]/.test(ch) ? 1 : /[A-Z]/.test(ch) ? 0.75 : ch === '-' ? 0.45 : 0.62);
const measure = (text, font) => {
  const px = Number(/([\d.]+)px/.exec(font)?.[1]) || 12;
  return [...String(text)].reduce((w, ch) => w + GLYPH(ch) * px, 0);
};
function stubCtx() {
  return new Proxy({ font: '12px Inter' }, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s) => ({ width: measure(s, t.font) }) : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
beforeAll(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => stubCtx()); });

const map = { getSize: () => ({ x: 800, y: 600 }), latLngToContainerPoint: ([lat, lng]) => ({ x: lng, y: lat }), on() {}, off() {}, getContainer: () => null };
const layout = { showTitle: false, showLegend: false, showNorthArrow: false, showScaleBar: false, insetEnabled: false, layoutAlgorithm: 3, fonts: { callout: 'Inter' } };
const wide = { ...holeIdCallout({ hole_id: 'WWWWWW-01', lat: 300, lng: 400 }), type: 'boxed' };
const scene = { width: 800, height: 600, template: technicalResultsTemplate, map, project: { layout, layers: [], callouts: [wide] } };

describe('a wide hole ID fits its box', () => {
  it('the box is never narrower than the measured ID plus padding', () => {
    const [card] = resolveScoredBoxes([wide], map, { algorithm: 3, font: 'Inter' });
    expect(card.fit).toBe(true);
    expect(card.width).toBeGreaterThanOrEqual(measure('WWWWWW-01', '12px') + card.style.paddingX * 2);
    expect(card.width).toBeGreaterThan(88); // the 0.66 em estimate's box
  });

  for (const scale of [1, 3]) {
    it(`canvas export (${scale}x): one line, inside the box`, () => {
      const [c] = placeCallouts(scene, scale);
      const ctx = stubCtx();
      const m = calloutCardMetrics(ctx, c, scale, 'Inter, Arial, sans-serif', false);
      expect(m.titleLines).toEqual(['WWWWWW-01']);
      ctx.font = `700 ${m.fontSize}px Inter`;
      expect(ctx.measureText('WWWWWW-01').width).toBeLessThanOrEqual(m.maxTextW);
    });

    it(`SVG export (${scale}x): one line, inside the clipped box`, () => {
      const svg = renderCalloutsSvg(scene, scale, []);
      const g = /<g id="em-callout-[^"]+" class="em-callout">(.*?)<\/g><\/g>|<g id="em-callout-[^"]+" class="em-callout">(.*)/s.exec(svg)[0];
      const rect = /<rect x="([^"]+)" y="[^"]+" width="([^"]+)"/.exec(g);
      const texts = [...g.matchAll(/<text x="([^"]+)"[^>]*font-size="([^"]+)"[^>]*>([^<]*)<\/text>/g)];
      expect(texts.map((t) => t[3])).toEqual(['WWWWWW-01']);
      const [, x, fontSize] = texts[0];
      expect(Number(x) + measure('WWWWWW-01', `${fontSize}px`)).toBeLessThanOrEqual(Number(rect[1]) + Number(rect[2]));
    });
  }
});
