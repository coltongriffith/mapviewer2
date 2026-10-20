import { describe, it, expect } from 'vitest';
import { readLogs, syncLegend, logSamples, classifyGrid, smoothClasses, barTicks, PASTEL } from '../src/three-d/geology.js';
import { propertyInfo, rampRGB, lineFrame, curtainGrid, idwGrid, autoRange, readPoints } from '../src/three-d/geophys.js';
import { isXYZ, parseXYZ, refineRole } from '../src/three-d/roles.js';
import { holeStatuses, placePills, clusters } from '../src/three-d/tags.js';

// Two vertical holes 100 m apart: cover (A) to 40 m depth, then B. Collars at z = 100.
const vertical = (id, x) => ({ id, posAt: (d) => ({ x, y: 0, z: 100 - d }) });
const logFile = (rows) => ({ role: 'litho', rows, cols: { hole: 0, from: 1, to: 2, code: 3, desc: 4 } });
const twoHoles = () => {
  const L = readLogs([logFile([['H1', '0', '40', 'A', 'Cover'], ['H1', '40', '200', 'B', 'Porphyry'], ['H2', '0', '40', 'A', ''], ['H2', '40', '200', 'B', '']])]);
  const idx = new Map(L.codes.map((c, i) => [c.code, i]));
  return { L, idx, P: logSamples([vertical('H1', 0), vertical('H2', 100)], L.byHole, idx) };
};

describe('lithology logs', () => {
  it('reads intervals by hole and orders codes shallowest first', () => {
    const { L } = twoHoles();
    expect(L.byHole.get('H1')).toHaveLength(2);
    expect(L.codes.map((c) => c.code)).toEqual(['A', 'B']);
    expect(L.codes[0].desc).toBe('Cover');
  });
  it('keeps user legend edits and adds new codes in pastel colours', () => {
    const leg = syncLegend([{ code: 'B', name: 'Mine', color: '#123456', show: false, order: 0 }], [{ code: 'A', desc: 'Cover' }, { code: 'B' }]);
    expect(leg.find((e) => e.code === 'B')).toMatchObject({ name: 'Mine', color: '#123456', show: false });
    expect(leg.find((e) => e.code === 'A')).toMatchObject({ name: 'Cover', show: true });
    expect(PASTEL).toContain(leg.find((e) => e.code === 'A').color);
  });
});

describe('categorical interpolation (indicator IDW)', () => {
  // A vertical grid halfway between the holes, z from 100 (row 0) down to -100.
  const grid = (P, opts, ny = 41) => classifyGrid(P, 2, 3, ny, (i, j, o) => { o[0] = 40 + i * 10; o[1] = 0; o[2] = 100 - 200 * j / (ny - 1); }, opts);
  it('takes the code with the highest inverse-distance weight', () => {
    const { P } = twoHoles(), G = grid(P, { aniso: 4, search: 200 }), cls = smoothClasses(G, 0);
    const at = (z) => cls[Math.round((100 - z) / 5) * 3 + 1];
    expect(at(90)).toBe(0); // in the cover
    expect(at(20)).toBe(1); // below the contact at z = 60
    expect(at(-60)).toBe(1);
  });
  it('places the contact near the logged depth, sharper with anisotropy', () => {
    const { P } = twoHoles(), contact = (aniso) => { const cls = smoothClasses(grid(P, { aniso, search: 300 }, 201), 0); let j = 0; while (cls[j * 3 + 1] === 0) j++; return 100 - j; };
    expect(Math.abs(contact(4) - 60)).toBeLessThanOrEqual(4);
    expect(Math.abs(contact(8) - 60)).toBeLessThanOrEqual(Math.abs(contact(1) - 60) + 1e-9);
  });
  it('leaves cells beyond the search radius plain (-1)', () => {
    const { P } = twoHoles(), G = classifyGrid(P, 2, 2, 2, (i, j, o) => { o[0] = 5000 + i; o[1] = 0; o[2] = 50 - j; }, { aniso: 4, search: 100 });
    expect([...smoothClasses(G, 0)]).toEqual([-1, -1, -1, -1]);
  });
  it('anisotropy lets layers reach further sideways than up and down', () => {
    // One sample of code 0 at the same level 150 m away; one of code 1 just 30 m below.
    const P = { x: Float64Array.from([150, 0]), y: Float64Array.from([0, 0]), z: Float64Array.from([0, -30]), c: Int16Array.from([0, 1]), n: 2 };
    const pick = (aniso) => smoothClasses(classifyGrid(P, 2, 1, 1, (i, j, o) => { o[0] = 0; o[1] = 0; o[2] = 0; }, { aniso, search: 1000 }), 0)[0];
    expect(pick(1)).toBe(1);
    expect(pick(8)).toBe(0);
  });
  it('blur-then-argmax removes isolated pixels', () => {
    const nx = 9, ny = 9, w = new Float32Array(nx * ny * 2), cover = new Float32Array(nx * ny).fill(1);
    for (let k = 0; k < nx * ny; k++) w[k * 2] = 1;
    w[40 * 2] = 0; w[40 * 2 + 1] = 1; // one pixel of code 1 in a field of code 0
    expect(smoothClasses({ w, cover, nx, ny, nc: 2 }, 0)[40]).toBe(1);
    expect(smoothClasses({ w, cover, nx, ny, nc: 2 }, 2)[40]).toBe(0);
  });
});

