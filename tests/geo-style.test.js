import { describe, it, expect } from 'vitest';
import { fxOf, fxScene, largestBox, shade, washPrims, swatchPrims, paintFxSvg, paintFxCanvas, boxesOverlap } from '../src/utils/geoStyle.js';
import { buildLegendItems } from '../src/templates/technicalResultsTemplate.js';

// Geology and label styling (layer.fx): labels along lines and printed into units, feathered and plume fills,
// glow and line types, the wash and the legend swatches. Opt-in: a layer without fx is not touched.

// A plain north-up view: 10 px per degree, lng → x, lat → −y, a 1000 × 800 map with no panels.
const view = (extra = {}) => ({ pt: (lng, lat) => [lng * 10, -lat * 10], world: (lng, lat) => [lng, -lat], k: 10, W: 1000, H: 800, obstacles: [], family: 'Inter', ...extra });
const fc = (geometry, properties = {}) => [{ type: 'Feature', properties, geometry }];
const entry = (layer) => ({ layer, features: layer.geojson.features, styleOf: () => layer.style });
const lineLayer = (coords, label, extra = {}) => ({ id: 'l', name: 'Thunder trend', geojson: { features: fc({ type: 'LineString', coordinates: coords }) }, style: { stroke: '#f5b82e', strokeWidth: 3 }, fx: { lineType: 'trend', glow: 6, label: { on: true, size: 12, ls: 0.1, offset: 4, ...label } }, ...extra });
const glyphsOf = (out, role) => out.labels.filter((p) => p.t === 'glyphs' && (!role || p.role === role));

