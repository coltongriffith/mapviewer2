import { describe, it, expect } from 'vitest';
import { bandHeight, bandText, drawWatermarkBand, BAND_STATUS } from '../src/export/watermarkBand.js';
import { findBackground, removeBackground } from '../src/utils/logoBackground.js';
import { fitAxes } from '../src/three-d/geology.js';
import { init, setBlock, BLOCK, compass8 } from '../src/three-d/block.js';
import { joinIncl } from '../src/three-d/tags.js';

// Exploration Maps 3D round 5G: the watermark band (shared), logo background removal (shared), a section image fitted
// by known points, and the block section's side title.

// A 2D context that records what is drawn; text is 0.5 em a character wide.
function recorder() {
  const texts = [], ctx = { font: '10px sans', letterSpacing: '0px' };
  const size = () => parseFloat(/([\d.]+)px/.exec(ctx.font)[1]);
  return new Proxy(ctx, { get(t, k) {
    if (k === 'texts') return texts;
    if (k === 'measureText') return (s) => ({ width: String(s).length * size() * 0.5 });
    if (k === 'fillText') return (s, x, y) => texts.push({ s, x, y, size: size(), font: t.font });
    return k in t ? t[k] : () => {};
  }, set(t, k, v) { t[k] = v; return true; } });
}

describe('watermark band', () => {
  it('is sized from the width, as the reference band (880 × 55)', () => {
    expect(bandHeight(880)).toBe(55);
    expect(bandHeight(3484)).toBe(218);
    expect(bandHeight(100)).toBe(24); // never under 24 px
  });
  it('says who it was prepared for, with the year', () => {
    expect(bandText({ client: 'Tower Resources Ltd. · TSXV: TWR', year: 2026 })).toEqual({ status: BAND_STATUS,
      note: 'Prepared for Tower Resources Ltd. by Exploration Maps. Not licensed for use or redistribution without written permission. © 2026 Exploration Maps' });
    expect(bandText({ year: '2025' }).note).toMatch(/^Prepared by Exploration Maps\. .*© 2025 Exploration Maps$/);
    expect(bandText().note).toContain(`© ${new Date().getFullYear()} `);
    expect(bandText({ status: 'Draft' }).status).toBe('DRAFT');
  });
  it('draws the wordmark, the status and the note inside the band', () => {
    const ctx = recorder(), h = drawWatermarkBand(ctx, 0, 1000, 1760, { client: 'Tower Resources', year: 2026 }), t = ctx.texts;
    expect(h).toBe(110);
    expect(t.map((x) => x.s)).toEqual(['Exploration', 'Maps', 'EXPLORATIONMAPS.COM', BAND_STATUS, expect.stringContaining('Prepared for Tower Resources by Exploration Maps.')]);
    expect(t.find((x) => x.s === 'Exploration').font).toMatch(/^300 /); // "Exploration" light, "Maps" bold
    expect(t.find((x) => x.s === 'Maps').font).toMatch(/^700 /);
    t.forEach((x) => { expect(x.y).toBeGreaterThan(1000); expect(x.y).toBeLessThan(1000 + h); });
  });
  it('shrinks, then cuts, a note too long for the band', () => {
    const ctx = recorder(); drawWatermarkBand(ctx, 0, 0, 900, { client: 'A'.repeat(400), year: 2026 });
    const note = ctx.texts.at(-1);
    expect(note.s.endsWith('…')).toBe(true);
    expect(note.x + note.s.length * note.size * 0.5).toBeLessThanOrEqual(900);
  });
});

// RGBA pixels: a white logo background, a red square with a white dot inside it, and a soft pink edge.
function logo(w = 20, h = 12, bg = [255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) { const x = p % w, y = Math.floor(p / w), inSq = x >= 5 && x < 15 && y >= 3 && y < 9, edge = x === 4 && y >= 3 && y < 9, dot = x === 10 && y === 6;
    data.set(dot ? [255, 255, 255, 255] : inSq ? [200, 20, 20, 255] : edge ? [250, 220, 220, 255] : [...bg, 255], p * 4); }
  return { data, width: w, height: h };
}
const px = (im, x, y) => [...im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];

describe('logo background removal', () => {
  it('finds a flat background round the logo', () => {
    expect(findBackground(logo())).toEqual({ color: [255, 255, 255], share: 1 });
    expect(findBackground(logo(20, 12, [240, 238, 230])).color).toEqual([240, 238, 230]); // an off-white or flat tint too
  });
  it('finds none on a busy or already transparent border', () => {
    const busy = logo(); for (let x = 0; x < 20; x += 2) busy.data.set([0, 90, 200, 255], x * 4); for (let y = 0; y < 12; y += 2) busy.data.set([0, 90, 200, 255], (y * 20) * 4);
    expect(findBackground(busy)).toBe(null);
    const clear = logo(); for (let p = 0; p < 240; p++) clear.data[p * 4 + 3] = 0;
    expect(findBackground(clear)).toBe(null);
  });
  it('clears the background from the border only, keeping the same colour inside the logo, with a soft edge', () => {
    const im = logo(), share = removeBackground(im, [255, 255, 255]);
    expect(px(im, 0, 0)[3]).toBe(0);
    expect(px(im, 10, 6)).toEqual([255, 255, 255, 255]); // the white dot inside the red square stays
    expect(px(im, 7, 4)).toEqual([200, 20, 20, 255]);
    const e = px(im, 4, 5); expect(e[3]).toBeGreaterThan(0); expect(e[3]).toBeLessThan(255); expect(e[1]).toBeLessThan(180); // the pink edge: part transparent, its white taken out
    expect(share).toBeCloseTo((240 - 60 - 6) / 240, 5);
  });
});

