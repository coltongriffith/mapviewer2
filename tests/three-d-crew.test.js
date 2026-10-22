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
    expect(crew.CREW).toEqual({ on: false, at: 'auto', scale: 1, heading: null, chatter: true, life: true }); // life and chatter on whenever the crew is
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
    expect(c).toEqual({ on: true, at: 'auto', scale: 2, heading: null, chatter: true, life: true });
    expect(crew.patch(c, { chatter: 0, life: false })).toMatchObject({ chatter: false, life: false });
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
    // The pad is level under the rig, at the ground's middle height there (never more than a lip below its highest),
    // and its gravel ramps down or up to meet the ground at its rim: no wall, no gap.
    const u = g.scale.x, under = [];
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; under.push(slope(g.position.x + Math.cos(a) * 4 * u, -g.position.z + Math.sin(a) * 4 * u) - 100); } // round the rig's middle
    expect(g.position.y).toBeGreaterThan(Math.min(...under));
    expect(g.position.y).toBeLessThan(Math.max(...under));
    expect(Math.max(...under) - g.position.y).toBeLessThanOrEqual(0.27 * u + 1e-6);
    g.updateMatrixWorld(true);
    const pad = g.children.find((o) => o.material?.vertexColors && o.material.type === 'MeshLambertMaterial'), P = pad.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = P.count - 24; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(pad.matrixWorld); expect(Math.abs(v.y - (slope(v.x, -v.z) - 100))).toBeLessThan(0.05 * u); }
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
    expect([...size.options].map((o) => o.textContent)).toEqual(['Small', 'Medium', 'Large', 'True scale']);
    expect(size.value).toBe('1.6');
    crew.set({ scale: 2.5 }); crew.renderUI(el);
    expect(size.value).toBe('2.5'); // a size set through the API keeps its own entry
  });
});

