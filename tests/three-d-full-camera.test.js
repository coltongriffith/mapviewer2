import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from '@babel/parser';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { snapshotCamera } from '../src/three-d/project-load.js';

const source = readFileSync('src/three-d/studio.js', 'utf8');
const body = parse(source, { sourceType: 'module' }).program.body;
function actual(name) {
  const node = body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  if (!node) throw new Error(`Native camera function missing: ${name}`);
  return source.slice(node.start, node.end);
}
function fixture() {
  const aim = new THREE.Vector3(), camera = new THREE.PerspectiveCamera();
  const ctx = { THREE, aim, camera, S: { secAz: 135 }, G: {}, EXT: {}, tween: null,
    controls: { target: new THREE.Vector3(), update: vi.fn() }, baseDist: () => 100,
    camTarget: () => aim.clone(),
    lookVec: (az, pl) => { const a = az * Math.PI / 180, p = pl * Math.PI / 180; return new THREE.Vector3(Math.sin(a) * Math.cos(p), -Math.sin(p), -Math.cos(a) * Math.cos(p)); },
  };
  vm.createContext(ctx); vm.runInContext(actual('getCam') + '\n' + actual('setCamera'), ctx);
  ctx.setCamera({ azimuth: 42, plunge: 20, zoom: 100, pan: null });
  return ctx;
}
describe('full native camera snapshots versus partial camera edits', () => {
  it('clears a failed candidate pan when restoring the original unpanned snapshot', () => {
    const f = fixture(), original = f.getCam();
    expect(original).not.toHaveProperty('pan');
    f.setCamera({ azimuth: 80, plunge: 30, zoom: 150, pan: [100, 0, 0] });
    expect(f.getCam().pan).toEqual([100, 0, 0]);
    f.setCamera(snapshotCamera(original));
    expect(f.getCam()).toEqual(original);
  });
  it('keeps the public partial setCamera behavior for ordinary zoom edits', () => {
    const f = fixture(); f.setCamera({ pan: [100, 0, 0] }); f.setCamera({ zoom: 130 });
    expect(f.getCam()).toMatchObject({ zoom: 130, pan: [100, 0, 0] });
  });
  it('preserves an explicitly panned full snapshot without sharing its editable array', () => {
    const f = fixture(), input = { azimuth: 80, plunge: 30, zoom: 150, pan: [100, 5, 10] }, prepared = snapshotCamera(input);
    input.pan[0] = 999; f.setCamera(prepared);
    expect(f.getCam()).toMatchObject({ azimuth: 80, plunge: 30, zoom: 150, pan: [100, 5, 10] });
  });
});