// Point in polygon (even-odd), for checking a label stays inside its unit.
function inside(ring, [x, y]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe('fx settings', () => {
  it('a layer without fx has none; defaults fill in', () => {
    expect(fxOf({ style: {} })).toBe(null);
    const fx = fxOf({ fx: { lineType: 'zone' } });
    expect(fx).toMatchObject({ feather: 0, outline: true, lineType: 'zone', casing: true, label: null });
    expect(fxOf({ fx: { lineType: 'nonsense', label: { on: false } } })).toMatchObject({ lineType: 'plain', label: null });
  });
  it('a darker shade keeps the hue', () => {
    expect(shade('#e8a5c0')).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(shade('#e8a5c0').slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g); expect(r).toBeGreaterThan(b); expect(r).toBeLessThan(140);
  });
});

describe('labels along a line', () => {
  it('sits on the chosen side, at the chosen start, reading along the line', () => {
    const out = fxScene([entry(lineLayer([[10, -40], [60, -40]], { side: 'left', start: 0 }))], view());
    const [g] = glyphsOf(out, 'line-label');
    expect(g.s).toBe('THUNDER TREND');
    // Drawn west to east at y = 400: left of travel is above, so every baseline is above the line.
    expect(g.glyphs.every((p) => p.y < 400)).toBe(true);
    expect(g.glyphs[0].x).toBeCloseTo(100, 0);
    expect(g.glyphs.every((p, i, a) => i === 0 || p.x > a[i - 1].x)).toBe(true);
    expect(g.glyphs.every((p) => Math.abs(p.rot) < 1e-6)).toBe(true);
    // Right side: below the line, the glyph tops clear of it.
    const right = glyphsOf(fxScene([entry(lineLayer([[10, -40], [60, -40]], { side: 'right', start: 0 }))], view()), 'line-label')[0];
    expect(right.glyphs.every((p) => p.y > 400 + 12 * 0.72)).toBe(true);
  });

  it('flips a line drawn right to left so it reads upright, and keeps the side as drawn', () => {
    const out = fxScene([entry(lineLayer([[60, -40], [10, -40]], { side: 'left', start: 50 }))], view());
    const [g] = glyphsOf(out, 'line-label');
    expect(g.glyphs.every((p, i, a) => i === 0 || p.x > a[i - 1].x)).toBe(true);
    expect(g.glyphs.every((p) => Math.abs(p.rot) < 1e-6)).toBe(true);
    // Left of an east-to-west line is below it.
    expect(g.glyphs.every((p) => p.y > 400)).toBe(true);
    // Centred at 50 %.
    const mid = (g.glyphs[0].x + g.glyphs.at(-1).x) / 2;
    expect(Math.abs(mid - 350)).toBeLessThan(15);
    // Without flipping it is upside down (turned 180°).
    const raw = glyphsOf(fxScene([entry(lineLayer([[60, -40], [10, -40]], { flip: false }))], view()), 'line-label')[0];
    expect(Math.abs(Math.abs(raw.glyphs[0].rot) - 180)).toBeLessThan(1e-6);
  });

  it('follows a diagonal trend and steps clear of a panel', () => {
    const coords = [[10, -10], [70, -50]];
    const placed = glyphsOf(fxScene([entry(lineLayer(coords, { start: 50 }))], view()), 'line-label')[0];
    const angle = (Math.atan2(400, 600) * 180) / Math.PI;
    placed.glyphs.forEach((p) => expect(p.rot).toBeCloseTo(angle, 0));
    // A panel over the middle of the line: the label moves along it, and nothing is reported.
    const mid = placed.glyphs[Math.floor(placed.glyphs.length / 2)];
    const panel = { key: 'legend', left: mid.x - 60, top: mid.y - 60, width: 120, height: 120 };
    const out = fxScene([entry(lineLayer(coords, { start: 50 }))], view({ obstacles: [panel] }));
    const moved = glyphsOf(out, 'line-label')[0];
    expect(moved.glyphs[0].x).not.toBeCloseTo(placed.glyphs[0].x, 0);
    expect(out.overlaps).toEqual([]);
    // With stepping off, it stays and the overlap is listed.
    const kept = fxScene([entry(lineLayer(coords, { start: 50, nudge: false }))], view({ obstacles: [panel] }));
    expect(kept.overlaps).toEqual([expect.objectContaining({ label: 'THUNDER TREND', with: ['legend'] })]);
  });

  it('draws glow under a dashed trend, then the line', () => {
    const out = fxScene([entry(lineLayer([[10, -40], [60, -40]], {}))], view());
    const strokes = out.band.filter((p) => p.t === 'stroke');
    expect(strokes[0]).toMatchObject({ blur: 6, sw: 15 });
    expect(strokes.at(-1)).toMatchObject({ sw: 3, dash: [15, 10.5] });
  });

  it('gives a thrust teeth on its side and an inferred fault its question marks', () => {
    const thrust = fxScene([entry(lineLayer([[10, -40], [60, -40]], {}, { fx: { lineType: 'thrust', teeth: 'left' } }))], view());
    const teeth = thrust.band.filter((p) => p.t === 'poly');
    expect(teeth.length).toBeGreaterThan(3);
    // Left of an eastward line is up: each apex above the line.
    teeth.forEach((t) => expect(t.pts[2][1]).toBeLessThan(400));
    const fault = fxScene([entry(lineLayer([[10, -40], [60, -40]], {}, { fx: { lineType: 'fault' } }))], view());
    expect(fault.band.filter((p) => p.t === 'glyphs').map((p) => p.s)).toContain('?');
    expect(fault.band.find((p) => p.t === 'stroke' && p.dash)).toBeTruthy();
  });
});

describe('area labels printed into the fill', () => {
  // A concave L: a thick bar along the bottom and a narrow arm up the left. The bar is the clear spot.
  const L = [[0, 0], [60, 0], [60, -14], [12, -14], [12, -60], [0, -60], [0, 0]];
  const unit = (label, ring = L) => ({ id: 'u', name: 'Durand Stock', legend: { label: 'Durand Stock' }, geojson: { features: fc({ type: 'Polygon', coordinates: [ring] }) }, style: { fill: '#e8a5c0', fillOpacity: 0.5, stroke: '#ffffff', strokeWidth: 1 }, fx: { feather: 6, outline: false, label: { on: true, size: 22, ...label } } });
  const screenRing = L.map(([x, y]) => [x * 10, -y * 10]);

  it('fits the largest clear box inside a concave polygon and never spills out', () => {
    const out = fxScene([entry(unit({ sub: 'diorite' }))], view());
    const [main, sub] = glyphsOf(out);
    expect(main.s).toBe('DURAND STOCK');
    expect(sub).toMatchObject({ s: 'diorite', italic: true });
    expect(main.fill).toBe(shade('#e8a5c0'));
    // In the bar (y 0–140 px from the bottom edge at 0), not the arm.
    main.glyphs.forEach((g) => { expect(g.y).toBeLessThan(140); expect(g.x).toBeGreaterThan(120 - 1); });
    // Every glyph's box (advance by cap height) is inside the polygon.
    [main, sub].forEach((run) => run.glyphs.forEach((g) => {
      const w = run.size * 0.68;
      [[g.x, g.y], [g.x + w, g.y], [g.x, g.y - run.size * 0.72], [g.x + w * 0.5, g.y - run.size * 0.72]].forEach((p) => expect(inside(screenRing, p)).toBe(true));
    }));
    expect(out.placed[0].box.left).toBeGreaterThanOrEqual(0);
  });

  it('shrinks to fit, or hides when asked to', () => {
    const small = [[0, 0], [8, 0], [8, -3], [0, -3], [0, 0]];
    const shrunk = glyphsOf(fxScene([entry(unit({ size: 40 }, small))], view()))[0];
    expect(shrunk.size).toBeLessThan(40);
    expect(fxScene([entry(unit({ size: 40, fit: 'hide' }, small))], view()).labels).toEqual([]);
    // Too small even shrunk: hidden.
    const speck = [[0, 0], [1, 0], [1, -0.4], [0, -0.4], [0, 0]];
    expect(fxScene([entry(unit({}, speck))], view()).labels).toEqual([]);
  });

  it('turns to fit a long thin unit when allowed', () => {
    const diag = [[0, 0], [8, -8], [60, -60], [52, -60], [0, -8], [0, 0]];
    const fixed = glyphsOf(fxScene([entry(unit({ size: 40 }, diag))], view()))[0];
    const turned = glyphsOf(fxScene([entry(unit({ size: 40, rotate: 'auto' }, diag))], view()))[0];
    expect(Math.abs(turned.glyphs[0].rot)).toBeGreaterThan(30);
    // Level, it is far smaller (or does not fit at all).
    expect(turned.size).toBeGreaterThan(fixed?.size ?? 0);
  });

  it('steps around a panel over its best spot, off the styled lines, and is left off rather than cut by the map edge', () => {
    // A legend over the bar: the name moves to the clear part of the bar or up the arm, still inside.
    const legend = { key: 'legend', left: 100, top: 0, width: 400, height: 200 };
    const out = fxScene([entry(unit({ size: 16 }))], view({ obstacles: [legend] }));
    const [main] = glyphsOf(out);
    expect(out.overlaps).toEqual([]);
    main.glyphs.forEach((g) => {
      expect(inside(screenRing, [g.x, g.y])).toBe(true);
      expect(boxesOverlap({ left: g.x, top: g.y - 12, width: 10, height: 12 }, legend)).toBe(false);
    });
    // A styled trend across the bar's middle: the name keeps off it.
    const trend = lineLayer([[0, -7], [60, -7]], {}, { fx: { lineType: 'zone' } });
    const clear = glyphsOf(fxScene([entry(trend), entry(unit({ size: 12 }))], view()), 'area-label')[0];
    clear.glyphs.forEach((g) => expect(g.y < 70 - 1 || g.y - 12 * 0.72 > 70 + 1).toBe(true));
    // Half off the map, with no room inside it: not drawn.
    const tiny = [[95, 0], [140, 0], [140, -3], [95, -3], [95, 0]];
    expect(fxScene([entry(unit({ size: 22, minSize: 20 }, tiny))], view()).labels).toEqual([]);
  });

  it('finds a rectangle’s own box', () => {
    const [b] = largestBox([[[0, 0], [40, 0], [40, 10], [0, 10]]], 4);
    expect(b.x).toBeCloseTo(20, 0); expect(b.y).toBeCloseTo(5, 0); expect(b.half).toBeCloseTo(5, 0);
  });
});

describe('feathered and plume fills', () => {
  const poly = { type: 'Polygon', coordinates: [[[0, 0], [40, 0], [40, -20], [0, -20], [0, 0]]] };
  const layer = (fx) => ({ id: 'p', name: 'Train', geojson: { features: fc(poly) }, style: { fill: '#f2d36b', fillOpacity: 0.6, stroke: '#a07a10', strokeWidth: 1.5, layerOpacity: 0.5 }, fx });

  it('a feather is a blurred fill at the layer’s fill opacity, without the outline when dropped', () => {
    const out = fxScene([entry(layer({ feather: 8, outline: false }))], view());
    expect(out.band).toEqual([expect.objectContaining({ t: 'fill', fill: '#f2d36b', opacity: 0.3, blur: 8 })]);
    const svg = paintFxSvg(out.band, 2, [], { prefix: 't' });
    expect(svg).toMatch(/filter="url\(#t-blur-16\)"/);
    const defs = []; paintFxSvg(out.band, 2, defs, { prefix: 't' });
    expect(defs.join('')).toMatch(/<feGaussianBlur stdDeviation="8"/);
    expect(fxScene([entry(layer({ feather: 8 }))], view()).band.map((p) => p.t)).toEqual(['fill', 'stroke']);
  });

  it('a plume fades along its bearing from the source side', () => {
    const out = fxScene([entry(layer({ plume: { az: 90, tail: 0.1, blur: 4 } }))], view());
    const [p] = out.band;
    // Toward the east: the gradient runs from the west edge (x 0) to the east edge (x 400).
    expect(p.grad.x1).toBeCloseTo(0, 6); expect(p.grad.x2).toBeCloseTo(400, 6);
    expect(p.grad.stops[0][1]).toBeCloseTo(0.3, 5);
    expect(p.grad.stops.at(-1)[1]).toBeCloseTo(0.03, 5);
    const defs = []; paintFxSvg(out.band, 1, defs, { prefix: 't' });
    expect(defs.join('')).toMatch(/<linearGradient id="t-g\d+-0" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="400" y2="0"><stop offset="0" stop-color="#f2d36b" stop-opacity="0.3" \/>/);
  });

  it('the canvas painter blurs with a shadow cast back from off the canvas', () => {
    const calls = [];
    const ctx = new Proxy({ canvas: { width: 100, height: 50 }, getTransform: () => ({ a: 2, b: 0 }) }, {
      get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); return { addColorStop: () => {} }; }),
      set: (t, k, v) => { calls.push([`=${String(k)}`, v]); return true; },
    });
    paintFxCanvas(ctx, fxScene([entry(layer({ feather: 8 }))], view()).band, 2);
    const blur = calls.find((c) => c[0] === '=shadowBlur'), off = calls.find((c) => c[0] === '=shadowOffsetX'), tr = calls.find((c) => c[0] === 'translate');
    expect(blur[1]).toBe(16);
    // Moved off by d user px, the shadow brought back by d × 2 device px.
    expect(off[1]).toBeCloseTo(-tr[1] * 2, 6);
  });
});