// True scale: the rig and crew at real size, a 12 m mast on an 8 m skid and crew 1.8 m tall, in the scene's metres;
// heights take the vertical exaggeration as the terrain does. Off by default; the presets are unchanged.
describe('true scale', () => {
  it('the dimensions: plan from the skid, height from the mast, crew 1.8 m, heights times the exaggeration', () => {
    const t = crew.trueScale();
    expect(crew.MODEL.length * t.plan).toBeCloseTo(8, 9); // metres over the skids
    expect(crew.MODEL.mast * t.up).toBeCloseTo(12, 9); // the mast's top
    expect(crew.MODEL.person * t.person * t.up).toBeCloseTo(1.8, 9); // a person, to the hat
    expect(crew.MODEL.width * t.plan).toBeCloseTo(2.51, 2); // the deck
    const v3 = crew.trueScale(1, 3); // VE 3: up stretched as the terrain is, across unchanged
    expect(v3.plan).toBeCloseTo(t.plan, 12);
    expect(crew.MODEL.mast * v3.up).toBeCloseTo(36, 9);
    expect(crew.MODEL.person * v3.person * v3.up).toBeCloseTo(5.4, 9);
    expect(v3.person).toBe(t.person); // their own scale is a proportion, the exaggeration comes from the group
    const k2 = crew.trueScale(2, 2); // two scene units per metre (another unit): everything twice
    expect(crew.MODEL.length * k2.plan).toBeCloseTo(16, 9);
    expect(crew.MODEL.mast * k2.up).toBeCloseTo(24, 9);
    // The mast's lean inside a group stretched up keeps it along the drawn trace; unstretched, exactly as given.
    expect(crew.tiltIn(0.3, 2, 2)).toBe(0.3);
    const tl = crew.tiltIn(0.3, 0.8, 1.6), dir = [0.8 * Math.sin(tl), 1.6 * Math.cos(tl)];
    expect(Math.atan2(dir[0], dir[1])).toBeCloseTo(0.3, 12);
  });
  it('setCrew takes scale "true" (or size "true"), off by default, presets unchanged', () => {
    expect(crew.CREW.scale).toBe(1);
    expect(crew.patch(null, { on: true, scale: 'true' }).scale).toBe('true');
    expect(crew.patch(null, { size: 'true' }).scale).toBe('true');
    expect(crew.patch(null, { size: 'Large' }).scale).toBe(1.6);
    expect(crew.patch(null, { scale: true }).scale).toBe('true');
    expect(crew.patch({ scale: 'true' }, { scale: 1.6 }).scale).toBe(1.6);
    expect(() => crew.patch(null, { size: 'huge' })).toThrow(/size: "small"/);
    expect(crew.patch(null, { label: 0 }).label).toBe(false);
    expect(crew.patch(null, {})).not.toHaveProperty('label'); // saved settings gain no key
  });

  let S, H;
  const flat = () => 100;
  const V = (vex) => (x, y, z) => new THREE.Vector3(x, (z - 100) * vex, -y);
  const make = (vex = 1) => {
    S = { crew: { ...crew.CREW }, vex, section: null };
    const B = { x0: -300, x1: 300, y0: -200, y1: 200 };
    const G = { B, cx: 0, cy: 0, bw: 600, bh: 400, diagH: Math.hypot(600, 400), surf: flat, V: V(vex) };
    const camera = new THREE.PerspectiveCamera(32, 1.5, 1, 1e6); camera.position.set(-400, 300, 450); camera.lookAt(0, 0, 0);
    H = { S, G, project: { holes: [hole('EX-001', 10, 20), hole('EX-002', -80, 40, { az: 60, dip: -50 })] }, root: new THREE.Group(), status: () => {}, camera, frame: () => [1200, 800],
      proj: (v) => { const p = v.clone().project(camera); return [(p.x + 1) / 2 * 1200, (1 - p.y) / 2 * 800, p.z]; },
      controls: { target: new THREE.Vector3(0, -100, 0), min0: 300, minDistance: 300 }, INK: '#142126', paper: (a) => `rgba(255,255,255,${a})` };
    crew.init(H);
  };
  const parts = () => { const g = H.root.children[0]; g.updateMatrixWorld(true); return { g, rig: g.children[0], people: g.children.slice(5, 8) }; };
  const ext = (o) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
  it('builds at real size on the ground, in the scene\'s metres, heights times the exaggeration', () => {
    for (const vex of [1, 2.5]) {
      make(vex); crew.set({ on: true, at: 'EX-001', scale: 'true', heading: 90 }); crew.sync(); // heading 90: the skid runs east
      const { g, rig, people } = parts(), r = ext(rig);
      expect(g.position.y).toBeCloseTo(0, 6); // on the flat ground
      expect(r.x).toBeGreaterThan(7.9); expect(r.x).toBeLessThan(8.2); // 8 m over the skids (with the ink outline)
      expect(r.y / vex).toBeGreaterThan(11.9); expect(r.y / vex).toBeLessThan(12.3); // a 12 m mast, stretched up by VE
      expect(r.z).toBeGreaterThan(2.4); expect(r.z).toBeLessThan(2.7); // the deck's width
      people.forEach((f) => { const s = ext(f); expect(s.y / vex).toBeGreaterThan(1.75); expect(s.y / vex).toBeLessThan(1.9); }); // 1.8 m, with the ink outline
      const m = crew.state().metres;
      expect(m.mast).toBeCloseTo(12, 6); expect(m.length).toBeCloseTo(8, 6); expect(m.person).toBeCloseTo(1.8, 6); expect(m.ve).toBeCloseTo(vex, 9);
    }
  });
  it('is the same size on any block, unlike the presets', () => {
    make(); crew.set({ on: true, at: 'EX-001', scale: 'true' }); crew.sync(); const a = H.root.children[0].scale.toArray();
    H.G.diagH *= 10; H.G.bw *= 10; H.G.bh *= 10; crew.sync(); expect(H.root.children[0].scale.toArray()).toEqual(a);
    crew.set({ scale: 1.6 }); crew.sync(); const big = H.root.children[0].scale; expect(big.x).toBe(big.y); expect(big.x).toBeGreaterThan(5 * a[0]);
    expect(crew.state().metres).toBeUndefined();
  });
  it('at a hole the mast lines up with the drawn trace, with the exaggeration', () => {
    for (const vex of [1, 3]) {
      make(vex); crew.set({ on: true, at: 'EX-002', scale: 'true' }); crew.sync();
      const { rig } = parts(), mast = rig.children.find((o) => o.isGroup && o.rotation.z !== 0);
      const a = new THREE.Vector3(0, 0, 0).applyMatrix4(mast.matrixWorld), b = new THREE.Vector3(0, 10, 0).applyMatrix4(mast.matrixWorld), up = b.sub(a).normalize();
      const h = H.project.holes[1], t = H.G.V(h.path[0].x, h.path[0].y, h.path[0].z).sub(H.G.V(h.path[5].x, h.path[5].y, h.path[5].z)).normalize(); // up the trace
      expect(up.dot(t)).toBeGreaterThan(0.9999);
    }
  });
  it('lets the camera in close only while it looks at the shown crew', () => {
    make(); crew.set({ on: true, at: 'EX-001', scale: 'true' }); crew.sync();
    expect(H.controls.minDistance).toBe(300); // the target is the block's middle, 22 m off
    const { g } = parts(), mid = new THREE.Vector3(0, 0.45 * crew.MODEL.mast, 0).applyMatrix4(g.matrixWorld);
    expect(crew.reach(mid)).toBeGreaterThan(6); expect(crew.reach(mid)).toBeLessThan(10); // 0.6 of the 12.8 m rig
    expect(crew.reach(new THREE.Vector3(200, 0, 0))).toBe(null);
    H.controls.target.copy(mid); crew.sync(); expect(H.controls.minDistance).toBeCloseTo(crew.reach(mid), 9);
    crew.set({ on: false }); crew.sync(); expect(H.controls.minDistance).toBe(300); // off: the figure's own limit
    expect(crew.reach(mid)).toBe(null);
  });
  it('labels the rig at true scale only, in the overlay, unless label is false', () => {
    make();
    const said = [], ctx = new Proxy({ measureText: (t) => ({ width: t.length * 6 }), fillText: (t) => said.push(t) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
    const K = { u: 1, font: () => {} }, occ = [];
    crew.set({ on: true, at: 'EX-001', scale: 1.6 }); crew.sync(); crew.draw(ctx, K, occ); expect(said).toEqual([]);
    crew.set({ scale: 'true' }); crew.sync(); crew.draw(ctx, K, occ); expect(said).toEqual(['Drill rig, true scale']); expect(occ).toHaveLength(1);
    crew.set({ label: false }); crew.sync(); crew.draw(ctx, K, occ); expect(said).toHaveLength(1);
  });
  it('at true scale still idles live and holds the fixed pose for exports; the panel shows the hint', () => {
    make(); crew.set({ on: true, scale: 'true' }); crew.sync();
    const snap = () => { const out = []; H.root.traverse((o) => out.push(o.rotation.toArray().slice(0, 3).join(), o.position.toArray().join(), o.scale.toArray().join())); return out.join('|'); };
    crew.tick(); const still = snap();
    crew.tick(5321); expect(snap()).not.toBe(still);
    crew.tick(); expect(snap()).toBe(still);
    const el = document.createElement('span'); el.innerHTML = '<select></select><select></select><button></button><small class="crew-hint" hidden></small>';
    crew.renderUI(el); expect(el.querySelectorAll('select')[1].value).toBe('true'); expect(el.querySelector('.crew-hint').hidden).toBe(false);
    expect(typeof el.querySelector('button').onclick).toBe('function');
    crew.set({ scale: 1 }); crew.renderUI(el); expect(el.querySelector('.crew-hint').hidden).toBe(true);
  });
  it('studio.js: the zoom range reaches in only through the crew\'s hook, and the API and panel are there', () => {
    expect(studio).toMatch(/nd = EXT\.crew\?\.reach\(T\), zoom = Math\.max\(40, Math\.min\(nd \? Math\.max\(250, b \* 100 \/ nd\) : 250,/);
    expect(studio).toMatch(/controls\.minDistance = Math\.min\(controls\.min0, nd \|\| Infinity\)/);
    expect(studio).toMatch(/async zoomToCrew\(\)/);
    expect(page).toMatch(/<option value="true">True scale<\/option>/);
    expect(page).toMatch(/id="crew-zoom"[^>]*>Zoom to crew</);
    expect(page).toMatch(/At true scale the rig is ~12 m tall — zoom in to see it\./);
  });
});
