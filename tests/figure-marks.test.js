import { describe, expect, it } from 'vitest';
import { detectMarks, classifyShape, suggestStyle } from '../src/utils/figureMarks.js';
import { markLayer, marksForSets, reconcileFigureLayers } from '../src/utils/figureImport.js';

import {
  canvas, segment, dashed, polygon, text, star, diamond, square, triangle, circle, BLACK, GOLD, WHITE,
} from './fixtures/synthFigure.js';

describe('lines', () => {
  it('turns a dashed fault into one dashed line, and a solid one into one solid line', () => {
    const img = canvas(420, 300);
    // a dashed fault, gently bent, 3 px wide, 10 on / 7 off
    dashed(img, [[30, 60], [200, 110], [390, 130]], 3, BLACK, 10, 7);
    // a solid fault crossing the figure
    segment(img, [60, 280], [380, 200], 2.5, BLACK);
    const [res] = detectMarks(img, [{ kind: 'line', samples: [BLACK], tolerance: 20 }]);
    expect(res.lines).toHaveLength(2);
    const [a, b] = res.lines;
    const dash = [a, b].find((l) => l.dashed), solid = [a, b].find((l) => !l.dashed);
    expect(dash).toBeTruthy();
    expect(solid).toBeTruthy();
    expect(dash.pieces).toBeGreaterThan(15);
    // runs the whole way: from near (30, 60) to near (390, 130)
    const ends = [dash.points[0], dash.points[dash.points.length - 1]].sort((p, q) => p[0] - q[0]);
    expect(Math.hypot(ends[0][0] - 30, ends[0][1] - 60)).toBeLessThan(6);
    expect(Math.hypot(ends[1][0] - 390, ends[1][1] - 130)).toBeLessThan(6);
    // drawn 10 on, 7 off with round caps 3 px wide: 13 on, 4 off
    expect(dash.dash[0]).toBeGreaterThanOrEqual(11);
    expect(dash.dash[1]).toBeGreaterThanOrEqual(3);
    expect(solid.length).toBeGreaterThan(320);
    expect(suggestStyle('line', [dash])).toBe('dashed');
    expect(suggestStyle('line', [solid])).toBe('solid');
  });

  it('ignores lettering, symbols and other colours', () => {
    const img = canvas(420, 300);
    dashed(img, [[20, 40], [400, 52]], 3, GOLD, 12, 8);
    // lettering in the same gold, and in the line's own colour of black below
    text(img, 'THUNDER TREND', 30, 70, 2, GOLD);
    text(img, 'FAULT 077 - 077', 30, 120, 2, GOLD);
    text(img, 'DURAND FAULT', 30, 200, 3, BLACK);
    // a gold star and a gold legend swatch (an area): not lines
    polygon(img, star(330, 150, 14), GOLD);
    polygon(img, square(360, 240, 20), GOLD);
    // a white line: another colour
    segment(img, [20, 280], [400, 260], 3, WHITE);
    const [gold] = detectMarks(img, [{ kind: 'line', samples: [GOLD], tolerance: 18 }]);
    expect(gold.lines).toHaveLength(1);
    expect(gold.lines[0].dashed).toBe(true);
    expect(gold.lines[0].length).toBeGreaterThan(360);
    const [black] = detectMarks(img, [{ kind: 'line', samples: [BLACK], tolerance: 18 }]);
    expect(black.lines).toHaveLength(0);
  });

  it('drops lines shorter than the minimum length', () => {
    const img = canvas(300, 200);
    segment(img, [20, 50], [60, 50], 3, BLACK); // 40 px
    segment(img, [20, 120], [260, 140], 3, BLACK);
    const [d] = detectMarks(img, [{ kind: 'line', samples: [BLACK] }], { minLength: 60 });
    expect(d.lines).toHaveLength(1);
    const [all] = detectMarks(img, [{ kind: 'line', samples: [BLACK] }], { minLength: 20 });
    expect(all.lines).toHaveLength(2);
  });

  it('sees a thrust by its teeth on one side', () => {
    const img = canvas(400, 200);
    segment(img, [20, 100], [380, 112], 3, BLACK);
    // teeth above the line (left of a line running east, on screen)
    for (let x = 50; x < 370; x += 40) { const y = 100 + ((x - 20) * 12) / 360; polygon(img, [[x - 5, y - 0.2], [x + 5, y + 0.2], [x, y - 9]], BLACK); }
    const [{ lines }] = detectMarks(img, [{ kind: 'line', samples: [BLACK], tolerance: 20 }]);
    expect(lines).toHaveLength(1);
    const l = lines[0];
    const eastward = l.points[0][0] < l.points[l.points.length - 1][0];
    expect(l.teeth).toBe(eastward ? 'left' : 'right');
    expect(suggestStyle('line', lines)).toBe('thrust');
  });
});