describe('wash and legend swatches', () => {
  it('wash: a veil and a vignette, nothing when both are off', () => {
    expect(washPrims(null, 10, 10)).toEqual([]);
    expect(washPrims({ amount: 0, vignette: 0 }, 10, 10)).toEqual([]);
    const defs = [];
    const svg = paintFxSvg(washPrims({ amount: 0.3, vignette: 0.5 }, 100, 50), 1, defs, { prefix: 'w' });
    expect(svg).toMatch(/<rect x="0" y="0" width="100" height="50" fill="#ffffff" fill-opacity="0.3" \/>/);
    expect(defs.join('')).toMatch(/<radialGradient id="w-g0-0" cx="0.5" cy="0.5" r="0.7071067811865476">/);
  });

  it('legend rows carry fx, and swatches draw the glow, dash and feather', () => {
    const tpl = { roleStyles: { other: {} } };
    const items = buildLegendItems(tpl, [
      { id: 'a', name: 'Trend', visible: true, role: 'other', type: 'line', geojson: { type: 'FeatureCollection', features: fc({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }) }, style: { stroke: '#f5b82e' }, fx: { lineType: 'trend', glow: 6 } },
      { id: 'b', name: 'Claims', visible: true, role: 'other', type: 'polygons', geojson: { type: 'FeatureCollection', features: fc({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }) }, style: {} },
    ]);
    expect(items[0].fx).toEqual({ lineType: 'trend', glow: 6 });
    expect('fx' in items[1]).toBe(false);
    const line = swatchPrims(items[0], 0, 0, 18, 12);
    expect(line[0]).toMatchObject({ t: 'stroke', blur: 3 });
    expect(line.at(-1).dash).toBeTruthy();
    const area = swatchPrims({ type: 'polygons', style: { fill: '#e8a5c0' }, fx: { feather: 6, outline: false } }, 0, 0, 18, 12);
    expect(area).toEqual([expect.objectContaining({ t: 'fill', blur: 2 })]);
    const plume = swatchPrims({ type: 'polygons', style: { fill: '#f2d36b', fillOpacity: 0.5 }, fx: { plume: { tail: 0 } } }, 0, 0, 18, 12);
    expect(plume[0].grad.stops[0][1]).toBe(0.5);
  });

  it('boxes overlap only when they share area', () => {
    expect(boxesOverlap({ left: 0, top: 0, width: 10, height: 10 }, { left: 10, top: 0, width: 5, height: 5 })).toBe(false);
    expect(boxesOverlap({ left: 0, top: 0, width: 10, height: 10 }, { left: 9, top: 9, width: 5, height: 5 })).toBe(true);
  });
});
