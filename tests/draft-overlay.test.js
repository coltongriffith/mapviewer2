import { describe, it, expect, afterEach, vi } from 'vitest';
import { drawDraftOverlay, withDraftOverlaySvg, withWatermarkBandSvg, draftGrid, DRAFT_TEXT, DRAFT_ALPHA, BAND_COLORS } from '../src/export/watermarkBand.js';

// The draft mark across an exported figure (the owner's follow-up to item 38): it cannot simply be cropped off as
// the band can. Tiled at −30°, faint, ink over light ground and cream over dark.

// A 2D context that records the marks drawn (text is 0.5 em a character wide); `canvas` is the figure it reads.
function recorder(canvas = {}) {
  const marks = [], state = { font: '10px sans', letterSpacing: '0px', globalAlpha: 1, fillStyle: '#000', canvas };
  let at = null;
  const size = () => parseFloat(/([\d.]+)px/.exec(state.font)[1]);
  return { marks, ctx: new Proxy(state, { get(t, k) {
    if (k === 'measureText') return (s) => ({ width: String(s).length * size() * 0.5 });
    if (k === 'translate') return (x, y) => { at = [x, y]; };
    if (k === 'fillText') return (s) => marks.push({ s, at, alpha: t.globalAlpha, fill: t.fillStyle, size: size() });
    return k in t ? t[k] : () => {};
  }, set(t, k, v) { t[k] = v; return true; } }) };
}
afterEach(() => vi.restoreAllMocks());

describe('the draft mark on a canvas', () => {
  it('repeats the text over the whole figure, faint, at a size and pitch that leave the map readable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); // nothing to sample: ink everywhere
    const { ctx, marks } = recorder();
    drawDraftOverlay(ctx, 2000, 1250);
    expect(marks.length).toBeGreaterThan(12);
    expect(marks.length).toBeLessThan(80);
    marks.forEach((m) => { expect(m.s).toBe(DRAFT_TEXT); expect(m.alpha).toBe(DRAFT_ALPHA.ink); expect(m.fill).toBe(BAND_COLORS.ink); });
    expect(marks[0].size).toBe(Math.round(1875 / 52)); // from the shorter side
    // Spread over the figure: some mark starts in each quarter.
    const q = (fx, fy) => marks.some(({ at: [x, y] }) => (x < 1000) === fx && (y < 625) === fy);
    expect([q(true, true), q(true, false), q(false, true), q(false, false)]).toEqual([true, true, true, true]);
  });

  it('takes cream, a little stronger, over dark ground', () => {
    // The figure as sampled: black throughout.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : 10)) }) });
    const { ctx, marks } = recorder();
    drawDraftOverlay(ctx, 1200, 800);
    expect(marks.length).toBeGreaterThan(5);
    marks.forEach((m) => { expect(m.fill).toBe(BAND_COLORS.cream); expect(m.alpha).toBe(DRAFT_ALPHA.cream); });
  });

  it('keeps its alphas in the faint 8-14 % range', () => {
    Object.values(DRAFT_ALPHA).forEach((a) => { expect(a).toBeGreaterThanOrEqual(0.08); expect(a).toBeLessThanOrEqual(0.14); });
  });
});

describe('the draft mark in an SVG', () => {
  const ctx = { font: '', letterSpacing: '0px', save() {}, restore() {}, measureText(s) { return { width: String(s).length * parseFloat(/([\d.]+)px/.exec(this.font)[1]) * 0.5 }; } };
  const doc = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><g id="em-map-content"></g></svg>';
  it('is a pattern of the mark and live text filling one rect over the whole figure', () => {
    const out = withDraftOverlaySvg(doc, { ctx });
    const g = draftGrid(1600, 1000, (size) => DRAFT_TEXT.length * size * 0.5 + DRAFT_TEXT.length * size * 0.12);
    expect(out).toContain('<pattern id="em-draft-mark" patternUnits="userSpaceOnUse"');
    expect(out).toContain('rotate(-30)');
    expect(out).toContain(`>${DRAFT_TEXT}</text>`);
    expect(out).toContain(`font-size="${g.size}"`);
    expect(out).toMatch(/<rect id="em-draft-overlay" x="0" y="0" width="1600" height="1000" fill="url\(#em-draft-mark\)" fill-opacity="0\.13" pointer-events="none"\/><\/svg>$/);
    expect(out.startsWith(doc.slice(0, -'</svg>'.length))).toBe(true); // the figure untouched under it
  });
  it('stops at the figure: the band goes under it, outside the mark', () => {
    const out = withWatermarkBandSvg(withDraftOverlaySvg(doc, { ctx }), { year: 2026, ctx });
    expect(out).toMatch(/height="1100" viewBox="0 0 1600 1100"/);
    expect(out.indexOf('em-draft-overlay')).toBeLessThan(out.indexOf('em-watermark-band'));
    expect(out).toContain('<rect id="em-draft-overlay" x="0" y="0" width="1600" height="1000"');
  });
});
