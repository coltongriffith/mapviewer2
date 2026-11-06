import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import * as THREE from 'three';
import { intercept } from '../shared/intercepts.js';

const source = readFileSync(path.join(process.cwd(), 'src/three-d/studio.js'), 'utf8');
const ast = parse(source, { sourceType: 'module' });
function nativeDeclaration(name) {
  const node = ast.program.body.find((entry) => entry.type === 'FunctionDeclaration' && entry.id.name === name
    || entry.type === 'VariableDeclaration' && entry.declarations.some((item) => item.id.name === name));
  if (!node) throw new Error(`Missing native declaration: ${name}`);
  return source.slice(node.start, node.end);
}

// Execute the actual native functions with renderer/DOM seams. Three's matrices,
// colors, instance attributes and the scientific intercept calculation are real.
function harness() {
  const S = {
    valueCol: 'Cu', valueCol2: null, bins: [1, 2, 3, 4], displayCutoff: null, eq: null,
    wallLabels: [], primary: '#142126', accent: '#c65322', walls: true, surf: 1,
    lockView: false, meshes: {}, terrain: 'natural', block: null, shell: { enabled: false },
    legend: { merge: 'auto', pos: {} }, calloutMode: 'calculated', coCut: 1, coIncl: 3, coMin: 1,
  };
  const ctx = new Proxy({}, { get: () => vi.fn(), set: () => true });
  const newMesh = () => {
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 4), new THREE.MeshBasicMaterial(), 16);
    vi.spyOn(mesh, 'setMatrixAt'); vi.spyOn(mesh, 'setColorAt');
    return mesh;
  };
  const newGeometry = () => ({
    tubes: newMesh(), tubesP: newMesh(), walls: [], meshes: [],
    top: { material: {} }, topCanvas: { width: 768, getContext: () => ctx }, topBase: {}, topTex: {},
    B: { x0: 0, y1: 20 }, bw: 20, bh: 20,
    V: (x, y, z) => new THREE.Vector3(x, y, z), wallPrimary: S.primary,
  });
  const hole = (id, x) => ({
    id, prov: false, ints: [{ from: 0, to: 2, vals: { Cu: 2 } }, { from: 2, to: 4, vals: { Cu: 4 } }],
    posAt: vi.fn((depth) => ({ x, y: 0, z: -depth })), on: true, weight: 1, faded: false,
  });
  const H = {
    S, THREE, G: newGeometry(), project: { holes: [hole('QA1', 0), hole('QA2', 10)], cols: ['Cu'] },
    BIN_COLORS: ['#a3abaf', '#e2dc4f', '#ff9a1f', '#ef3b2c', '#e93ad1'],
    controls: { enabled: true }, $: () => ({ setAttribute: vi.fn() }),
    uses: (_state, feature) => feature === 'sampledIntercepts', traceR: () => H.radius,
    radius: 1, holeOn: (h) => h.on, extFade: (h) => h.faded,
    EXT: { tags: { weight: (h) => h.weight } },
    sectionEnds: () => [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    buildWallLabels: vi.fn(), styleShell: vi.fn(), stopOrbit: vi.fn(), placeRibbons: vi.fn(),
    extRestyle: vi.fn(), drawSectionView: vi.fn(),
    callouts: [], calcCallouts: [], prWanted: () => false, PR: null, intercept,
    renderLegendUI: vi.fn(), schedulePublish: vi.fn(), renderCalloutEditor: vi.fn(), renderChecks: vi.fn(),
    getState: vi.fn(() => ({ full: true, legend: structuredClone(S.legend), holes: H.project.holes.length })),
    extStyle: vi.fn(), renderTerrainChoices: vi.fn(), renderStyle: vi.fn(),
    clamp01: (value) => Math.max(0, Math.min(1, +value)), syncShell: vi.fn(),
  };
  const declarations = ['intervalShown', 'binIndex', 'computeCallouts', 'restyle', 'setStyle'].map(nativeDeclaration).join('\n');
  const functions = new Function('H', `with (H) { ${declarations}; return {restyle, setStyle}; }`)(H);
  const clearSpies = () => {
    H.project.holes.forEach((h) => h.posAt.mockClear());
    [H.G.tubes, H.G.tubesP].forEach((mesh) => { mesh.setMatrixAt.mockClear(); mesh.setColorAt.mockClear(); });
  };
  const snapshot = () => [H.G.tubes, H.G.tubesP].map((mesh) => ({
    matrices: [...mesh.instanceMatrix.array], colors: mesh.instanceColor && [...mesh.instanceColor.array],
    matrixVersion: mesh.instanceMatrix.version, colorVersion: mesh.instanceColor?.version,
  }));
  return { H, ...functions, clearSpies, snapshot, newGeometry };
}

