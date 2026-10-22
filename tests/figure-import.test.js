import { describe, expect, it } from 'vitest';
import { fitTransform, applyFit, invertFit, describeFit } from '../src/utils/georef.js';
import { traceColours, ringArea, samplePatch } from '../src/utils/figureTrace.js';
import { figureCredits } from '../src/utils/rasterOverlay.js';
import { figureCreditText, constraintsFor, parseCoord } from '../src/utils/figureImport.js';

// A figure turned 45° anticlockwise at 2 m per pixel, its top-left corner at
// 663 000 E, 5 608 000 N (UTM 10N), like Tower's Fig. 2.
const rot = (45 * Math.PI) / 180;
const S = 2;
// Drawn turned anticlockwise, so the picture's x axis runs south-east on the ground.
const truth = { a: S * Math.cos(rot), b: -S * Math.sin(rot), c: 663000, d: -S * Math.sin(rot), e: -S * Math.cos(rot), f: 5608000 };
const at = (x, y) => { const [e, n] = applyFit(truth, x, y); return { x, y, e, n }; };

describe('fitTransform', () => {
  it('recovers a 45° similarity from two points, exactly', () => {
    const fit = fitTransform([at(100, 80), at(900, 600)]);
    expect(fit.kind).toBe('similarity');
    expect(fit.exact).toBe(true);
    expect(fit.rotation).toBeCloseTo(45, 6);
    expect(fit.scale).toBeCloseTo(2, 6);
    expect(fit.rms).toBeLessThan(1e-6);
    const [e, n] = applyFit(fit, 400, 300);
    const [te, tn] = applyFit(truth, 400, 300);
    expect(Math.hypot(e - te, n - tn)).toBeLessThan(1e-6);
  });

  it('fits an affine (rotation and shear) from three points and checks a fourth', () => {
    const sheared = { a: 1.8, b: 0.9, c: 500000, d: 1.1, e: -2.2, f: 6000000 };
    const p = (x, y) => { const [e, n] = applyFit(sheared, x, y); return { x, y, e, n }; };
    const exact = fitTransform([p(0, 0), p(1000, 50), p(80, 900)]);
    expect(exact.kind).toBe('affine');
    expect(exact.exact).toBe(true);
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) expect(exact[k]).toBeCloseTo(sheared[k], 6);

    // A fourth point typed 30 m off in easting: an RMS appears, and the bad
    // point carries the largest residual.
    const bad = p(900, 800); bad.e += 30;
    const check = fitTransform([p(0, 0), p(1000, 50), p(80, 900), bad]);
    expect(check.exact).toBe(false);
    expect(check.rms).toBeGreaterThan(5);
    const worst = check.residuals.map((r) => r.r).indexOf(Math.max(...check.residuals.map((r) => r.r)));
    expect(worst).toBe(3);
    expect(describeFit(check)).toMatch(/RMS error \d+(\.\d)? m/);
  });

  it('recovers the 45° turn from four points with metre-level noise and reports it in metres', () => {
    const pts = [at(50, 40), at(1100, 90), at(70, 700), at(1000, 650)];
    pts[0].e += 1.5; pts[2].n -= 2;
    const fit = fitTransform(pts);
    expect(fit.kind).toBe('affine');
    expect(fit.rotation).toBeCloseTo(45, 0);
    expect(fit.rms).toBeGreaterThan(0.2);
    expect(fit.rms).toBeLessThan(2);
    // Similarity forced: same answer, still a 45° turn.
    const sim = fitTransform(pts, { mode: 'similarity' });
    expect(sim.kind).toBe('similarity');
    expect(sim.rotation).toBeCloseTo(45, 0);
  });

  it('takes grid labels that fix only an easting or only a northing', () => {
    const north = { a: 2.5, b: 0, c: 662000, d: 0, e: -2.5, f: 5609000 };
    const g = (x, y) => applyFit(north, x, y);
    // Eastings along the top and northings down the left, clicked with a
    // pixel of jitter: no turn can be read, so the figure is taken north-up.
    const fit = fitTransform([
      { x: 120, y: 1, e: g(120, 0)[0] }, { x: 520, y: 0, e: g(520, 0)[0] },
      { x: 1, y: 200, n: g(0, 200)[1] }, { x: 0, y: 600, n: g(0, 600)[1] },
    ]);
    expect(fit.kind).toBe('north-up');
    expect(fit.rotation).toBeCloseTo(0, 6);
    expect(fit.scale).toBeCloseTo(2.5, 6);
    expect(applyFit(fit, 300, 300)[0]).toBeCloseTo(g(300, 300)[0], 4);

    // Labels on all four edges of the 45° figure: rotation and scale recovered.
    const labels = [[100, 0], [700, 0], [0, 400], [800, 500]].flatMap(([x, y]) => [{ x, y, e: applyFit(truth, x, y)[0] }, { x: x + 3, y: y + 2, n: applyFit(truth, x + 3, y + 2)[1] }]);
    const turned = fitTransform(labels);
    expect(turned.kind).toBe('affine');
    expect(turned.rotation).toBeCloseTo(45, 6);
  });

  it('round-trips through the inverse and refuses clicks that do not fix the figure', () => {
    const fit = fitTransform([at(10, 10), at(500, 400), at(30, 600)]);
    const [x, y] = invertFit(fit, ...applyFit(fit, 321, 123));
    expect(x).toBeCloseTo(321, 6); expect(y).toBeCloseTo(123, 6);
    expect(fitTransform([at(10, 10)]).error).toBeTruthy();
    // Three points in a line: no affine; auto falls back to a similarity.
    expect(fitTransform([at(0, 0), at(100, 100), at(200, 200)], { mode: 'affine' }).error).toBeTruthy();
    expect(fitTransform([at(0, 0), at(100, 100), at(200, 200)]).kind).toBe('similarity');
  });
});

