import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DESIGN_VERSION, LEGACY_V1, LEGACY_V2, LEGACY_V4, withDefaults } from '../src/three-d/design-version.js';
import * as crew from '../src/three-d/crew.js';

// Exploration Maps 3D drill crew (crew.js): a toy rig and crew at the drill pad. Off by default, so a figure that
// never turns it on saves, opens and exports exactly as before; no design version or legacy default changes.
const legacy = JSON.parse(readFileSync('tests/fixtures/three-d/pre-round4-project.json', 'utf8'));
const studio = readFileSync('src/three-d/studio.js', 'utf8');
const page = readFileSync('3d/index.html', 'utf8');

const hole = (id, x, y, { az = 0, dip = -90, z = 100 } = {}) => {
  const a = az * Math.PI / 180, d = dip * Math.PI / 180, path = [];
  for (let i = 0; i <= 10; i++) path.push({ d: i * 2, x: x + Math.sin(a) * Math.cos(d) * i * 2, y: y + Math.cos(a) * Math.cos(d) * i * 2, z: z + Math.sin(d) * i * 2 });
  return { id, c: { x, y, z }, path };
};

describe('settings and saved figures', () => {
  it('is off by default, with no design version or legacy default', () => {
    expect(studio).toMatch(/crew: \{ on: false, at: 'auto', scale: 1, heading: null \}/);
    expect(crew.CREW).toEqual({ on: false, at: 'auto', scale: 1, heading: null });
    expect(DESIGN_VERSION).toBe(5);
    for (const T of [LEGACY_V1, LEGACY_V2, LEGACY_V4]) expect(T).not.toHaveProperty('crew');
  });
  it('a figure saved before it opens with the crew off', () => {
    const S = withDefaults(legacy.settings, { designVersion: DESIGN_VERSION, crew: { ...crew.CREW } });
    expect(S.crew).toEqual(crew.CREW);
    expect(withDefaults({ ...legacy.settings, crew: { on: true, at: 'EX-003', scale: 2, heading: 90 } }, { crew: crew.CREW }).crew.at).toBe('EX-003');
  });
  it('is loaded only when on, hooked into the scene, the live loop, the export and the panel', () => {
    expect(studio).toMatch(/crew: \(\) => import\('\.\/crew\.js'\)/);
    expect(studio).toMatch(/crew: !!S\.crew\?\.on/);
    expect(studio).toMatch(/EXT\.crew\?\.tick\(now\)/);
    expect(studio).toMatch(/faceWalls\(\); EXT\.crew\?\.tick\(\);/); // the fixed pose before an export renders
    expect(studio).toMatch(/async setCrew\(o = \{\}\)/);
    expect(page).toMatch(/data-ext="crew\.on" aria-label="Drill crew[^"]*">Drill crew</);
    expect(page).toMatch(/id="crew-at" data-ext="crew\.at" aria-label=/);
    expect(page).toMatch(/EM3D\.setCrew\(\{on, at:/);
    expect(page).toMatch(/id="crew-size" data-ext="crew\.scale" aria-label="Drill crew size"/);
    expect(studio).toMatch(/const cr = EXT\.crew\?\.collar\(h\); if \(cr === false\) return;/); // collar rings under the pad give way
    expect(studio).toMatch(/if \(!EXT\.crew\?\.covers\(target\)\)/); // no callout dot over the rig
  });
});

describe('option validation (patch)', () => {
  const holes = [hole('EX-001', 0, 0), hole('EX-002', 50, 0)];
  it('fills defaults and keeps what is not given', () => {
    expect(crew.patch(null, {})).toEqual(crew.CREW);
    const c = crew.patch(null, { on: 1, scale: 2 });
    expect(c).toEqual({ on: true, at: 'auto', scale: 2, heading: null });
    expect(crew.patch(c, { heading: 90 })).toEqual({ ...c, heading: 90 });
  });
  it('takes "auto", a known hole ID or a point', () => {
    expect(crew.patch(null, { at: 'EX-002' }, holes).at).toBe('EX-002');
    expect(crew.patch(null, { at: ['412000', 6421000] }).at).toEqual([412000, 6421000]);
    expect(crew.patch({ at: 'EX-001' }, { at: null }).at).toBe('auto');
    expect(() => crew.patch(null, { at: 'EX-999' }, holes)).toThrow(/no hole "EX-999"/);
    expect(() => crew.patch(null, { at: [1] })).toThrow(/\[easting, northing\]/);
    expect(() => crew.patch(null, { at: [1, 'x'] })).toThrow(/\[easting, northing\]/);
  });
  it('keeps the collar "auto" chose until the crew is turned on again or moved', () => {
    const c = { ...crew.CREW, on: true, pick: 'EX-002' };
    expect(crew.patch(c, { scale: 2 }).pick).toBe('EX-002');
    expect(crew.patch(c, { heading: 10 }).pick).toBe('EX-002');
    expect(crew.patch(c, { on: true })).not.toHaveProperty('pick');
    expect(crew.patch(c, { at: 'auto' })).not.toHaveProperty('pick');
    expect(crew.patch({ ...c, pick: 7 }, {})).not.toHaveProperty('pick');
  });
  it('clamps the scale and wraps the heading', () => {
    expect(crew.patch(null, { scale: 9 }).scale).toBe(4);
    expect(crew.patch(null, { scale: 0.1 }).scale).toBe(0.25);
    expect(crew.patch(null, { scale: null }).scale).toBe(1);
    expect(() => crew.patch(null, { scale: 'big' })).toThrow(/scale must be a number/);
    expect(() => crew.patch(null, { scale: -1 })).toThrow(/scale must be a number/);
    expect(crew.patch(null, { heading: -90 }).heading).toBe(270);
    expect(crew.patch(null, { heading: 725 }).heading).toBe(5);
    expect(crew.patch({ heading: 40 }, { heading: null }).heading).toBe(null);
    expect(() => crew.patch(null, { heading: 'north' })).toThrow(/heading must be degrees/);
    expect(() => crew.patch(null, 'on')).toThrow(/setCrew takes/);
  });
});

describe('where it stands (spot) and the mast (lean)', () => {
  const pad = [hole('P-1', 100, 100), hole('P-2', 102, 101, { az: 45, dip: -60 }), hole('P-3', 99, 103, { az: 200, dip: -55 })];
  const spread = [hole('A', 0, 0), hole('B', 100, 0), hole('C', 100, 100), hole('D', 0, 100)];
  const auto = crew.crewOf({ on: true });
  it('a point or a hole', () => {
    expect(crew.spot({ ...auto, at: [5, 6] }, spread)).toEqual({ x: 5, y: 6, hole: null });
    expect(crew.spot({ ...auto, at: 'C' }, spread)).toMatchObject({ x: 100, y: 100, hole: { id: 'C' } });
    expect(crew.spot({ ...auto, at: 'gone' }, spread)).toBe(null);
  });
  it('auto: the one chosen hole, else the common pad, else amid the visible collars', () => {
    expect(crew.spot(auto, spread, { chosen: ['B'] })).toMatchObject({ x: 100, y: 0, hole: { id: 'B' } });
    expect(crew.spot(auto, [...spread, ...pad], { chosen: ['P-1', 'P-2'] })).toEqual({ x: 100, y: 100, hole: null });
    expect(crew.spot(auto, pad)).toEqual({ x: 100, y: 100, hole: null });
    expect(crew.spot(auto, spread)).toEqual({ x: 50, y: 50, hole: null });
    expect(crew.spot(auto, spread, { shown: ['A', 'B'] })).toEqual({ x: 50, y: 0, hole: null });
    expect(crew.spot(auto, spread, { B: { x0: -10, x1: 60, y0: -10, y1: 150 } })).toEqual({ x: 0, y: 50, hole: null }); // the cut-back block's holes
  });
  it('auto on screen: of the collars with room for the rig, the nearest the camera; kept once chosen', () => {
    // A tight cluster at the front, a roomy collar further back, another roomy one nearer; [x, y] of the frame, distance.
    const at = { K1: [0.5, 0.6, 100], K2: [0.51, 0.6, 101], K3: [0.5, 0.61, 102], FAR: [0.3, 0.4, 300], NEAR: [0.7, 0.55, 150], OFF: null };
    const hs = Object.keys(at).map((id, i) => hole(id, i * 100, 0)), view = Object.assign((h) => at[h.id], { frame: [1000, 600] });
    expect(crew.spot(auto, hs, { view })).toMatchObject({ x: 400, hole: { id: 'NEAR' }, pick: 'NEAR' });
    expect(crew.spot({ ...auto, scale: 8 }, hs, { view })).toMatchObject({ pick: 'FAR' }); // no room anywhere: the most room
    expect(crew.spot({ ...auto, pick: 'FAR' }, hs, { view })).toMatchObject({ pick: 'FAR' }); // kept
    expect(crew.spot({ ...auto, pick: 'GONE' }, hs, { view })).toMatchObject({ pick: 'NEAR' }); // chosen again
    expect(crew.spot(auto, hs, { view, chosen: ['K2'] })).toMatchObject({ hole: { id: 'K2' } }); // a chosen hole first
    expect(crew.spot(auto, hs, { view: Object.assign(() => null, { frame: [1000, 600] }) }).pick).toBeUndefined(); // nothing on screen: amid them
  });
  it('the mast follows a hole\'s azimuth and dip, with the vertical exaggeration', () => {
    const L = crew.lean(pad[1]);
    expect(L.az).toBeCloseTo(45, 5);
    expect(L.tilt * 180 / Math.PI).toBeCloseTo(30, 5);
    expect(crew.lean(pad[1], 2).tilt).toBeLessThan(L.tilt);
    expect(crew.lean(pad[0]).tilt).toBeCloseTo(0, 5);
  });
});

describe('the model in the scene (sync, tick, state)', () => {
  let S, H;
  const slope = (x, y) => 100 + 0.2 * x + 0.05 * y; // a tilted surface, metres
  beforeEach(() => {
    S = { crew: { ...crew.CREW }, vex: 1, section: null };
    const B = { x0: -500, x1: 500, y0: -400, y1: 400 };
    const G = { B, cx: 0, cy: 0, bw: 1000, bh: 800, diagH: Math.hypot(1000, 800), surf: slope, V: (x, y, z) => new THREE.Vector3(x, z - 100, -y) };
    const camera = new THREE.PerspectiveCamera(32, 1.5, 1, 1e6); camera.position.set(-800, 600, 900); camera.lookAt(0, 0, 0);
    H = { S, G, project: { holes: [hole('EX-001', 10, 20, { z: slope(10, 20) }), hole('EX-002', 200, -100, { az: 60, dip: -50, z: slope(200, -100) })] }, root: new THREE.Group(), status: () => {}, camera, frame: () => [1200, 800],
      proj: (v) => { const p = v.clone().project(camera); return [(p.x + 1) / 2 * 1200, (1 - p.y) / 2 * 800, p.z]; } };
    crew.init(H);
  });
  const box = () => new THREE.Box3().setFromObject(H.root);
  it('adds nothing while off', () => {
    crew.sync();
    expect(H.root.children.length).toBe(0);
    expect(crew.state()).toMatchObject({ on: false, shown: false, screen: null });
  });
  it('stands on the ground at the collar, neither floating nor buried, sized to the block', () => {
    crew.set({ on: true, at: 'EX-001' }); crew.sync();
    expect(H.root.children.length).toBe(1);
    const g = H.root.children[0], b = box(), size = b.getSize(new THREE.Vector3());
    // The pad's top is level with the highest ground under it and its embankment reaches below the lowest.
    const r = 7.5 * g.scale.x, ground = [];
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, x = 10 + Math.cos(a) * r, y = 20 + Math.sin(a) * r; ground.push(slope(x, y) - 100); }
    expect(g.position.y).toBeGreaterThanOrEqual(slope(10, 20) - 100);
    expect(b.min.y).toBeLessThan(Math.min(...ground));
    expect(size.y).toBeGreaterThan(0.04 * H.G.diagH); // readable at the default view
    expect(Math.max(size.x, size.z)).toBeLessThan(0.2 * H.G.diagH); // never dominating the block
    const st = crew.state();
    expect(st).toMatchObject({ on: true, at: 'EX-001', shown: true, hole: 'EX-001' });
    expect(st.where).toEqual([10, 20]);
    expect(st.screen.every((v) => v > 0 && v < 1)).toBe(true);
  });
  it('scale multiplies the size; heading turns it; moving it rebuilds in place', () => {
    crew.set({ on: true, at: 'EX-001' }); crew.sync(); const s1 = H.root.children[0].scale.x;
    crew.set({ scale: 2 }); crew.sync(); expect(H.root.children[0].scale.x).toBeCloseTo(2 * s1, 6);
    crew.set({ heading: 90 }); crew.sync(); expect(H.root.children[0].rotation.y).toBeCloseTo(0, 6);
    crew.set({ at: 'EX-002', heading: null }); crew.sync();
    expect(H.root.children.length).toBe(1);
    expect(crew.state().where).toEqual([200, -100]);
    expect(H.root.children[0].rotation.y).toBeCloseTo((90 - 60) * Math.PI / 180, 6); // along the hole's azimuth
  });
  it('a spot outside the block is hidden; off removes it', () => {
    crew.set({ on: true, at: [900, 0] }); crew.sync();
    expect(H.root.children.length).toBe(0);
    expect(crew.state().shown).toBe(false);
    crew.set({ at: 'auto' }); crew.sync(); expect(H.root.children.length).toBe(1);
    crew.set({ on: false }); crew.sync(); expect(H.root.children.length).toBe(0);
  });
  it('auto keeps its choice in the settings; collars under the pad give way, its own moves to the rod', () => {
    H.project.holes.push(hole('EX-003', 14, 24, { z: slope(14, 24) }), hole('EX-004', 300, 300, { z: slope(300, 300) }));
    crew.set({ on: true, at: 'EX-001' }); crew.sync();
    expect(crew.collar(H.project.holes[2])).toBe(false); // 6 m away, under the pad
    expect(crew.collar(H.project.holes[3])).toBeUndefined(); // far off: as drawn
    const own = crew.collar(H.project.holes[0]);
    expect(own).toHaveLength(2);
    const st = crew.state(), [W, Hh] = H.frame();
    expect(crew.covers([st.screen[0] * W, st.screen[1] * Hh - 2])).toBe(true);
    expect(crew.covers([5, 5])).toBe(false);
    crew.set({ at: 'auto' }); crew.sync();
    expect(typeof S.crew.pick).toBe('string');
    crew.set({ on: false }); crew.sync();
    expect(crew.collar(H.project.holes[2])).toBeUndefined(); // off: every ring as before
    expect(crew.covers([st.screen[0] * W, st.screen[1] * Hh])).toBe(false);
  });
  it('idles in the live view and holds one fixed pose for exports', () => {
    crew.set({ on: true }); crew.sync();
    const snap = () => { const out = []; H.root.traverse((o) => out.push(o.rotation.toArray().slice(0, 3).join(), o.position.toArray().join())); return out.join('|'); };
    crew.tick(); const still = snap();
    crew.tick(4321); expect(snap()).not.toBe(still);
    crew.tick(); expect(snap()).toBe(still);
  });
  it('the panel lists the holes and hides while off', () => {
    const el = document.createElement('span'); el.innerHTML = '<select></select>';
    crew.renderUI(el); expect(el.hidden).toBe(true);
    crew.set({ on: true, at: 'EX-002' }); crew.renderUI(el);
    expect(el.hidden).toBe(false);
    expect([...el.querySelectorAll('option')].map((o) => o.value)).toEqual(['auto', 'EX-001', 'EX-002']);
    expect(el.querySelector('select').value).toBe('EX-002');
    el.innerHTML = '<select></select><select></select>';
    crew.set({ scale: 1.6 }); crew.renderUI(el);
    const size = el.querySelectorAll('select')[1];
    expect([...size.options].map((o) => o.textContent)).toEqual(['Small', 'Medium', 'Large']);
    expect(size.value).toBe('1.6');
    crew.set({ scale: 2.5 }); crew.renderUI(el);
    expect(size.value).toBe('2.5'); // a size set through the API keeps its own entry
  });
});