describe('geophysics', () => {
  it('names properties, units and log scaling from the column', () => {
    expect(propertyInfo('CHARG_MVV')).toMatchObject({ label: 'Chargeability', unit: 'mV/V', log: false });
    expect(propertyInfo('Resistivity_ohm_m')).toMatchObject({ label: 'Resistivity', unit: 'Ω·m', log: true });
    expect(propertyInfo('cond_mS_m')).toMatchObject({ label: 'Conductivity', log: true });
  });
  it('ramps run blue to magenta', () => {
    expect(rampRGB('geophys', 0)).toEqual([0x2c, 0x3f, 0xb8]);
    expect(rampRGB('geophys', 1)).toEqual([0xd2, 0x2f, 0xc9]);
    expect(rampRGB('grey', 0.5).every((v) => v > 100 && v < 160)).toBe(true);
  });
  it('finds a survey line direction', () => {
    const F = lineFrame([0, 100, 200, 300], [0, 1, -1, 0]);
    expect(Math.abs(F.dx)).toBeCloseTo(1, 2); expect(F.t1 - F.t0).toBeCloseTo(300, 0);
  });
  it('interpolates a curtain near the data and leaves it transparent elsewhere', () => {
    // Stations along t = 0..100 at z = 0 and z = -20, values 10 and 30.
    const ts = [], zs = [], vs = [];
    for (let t = 0; t <= 100; t += 10) { ts.push(t, t); zs.push(0, -20); vs.push(10, 30); }
    const g = curtainGrid(Float64Array.from(ts), Float64Array.from(zs), Float64Array.from(vs), 11, 11, { t0: 0, t1: 100, z0: -100, z1: 0, search: 15 });
    expect(g[0]).toBeCloseTo(10); // row 0 = z 0, on a station
    expect(g[2 * 11 + 5]).toBeCloseTo(30); // z = -20
    expect(g[11 + 5]).toBeGreaterThan(10); expect(g[11 + 5]).toBeLessThan(30); // between them
    expect(Number.isNaN(g[8 * 11 + 5])).toBe(true); // z = -80: no data within 15 m
  });
  it('3D IDW returns the exact value on a data point', () => {
    const g = idwGrid([Float64Array.from([0, 10]), Float64Array.from([0, 0]), Float64Array.from([0, 0])], Float64Array.from([1, 3]), 1, 1, (i, j, o) => { o[0] = 0; o[1] = 0; o[2] = 0; }, 50);
    expect(g[0]).toBe(1);
  });
  it('auto range uses robust percentiles, in log10 when logarithmic', () => {
    const [lo, hi] = autoRange([1, 10, 100, 1000], true); expect(lo).toBeCloseTo(0); expect(hi).toBeGreaterThan(1.9);
  });
  it('reads Geosoft XYZ with line records', () => {
    const text = '/ survey\n/ X Y Z CHG\nLine 100N\n0 100 50 12.5\n25 100 50 *\nLine 200N\n0 200 50 9\n';
    expect(isXYZ('ip.xyz', text)).toBe(true); expect(isXYZ('a.csv', 'HoleID,From,To\n')).toBe(false);
    const { header, rows } = parseXYZ(text);
    expect(header).toEqual(['X', 'Y', 'Z', 'CHG', 'Line']);
    expect(rows).toEqual([['0', '100', '50', '12.5', '100N'], ['25', '100', '50', '', '100N'], ['0', '200', '50', '9', '200N']]);
    const P = readPoints([{ rows, cols: { east: 0, north: 1, elev: 2, value: 3, line: 4 } }]);
    expect(P.n).toBe(2); expect(P.lines).toEqual(['100N', '200N']);
  });
});