describe('the dialog rows', () => {
  it('parse typed coordinates with spaces, commas and a trailing letter', () => {
    expect(parseCoord('5 609 000N')).toBe(5609000);
    expect(parseCoord('662,000 E')).toBe(662000);
    expect(Number.isNaN(parseCoord(''))).toBe(true);
    const identity = { inputToWork: (a, b) => [a, b] };
    expect(constraintsFor([{ kind: 'e', x: 1, y: 2, a: '662 000' }, { kind: 'point', x: 3, y: 4, a: '1', b: '2' }], identity))
      .toEqual([{ x: 1, y: 2, e: 662000 }, { x: 3, y: 4, e: 1, n: 2 }]);
  });
});

// ── tracing ──────────────────────────────────────────────────────────────
// A synthetic geology figure: speckled imagery, a pink unit and a brown unit
// meeting along a black contact line, white lettering and a yellow trend line
// across the pink, a white hole in the pink, and a pink legend swatch.
function lcg(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function syntheticFigure() {
  const w = 240, h = 160;
  const data = new Uint8ClampedArray(w * h * 4);
  const rnd = lcg(7);
  const set = (x, y, [r, g, b]) => { const o = (y * w + x) * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255; };
  const PINK = [214, 150, 176], BROWN = [168, 128, 96];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const n = (rnd() - 0.5) * 40;
      let c = [70 + n, 95 + n, 60 + n]; // imagery
      if (x >= 20 && x < 120 && y >= 20 && y < 140) c = PINK.map((v) => v + (rnd() - 0.5) * 16);
      if (x >= 120 && x < 200 && y >= 20 && y < 140) c = BROWN.map((v) => v + (rnd() - 0.5) * 16);
      if (x >= 119 && x <= 121 && y >= 20 && y < 140) c = [20, 20, 20]; // contact
      if (x >= 50 && x < 80 && y >= 60 && y < 90) c = [250, 250, 250]; // a big white hole
      if (x >= 30 && x < 33 && y >= 110 && y < 113) c = [30, 30, 30]; // a collar dot
      if ((y === 40 || y === 41) && x >= 25 && x < 110) c = [255, 255, 255]; // lettering stroke
      if (Math.abs(y - 0.6 * x - 30) < 1.5 && x > 20 && x < 118) c = [240, 200, 40]; // trend line
      if (x >= 215 && x < 227 && y >= 140 && y < 148) c = PINK; // legend swatch
      set(x, y, c);
    }
  }
  return { data, width: w, height: h, PINK, BROWN };
}

describe('traceColours', () => {
  const fig = syntheticFigure();
  const units = [{ samples: [fig.PINK] }, { samples: [fig.BROWN] }];
  const [pink, brown] = traceColours(fig, units, { minArea: 200 });

  it('makes one polygon per unit, drops the swatch and keeps the big hole', () => {
    expect(pink.polygons).toHaveLength(1);
    expect(brown.polygons).toHaveLength(1);
    expect(pink.polygons[0].holes).toHaveLength(1);
    // 100 × 120 px less the 30 × 30 hole, within a few per cent after
    // lines are absorbed and outlines smoothed.
    const outer = ringArea(pink.polygons[0].outer);
    const hole = -ringArea(pink.polygons[0].holes[0]);
    expect(outer - hole).toBeGreaterThan(0.93 * (12000 - 900));
    expect(outer - hole).toBeLessThan(1.06 * (12000 - 900));
    expect(hole).toBeGreaterThan(800);
  });

  it('closes the contact line, so the two units meet', () => {
    const maxX = Math.max(...pink.polygons[0].outer.map((p) => p[0]));
    const minX = Math.min(...brown.polygons[0].outer.map((p) => p[0]));
    expect(minX - maxX).toBeLessThan(1.5);
  });

  it('ignores the lettering, the trend line and the collar dot', () => {
    // Lettering and the trend line cross the pink: no extra holes or pieces.
    expect(pink.polygons[0].holes).toHaveLength(1);
    expect(pink.polygons.length).toBe(1);
    // A smoothed outline: far fewer vertices than the pixel staircase.
    expect(pink.polygons[0].outer.length).toBeLessThan(80);
  });

  it('samples the eyedropper patch as an average', () => {
    const c = samplePatch(fig, 60, 30, 2);
    c.forEach((v, i) => expect(Math.abs(v - fig.PINK[i])).toBeLessThan(12));
  });
});

describe('credits', () => {
  it('builds the credit line and prints each figure once while it is shown', () => {
    const credit = figureCreditText({ subject: 'Geology (simplified)', source: 'Tower Fig. 1', date: '15 Oct 2026' });
    expect(credit).toBe('Geology (simplified) after Tower Fig. 1 (15 Oct 2026)');
    expect(figureCreditText({ subject: 'Geology', source: '' })).toBe('');
    const figure = { id: 'f1', credit };
    expect(figureCredits([{ figure }, { figure }, { figure: { credit: 'Other after X' }, visible: false }, {}])).toEqual([credit]);
    expect(figureCredits([{ type: 'raster' }, { type: 'polygons' }])).toEqual([]);
  });
});