describe('native interval restyle invalidation', () => {
  it('leaves exact matrices/colors and upload versions untouched on an unchanged restyle', () => {
    const f = harness(); f.restyle(); const before = f.snapshot(); f.clearSpies();
    f.restyle();
    expect(f.snapshot()).toEqual(before);
    expect(f.H.G.tubes.setMatrixAt).not.toHaveBeenCalled();
    expect(f.H.G.tubes.setColorAt).not.toHaveBeenCalled();
    f.H.project.holes.forEach((h) => expect(h.posAt).not.toHaveBeenCalled());
  });

  it('recomputes scientific callouts after a cutoff edit without interval work when emphasis stays unchanged', () => {
    const f = harness(); f.restyle(); expect(f.H.callouts).toHaveLength(2); f.clearSpies();
    f.H.S.coCut = 10; f.restyle();
    expect(f.H.callouts).toHaveLength(0);
    expect(f.H.G.tubes.setMatrixAt).not.toHaveBeenCalled();
    expect(f.H.drawSectionView).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['tag weight', (f) => { f.H.project.holes[0].weight = 2; }],
    ['fade', (f) => { f.H.project.holes[0].faded = true; }],
    ['hole visibility', (f) => { f.H.project.holes[0].on = false; }],
    ['bins', (f) => { f.H.S.bins = [3, 4, 5, 6]; }],
    ['public palette reference', (f) => { f.H.BIN_COLORS[2] = '#0000ff'; }],
    ['display cutoff', (f) => { f.H.S.displayCutoff = 3; }],
    ['equivalent recipe and resulting values', (f) => { f.H.S.eq = { base: 'Cu', price: 3 }; f.H.project.holes[0].ints[0].vals.Cu = 6; }],
    ['provisional bucket', (f) => { f.H.project.holes[0].prov = true; }],
    ['bucket start index', (f) => { f.H.project.holes.reverse(); }],
    ['new intervals', (f) => { f.H.project.holes[0].ints = f.H.project.holes[0].ints.map((it) => structuredClone(it)); }],
    ['interval count', (f) => { f.H.project.holes[0].ints.push({ from: 4, to: 5, vals: { Cu: 3 } }); }],
    ['rebuilt scene', (f) => { f.H.G = f.newGeometry(); }],
  ])('updates actual instance buffers after %s changes', (_name, mutate) => {
    const f = harness(); f.restyle(); f.clearSpies(); mutate(f); f.restyle();
    expect(f.H.G.tubes.setMatrixAt.mock.calls.length + f.H.G.tubesP.setMatrixAt.mock.calls.length).toBeGreaterThan(0);
    expect(f.H.G.tubes.setColorAt.mock.calls.length + f.H.G.tubesP.setColorAt.mock.calls.length).toBeGreaterThan(0);
  });

  it('produces the exact same buffers as a cold restyle after a tag edit', () => {
    const warm = harness(), cold = harness(); warm.restyle();
    warm.H.project.holes[0].weight = cold.H.project.holes[0].weight = 2;
    warm.H.project.holes[0].faded = cold.H.project.holes[0].faded = true;
    warm.restyle(); cold.restyle();
    expect(warm.snapshot().map(({ matrices, colors }) => ({ matrices, colors })))
      .toEqual(cold.snapshot().map(({ matrices, colors }) => ({ matrices, colors })));
  });
});

describe('native legend-only style path', () => {
  it('validates and returns full state with section/overlay redraw and no scene/callout/check work', () => {
    const f = harness();
    expect(f.setStyle({ legend: { merge: 'separate', pos: { main: { x: 0.2, y: 0.3 } } } }))
      .toEqual({ full: true, holes: 2, legend: { merge: 'separate', pos: { main: { x: 0.2, y: 0.3 } } } });
    expect(f.H.drawSectionView).toHaveBeenCalledTimes(1);
    expect(f.H.schedulePublish).toHaveBeenCalledWith({ overlayOnly: true });
    expect(f.H.renderChecks).not.toHaveBeenCalled();
    expect(f.H.renderCalloutEditor).not.toHaveBeenCalled();
    expect(f.H.G.tubes.setMatrixAt).not.toHaveBeenCalled();
  });

  it.each([{ merge: 'bad' }, { pos: { invalidCard: 'tl' } }, { pos: { main: 'bad' } }])('rejects invalid legend input before scheduling', (legend) => {
    const f = harness(); expect(() => f.setStyle({ legend })).toThrow();
    expect(f.H.schedulePublish).not.toHaveBeenCalled();
    expect(f.H.getState).not.toHaveBeenCalled();
  });

  it.each([{ legend: { merge: 'one' }, unknown: true }, {}])('retains the full path for mixed unknown keys or empty patches', (patch) => {
    const f = harness(); f.setStyle(patch);
    expect(f.H.G.tubes.setMatrixAt).toHaveBeenCalled();
    expect(f.H.renderCalloutEditor).toHaveBeenCalled();
    expect(f.H.renderChecks).toHaveBeenCalled();
    expect(f.H.schedulePublish).toHaveBeenCalledWith();
  });
});