describe('file roles', () => {
  const entry = (header, rows, cols) => ({ header, rows, cols });
  it('a hole/from/to file with a text code column is a lithology log', () => {
    const e = entry(['HoleID', 'From', 'To', 'Lith', 'Description'], [['H1', '0', '10', 'COV', 'Cover']], { hole: 0, from: 1, to: 2 });
    expect(refineRole(e, 'assay', 'logs.csv')).toBe('litho'); expect(e.cols.code).toBe(3); expect(e.cols.desc).toBe(4);
  });
  it('an assay file stays an assay file', () => {
    const e = entry(['HoleID', 'From', 'To', 'Cu_pct'], [['H1', '0', '2', '0.3']], { hole: 0, from: 1, to: 2 });
    expect(refineRole(e, 'assay', 'assays.csv')).toBe('assay');
  });
  it('points with a chargeability column are geophysics, plain XYZ stays topography', () => {
    const g = entry(['X', 'Y', 'Z', 'Chargeability'], [['1', '2', '3', '4']], { east: 0, north: 1, elev: 2 });
    expect(refineRole(g, 'topo', 'model.csv')).toBe('geophys'); expect(g.cols.value).toBe(3);
    expect(refineRole(entry(['X', 'Y', 'Z'], [['1', '2', '3']], { east: 0, north: 1, elev: 2 }), 'topo', 'topo.csv')).toBe('topo');
  });
});

describe('hole tags', () => {
  it('new vs previous from status text and the newest year; planned wins', () => {
    const hs = [{ id: 'A', note: 'Complete', raw: { Year: '2026' } }, { id: 'B', note: 'Historic', raw: { Year: '2014' } }, { id: 'C', note: 'Complete', raw: { Year: '2013' } }, { id: 'P', note: 'Planned', raw: { Year: '2027' }, planned: true }];
    const { status, newestYear } = holeStatuses(hs);
    expect(Object.fromEntries(status)).toEqual({ A: 'new', B: 'previous', C: 'previous', P: 'planned' });
    expect(newestYear).toBe(2026);
    expect(holeStatuses(hs, { C: 'new' }).status.get('C')).toBe('new');
  });
  it('places pills clear of each other', () => {
    const out = placePills([{ x: 100, y: 100, w: 40, h: 20 }, { x: 102, y: 100, w: 40, h: 20 }], [], { W: 400, H: 400 });
    const [a, b] = out.map((p) => p.box);
    expect(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]).toBe(true);
  });
  it('groups nearby callouts by single linkage', () => {
    expect(clusters([[0, 0], [50, 0], [90, 0], [500, 0]], 60).map((c) => c.length).sort()).toEqual([1, 3]);
  });
  it('legend colour bar ticks', () => {
    expect(barTicks(0, 3, true).length).toBeGreaterThan(2);
    expect(barTicks(6, 34, false)).toEqual([10, 20, 30]);
  });
});