describe('section image fit', () => {
  it('fits across and up separately from two points, so vertical exaggeration fits', () => {
    const f = fitAxes([{ px: [100, 50], d: 0, z: 1500 }, { px: [500, 450], d: 200, z: 1300 }]);
    expect(f.sx).toBeCloseTo(0.5); expect(f.ox).toBeCloseTo(-50); expect(f.sz).toBeCloseTo(-0.5); expect(f.oz).toBeCloseTo(1525); expect(f.rms).toBeCloseTo(0); expect(f.n).toBe(2);
    const ve = fitAxes([{ px: [0, 0], d: 0, z: 1500 }, { px: [100, 100], d: 100, z: 1450 }]);
    expect(ve.sx).toBeCloseTo(1); expect(ve.sz).toBeCloseTo(-0.5);
  });
  it('least squares with three points or more, and their misfit in metres', () => {
    const f = fitAxes([{ px: [0, 0], d: 0, z: 100 }, { px: [100, 100], d: 100, z: 0 }, { px: [50, 50], d: 53, z: 53 }]);
    expect(f.sx).toBeCloseTo(1); expect(f.ox).toBeCloseTo(1); expect(f.rms).toBeCloseTo(2); // misfits 1, 1 and 2 m on each axis
  });
  it('refuses too few points, or points in a line across or up', () => {
    expect(() => fitAxes([{ px: [0, 0], d: 0, z: 0 }])).toThrow(/two points or more/);
    expect(() => fitAxes([{ px: [0, 0], d: 0, z: 0 }, { px: [0, 100], d: 0, z: -50 }])).toThrow(/apart both across and up/);
    expect(() => fitAxes([{ px: [0, 0], d: 0, z: 0 }, { px: [100, 0], d: 50, z: 0 }])).toThrow(/apart both across and up/);
  });
});

describe('side title layout', () => {
  const host = (block) => { const S = { holesShown: null, block }; init({ S, G: {}, project: { holes: [] }, rebuild: () => {}, setStyle: () => {}, renderExtUI: () => {}, status: () => {} }); return S; };
  it('takes page "side" and an info line, and refuses an unknown page', () => {
    const S = host({ ...structuredClone(BLOCK), page: 'side' });
    setBlock({ info: '3D cutaway · looking SW · Rabbit North, B.C.' }); expect(S.block.info).toBe('3D cutaway · looking SW · Rabbit North, B.C.');
    setBlock({ info: '' }); expect(S.block.info).toBe(''); // no info line
    setBlock({ info: null }); expect('info' in S.block).toBe(false); // automatic again
    expect(() => setBlock({ page: 'left' })).toThrow(/"side" \(a large title block at the left/);
  });
  it('a block made before this round has no side title', () => {
    expect(BLOCK.page).toBe('bare'); expect('info' in BLOCK).toBe(false);
  });
  it('names the view in eight points of the compass', () => {
    expect([0, 44, 90, 226, 315, 359, -45].map(compass8)).toEqual(['N', 'NE', 'E', 'SW', 'NW', 'N', 'NW']);
  });
});

describe('bracket callout incl. line', () => {
  it('joins several incl. results with " & ", the shared unit once at the end, as the reference', () => {
    expect(joinIncl('incl. 3.6 m @ 4.15 g/t Au; incl. 10.0 m @ 2.29 g/t Au')).toBe('incl. 3.6 m @ 4.15 & 10.0 m @ 2.29 g/t Au');
    expect(joinIncl('incl. 2 m @ 1.2% Cu; incl. 4 m @ 3.1 g/t Au')).toBe('incl. 2 m @ 1.2% Cu & 4 m @ 3.1 g/t Au'); // units differ: each kept
    expect(joinIncl('incl. 3.6 m @ 4.15 g/t Au from 70 m; incl. 1 m @ 9 g/t Au from 80 m')).toBe('incl. 3.6 m @ 4.15 g/t Au from 70 m & 1 m @ 9 g/t Au from 80 m');
  });
  it('keeps one result, or none, as it is', () => {
    expect(joinIncl('incl. 8.0 m @ 7.16 g/t Au')).toBe('incl. 8.0 m @ 7.16 g/t Au');
    expect(joinIncl(null)).toBe(null);
  });
});