describe('points', () => {
  it('classifies stars, diamonds, circles, squares and triangles at several sizes', () => {
    for (const r of [6, 9, 14]) {
      const img = canvas(560, 140, r);
      polygon(img, star(50, 70, r * 1.2), GOLD);
      polygon(img, diamond(160, 70, r), GOLD);
      circle(img, 270, 70, r, GOLD);
      polygon(img, square(380, 70, r * 0.85), GOLD);
      polygon(img, triangle(490, 74, r * 1.1), GOLD);
      const [res] = detectMarks(img, [{ kind: 'point', samples: [GOLD] }], { minSize: 6 });
      const byX = [...res.points].sort((a, b) => a.x - b.x).map((p) => p.shape);
      expect(byX, `radius ${r}`).toEqual(['star', 'diamond', 'circle', 'square', 'triangle']);
    }
  });

  it('classifies a turned star and an outlined symbol by its fill', () => {
    const img = canvas(200, 100);
    polygon(img, star(50, 50, 16, 0.4), GOLD);
    // a diamond with a dark outline: the gold fill alone is still a diamond
    polygon(img, diamond(140, 50, 14), BLACK);
    polygon(img, diamond(140, 50, 11), GOLD);
    const [res] = detectMarks(img, [{ kind: 'point', samples: [GOLD] }]);
    expect([...res.points].sort((a, b) => a.x - b.x).map((p) => p.shape)).toEqual(['star', 'diamond']);
  });

  it('finds a star sitting on a trend line of its own colour', () => {
    const img = canvas(300, 160);
    segment(img, [20, 140], [280, 20], 4, GOLD);
    polygon(img, star(150, 80, 15), GOLD);
    const [res] = detectMarks(img, [{ kind: 'point', samples: [GOLD] }]);
    expect(res.points).toHaveLength(1);
    expect(res.points[0].shape).toBe('star');
    expect(Math.hypot(res.points[0].x - 150, res.points[0].y - 80)).toBeLessThan(3);
  });

  it('ignores lettering of the symbols\' colour, other colours and things too small or too big', () => {
    const img = canvas(400, 200);
    circle(img, 40, 40, 5, BLACK); // a drill hole
    circle(img, 120, 40, 5, BLACK);
    text(img, 'DO 077 FAULT', 20, 90, 2, BLACK); // lettering with round "O"s and "0"s
    text(img, 'ROO', 20, 140, 3, BLACK);
    circle(img, 300, 40, 6, WHITE); // another colour
    circle(img, 300, 140, 1.5, BLACK); // a speck
    polygon(img, square(340, 140, 30), BLACK); // an area
    const [res] = detectMarks(img, [{ kind: 'point', samples: [BLACK] }], { minSize: 6 });
    expect(res.points.map((p) => [Math.round(p.x), Math.round(p.y), p.shape])).toEqual([[40, 40, 'circle'], [120, 40, 'circle']]);
  });

  it('reads a filled blob\'s shape directly', () => {
    const disc = [];
    for (let y = -10; y <= 10; y += 1) for (let x = -10; x <= 10; x += 1) if (x * x + y * y <= 100) disc.push([x + 20, y + 20]);
    expect(classifyShape(disc).shape).toBe('circle');
  });
});

describe('lines and points as layers', () => {
  const figure = { id: 'fig-1', source: 'Test Fig. 1', credit: 'Structure after Test Fig. 1' };
  const lineSet = { id: 'set-l', kind: 'line', name: 'Fault (inferred)', colour: '#141418', style: 'dashed' };
  const pointSet = { id: 'set-p', kind: 'point', name: 'Discovery', colour: '#f2b824', style: 'star' };
  const lines = [[[-120.1, 50.1], [-120.0, 50.2]], [[-120.2, 50.0], [-120.1, 50.0]]];
  const points = [[-120.05, 50.15]];

  it('makes a dashed line layer, a thrust and a star point layer', () => {
    const l = markLayer({ id: 'l1', set: lineSet, features: lines, figure });
    expect(l.type).toBe('line');
    expect(l.geojson.features).toHaveLength(2);
    expect(l.geojson.features[0].geometry.type).toBe('LineString');
    expect(l.style.dashArray).toBeTruthy();
    expect(l.figure).toBe(figure);
    expect(l.legend.label).toBe('Fault (inferred)');
    const t = markLayer({ id: 'l2', set: { ...lineSet, style: 'thrust', teeth: 'right' }, features: lines, figure });
    expect(t.fx).toEqual({ lineType: 'thrust', teeth: 'right' });
    expect(t.style.dashArray).toBeUndefined();
    const p = markLayer({ id: 'p1', set: pointSet, features: points, figure });
    expect(p.type).toBe('points');
    expect(p.style.markerShape).toBe('star');
    expect(p.geojson.features[0].geometry).toEqual({ type: 'Point', coordinates: points[0] });
  });

  it('adds only accepted features, and a set with none accepted adds no layer', () => {
    const det = {
      sets: [lineSet, pointSet],
      results: [{ lines: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, { points: [{ id: 'd' }] }],
    };
    const review = { a: 'accepted', b: 'rejected' }; // c pending, d pending
    const out = marksForSets(det, [lineSet, pointSet], review, (kind) => (kind === 'line' ? lines[0] : points[0]));
    expect(out).toHaveLength(1);
    expect(out[0].unit.id).toBe('set-l');
    expect(out[0].features).toHaveLength(1);
    // a removed set's finds are not imported
    expect(marksForSets(det, [pointSet], { d: 'accepted' }, () => points[0]).map((t) => t.unit.id)).toEqual(['set-p']);
  });

  it('reconciles: a re-detected set replaces its layer, a renamed layer keeps its name, a changed style applies', () => {
    const first = reconcileFigureLayers([], { figure, raster: null, traced: [{ id: 'L', unit: lineSet, features: lines }], unitIds: new Set(['set-l']) });
    expect(first).toHaveLength(1);
    const renamed = [{ ...first[0], displayName: 'Faults', legend: { ...first[0].legend, label: 'Faults' } }];
    const again = reconcileFigureLayers(renamed, { figure, raster: null, traced: [{ id: 'X', unit: { ...lineSet, style: 'solid' }, features: [lines[0]] }], unitIds: new Set(['set-l']) });
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe('L');
    expect(again[0].displayName).toBe('Faults');
    expect(again[0].geojson.features).toHaveLength(1);
    expect(again[0].style.dashArray).toBeUndefined();
    // removed from the dialog: the layer goes
    expect(reconcileFigureLayers(again, { figure, raster: null, traced: [], unitIds: new Set() })).toHaveLength(0);
  });
});
