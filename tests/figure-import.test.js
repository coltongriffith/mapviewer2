import { describe, expect, it } from 'vitest';
import { fitTransform, applyFit, invertFit, describeFit } from '../src/utils/georef.js';
import { traceColours, ringArea, samplePatch } from '../src/utils/figureTrace.js';
import { figureCredits } from '../src/utils/rasterOverlay.js';
import { figureCreditText, constraintsFor, parseCoord, tracedForUnits, reconcileFigureLayers } from '../src/utils/figureImport.js';
import { findMargin, clearMargin, clearOutside } from '../src/utils/figureMargins.js';

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

describe('blank margins', () => {
  // A figure turned 45° on a white page: a diamond of speckled imagery with a
  // white title card inside it, and white corners.
  function turnedScan() {
    const w = 200, h = 200, data = new Uint8ClampedArray(w * h * 4);
    let s = 3;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const inside = Math.abs(x - 100) + Math.abs(y - 100) < 95;
        const card = x >= 85 && x < 115 && y >= 60 && y < 75;
        const n = (rnd() - 0.5) * 30;
        const c = !inside ? [255 - rnd() * 4, 255 - rnd() * 4, 253] : card ? [255, 255, 255] : [80 + n, 100 + n, 60 + n];
        data.set([...c, 255], (y * w + x) * 4);
      }
    }
    return { data, width: w, height: h };
  }
  const alpha = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

  it('finds the white page and clears it from the edges in, keeping white inside the figure', () => {
    const img = turnedScan();
    const m = findMargin(img);
    expect(m).not.toBeNull();
    expect(m.color.every((c) => c > 245)).toBe(true);
    clearMargin(img, m.color);
    for (const [x, y] of [[0, 0], [199, 0], [0, 199], [199, 199], [20, 20], [180, 180]]) expect(alpha(img, x, y)).toBe(0);
    expect(alpha(img, 100, 100)).toBe(255); // imagery
    expect(alpha(img, 100, 67)).toBe(255); // the white card inside
    // Nothing left to find on a cleared picture, and a figure without a page has none.
    expect(findMargin(img)).toBeNull();
    const full = turnedScan();
    let t = 5;
    for (let i = 0; i < full.data.length; i += 4) { t = (t * 1664525 + 1013904223) >>> 0; full.data.set([60 + (t % 60), 90 + (t % 40), 50], i); }
    expect(findMargin(full)).toBeNull();
  });

  it('clears outside a crop', () => {
    const img = turnedScan();
    clearOutside(img, { x0: 50, y0: 50, x1: 150, y1: 150 });
    expect(alpha(img, 49, 100)).toBe(0);
    expect(alpha(img, 100, 100)).toBe(255);
  });
});

describe('the figure layers on the map', () => {
  const poly = (x) => [[[x, 50], [x + 0.01, 50], [x + 0.01, 50.01], [x, 50]]];
  const old = { id: 'f1', source: 'Tower Fig. 1', date: '15 Oct 2026', credit: 'Geology (simplified) after Tower Fig. 1 (15 Oct 2026)' };
  const layer = (id, unitId, name, x) => ({
    id, name, displayName: name, type: 'polygons', figure: old, figureUnit: unitId, style: { fill: '#ff0000', fillOpacity: 0.3 },
    legend: { enabled: true, label: name, group: 'Geology' },
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: poly(x) } }] },
  });
  const onMap = () => [
    { id: 'claims', name: 'Claims', geojson: null },
    { id: 'img', type: 'raster', figure: old, raster: {} },
    layer('L-durand', 'u-durand', 'Durand Stock', -120),
    { ...layer('L-chil', 'u-chil', 'Chilcotin', -120.1), displayName: 'Chilcotin basalt (my name)' },
    layer('L-dom', 'u-dom', 'Dominic Lake', -120.2),
  ];

  it('puts an edited credit on every layer of the figure, and prints it once', () => {
    const figure = { ...old, credit: 'Geology after Tower Fig. 1 (rev.)' };
    const out = reconcileFigureLayers(onMap(), { figure, raster: { id: 'img', type: 'raster', figure }, replaceId: 'img', traced: [], unitIds: new Set(['u-durand', 'u-chil', 'u-dom']), move: null });
    expect(out.filter((l) => l.figure).every((l) => l.figure.credit === figure.credit)).toBe(true);
    expect(figureCredits(out)).toEqual([figure.credit]);
    // Even with a stale line left on one layer: one line per figure.
    expect(figureCredits([{ figure: { id: 'f1', credit: 'new' } }, { figure: { id: 'f1', credit: 'old' } }])).toEqual(['new']);
  });

  it('does not import a unit removed after tracing', () => {
    const trace = { units: [{ id: 'a' }, { id: 'b' }], results: [{ polygons: [1] }, { polygons: [2] }], scale: 1 };
    expect(tracedForUnits(trace, [{ id: 'b', name: 'B' }]).map((t) => t.unit.name)).toEqual(['B']);
    expect(tracedForUnits(null, [{ id: 'b' }])).toEqual([]);
  });

  it('replaces re-traced units in place, drops removed ones, adds new ones and moves the rest with a corrected fit', () => {
    const figure = { ...old };
    const unit = (id, name) => ({ id, name, samples: [[200, 150, 170]] });
    const out = reconcileFigureLayers(onMap(), {
      figure, raster: { id: 'img', type: 'raster', figure }, replaceId: 'img',
      traced: [
        { id: 'new-1', unit: unit('u-durand', 'Durand Stock diorite'), polygons: [poly(-119)] },
        { id: 'new-2', unit: unit('u-chil', 'Chilcotin'), polygons: [poly(-119.5)] },
        { id: 'new-3', unit: unit('u-roper', 'Roper Lake granodiorite'), polygons: [poly(-119.9)] },
      ],
      unitIds: new Set(['u-durand', 'u-chil', 'u-roper']), // Dominic Lake was removed
      move: ([lng, lat]) => [lng + 1, lat],
    });
    expect(out.map((l) => l.id)).toEqual(['claims', 'img', 'L-durand', 'L-chil', 'new-3']);
    const durand = out.find((l) => l.id === 'L-durand');
    expect(durand.geojson.features[0].geometry.coordinates[0][0]).toEqual([-119, 50]); // the new trace
    expect(durand.style).toEqual({ fill: '#ff0000', fillOpacity: 0.3 }); // the person's style kept
    expect(durand.legend.label).toBe('Durand Stock diorite'); // renamed with the unit
    expect(out.find((l) => l.id === 'L-chil').displayName).toBe('Chilcotin basalt (my name)'); // their own name kept
    // A unit not traced again moves with the corrected fit.
    const kept = reconcileFigureLayers(onMap(), { figure, raster: null, replaceId: null, traced: [], unitIds: new Set(['u-durand', 'u-chil', 'u-dom']), move: ([lng, lat]) => [lng + 1, lat] });
    expect(kept.find((l) => l.id === 'L-dom').geojson.features[0].geometry.coordinates[0][0]).toEqual([-119.2, 50]);
    expect(kept.find((l) => l.id === 'claims')).toEqual({ id: 'claims', name: 'Claims', geojson: null });
  });
});
