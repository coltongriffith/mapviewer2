import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import * as crew from '../src/three-d/crew.js';
import * as life from '../src/three-d/crew-life.js';

// The drill crew's life (crew-life.js): routines on the pad, a little chatter and noticing a viewer, in the live view
// only. The lines go to investors with the figure, so none may say anything about results.
const BANNED = /grade|assay|%|g\/t|discover|\bore\b|high-grade|mineral|result|intercept|metal|gold|copper|silver|lithium|uranium|nickel|zinc|ppm|ounce|\boz\b|resource|reserve|hit\b|strike/i;

describe('the lines', () => {
  it('about the job, safety, weather and coffee: never results', () => {
    expect(life.LINES.length).toBeGreaterThanOrEqual(25);
    expect(life.REACT.length).toBeGreaterThanOrEqual(3);
    for (const l of [...life.LINES, ...life.REACT]) {
      expect(l, l).not.toMatch(BANNED);
      expect(l.toLowerCase(), l).not.toContain('ore'); // not even inside another word
      expect(l.length, l).toBeLessThanOrEqual(32); // a short bubble
    }
    expect(new Set(life.LINES).size).toBe(life.LINES.length);
  });
  it('picked in a fixed order for a seed, never one of the last few again', () => {
    const a = life.picker(life.LINES, 7), b = life.picker(life.LINES, 7), seen = [];
    for (let i = 0; i < 200; i++) { const x = a.next(); expect(b.next()).toBe(x); expect(seen.slice(-6)).not.toContain(x); seen.push(x); }
    expect(new Set(seen).size).toBeGreaterThan(20); // the pool gets used
    const five = (seed) => { const p = life.picker(life.LINES, seed); return Array.from({ length: 5 }, () => p.next()).join('|'); };
    expect(five(8)).not.toBe(five(7)); // another seed, another order
  });
});

describe('the routine scheduler (plan, at)', () => {
  const onPad = (x, z) => (x / 6.3) ** 2 + ((z - 0.35) / 4.3) ** 2 <= 0.96 ** 2; // the level part of the pad (crew.js)
  it('walks at a steady pace between its stops and closes its loop', () => {
    const P = life.plan([0, 0], [{ to: [3.3, 0] }, { act: 'mug', dur: 2, face: 1 }]);
    expect(P.total).toBeCloseTo(3.3 / life.SPEED * 2 + 2, 6);
    expect(life.at(P, 0)).toMatchObject({ x: 0, z: 0, walk: true, yaw: Math.PI / 2 });
    expect(life.at(P, 1.5)).toMatchObject({ walk: true });
    expect(life.at(P, 1.5).x).toBeCloseTo(1.5 * life.SPEED, 6);
    expect(life.at(P, 3.3 / life.SPEED + 1)).toMatchObject({ x: 3.3, z: 0, walk: false, act: 'mug', yaw: 1 });
    expect(life.at(P, 3.3 / life.SPEED + 1).k).toBeCloseTo(0.5, 6);
    expect(life.at(P, P.total + 1.5).x).toBeCloseTo(life.at(P, 1.5).x, 9); // loops
    const back = life.at(P, P.total - 0.01); expect(back.x).toBeLessThan(0.05); expect(back.yaw).toBeCloseTo(-Math.PI / 2, 6);
  });
  it('the crew stay on the pad, each with their own loop, never in step', () => {
    const plans = life.ROUTINES.map(([s, st]) => life.plan(s, st)), totals = plans.map((p) => p.total);
    expect(new Set(totals.map((t) => t.toFixed(3))).size).toBe(plans.length);
    plans.forEach((P) => { for (let t = 0; t < P.total; t += 0.05) { const s = life.at(P, t); expect(onPad(s.x, s.z), `${s.x}, ${s.z}`).toBe(true); } });
    const acts = new Set(plans.flatMap((P) => P.steps.map((s) => s.act)));
    for (const a of ['carry', 'pick', 'feed', 'door', 'mug', 'stretch', 'lean']) expect(acts).toContain(a);
  });
});

describe('in the scene (with crew.js)', () => {
  let S, H, frame;
  beforeEach(() => {
    S = { crew: { ...crew.CREW }, vex: 1, section: null };
    const G = { B: { x0: -500, x1: 500, y0: -400, y1: 400 }, cx: 0, cy: 0, bw: 1000, bh: 800, diagH: Math.hypot(1000, 800), surf: () => 100, V: (x, y, z) => new THREE.Vector3(x, z - 100, -y) };
    const camera = new THREE.PerspectiveCamera(32, 1.5, 1, 1e6); camera.position.set(-300, 200, 300); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    frame = document.createElement('div'); const canvas = document.createElement('canvas'); frame.appendChild(canvas); document.body.appendChild(frame);
    H = { S, G, project: { holes: [{ id: 'EX-001', c: { x: 10, y: 20, z: 100 }, path: [{ x: 10, y: 20, z: 100 }, { x: 10, y: 20, z: 90 }] }] }, root: new THREE.Group(), status: () => {}, camera, renderer: { domElement: canvas }, frame: () => [1200, 800],
      proj: (v) => { const p = v.clone().project(camera); return [(p.x + 1) / 2 * 1200, (1 - p.y) / 2 * 800, p.z]; } };
    crew.init(H);
  });
  const ready = async () => { crew.set({ on: true, at: 'EX-001' }); crew.sync(); await import('../src/three-d/crew-life.js'); await new Promise((r) => setTimeout(r, 0)); };
  const snap = () => { const out = []; H.root.traverse((o) => out.push(o.position.toArray().join(), o.rotation.toArray().slice(0, 3).join(), o.visible)); return out.join('|'); };
  it('an export always sees the fixed pose, whatever the crew were doing', async () => {
    await ready(); const fixed = snap();
    crew.tick(9000); expect(snap()).not.toBe(fixed); // walking, carrying, sipping
    crew.tick(); expect(snap()).toBe(fixed);
    for (const t of [1234, 5678, 23456]) { crew.tick(t); crew.tick(); expect(snap()).toBe(fixed); }
  });
  it('chatter: a bubble within 15 s, one at a time, held a few seconds; none with reduced motion', async () => {
    await ready();
    const p = frame.querySelector('.em3d-crew-talk p');
    expect(p).toBeTruthy();
    let first = null; for (let t = 1; t < 15; t += 0.1) { crew.tick(t * 1000); if (!first && p.classList.contains('on')) first = t; }
    expect(first).toBeGreaterThan(1); expect(first).toBeLessThan(15);
    expect(life.LINES).toContain(p.textContent);
    crew.set({ on: true }); crew.sync(); await new Promise((r) => setTimeout(r, 0));
    const q = frame.querySelector('.em3d-crew-talk p');
    for (let t = 1; t < 30; t += 0.1) { life.tick(t, true); expect(q.classList.contains('on')).toBe(false); }
  });
  it('chatter off: no bubbles; life off: the idle pose, no walking', async () => {
    crew.set({ on: true, at: 'EX-001', chatter: false, life: false }); crew.sync(); await new Promise((r) => setTimeout(r, 0));
    expect(frame.querySelector('.em3d-crew-talk')).toBe(null); // not loaded for neither
    crew.set({ chatter: false, life: true }); crew.sync(); await new Promise((r) => setTimeout(r, 0));
    const p = frame.querySelector('.em3d-crew-talk p'); for (let t = 1; t < 30; t += 0.25) crew.tick(t * 1000);
    expect(p.classList.contains('on')).toBe(false);
    crew.set({ chatter: true, life: false }); crew.sync(); await new Promise((r) => setTimeout(r, 0));
    const before = snap(); expect(life.tick(3, false)).toBe(false); expect(snap()).toBe(before);
  });
  const at = (i) => { const [x, y] = crew.state().people[i]; return { clientX: x * 1200, clientY: y * 800, bubbles: true }; };
  it('pointing at one of the crew: a hello; with reduced motion only a tap gets one', async () => {
    await ready(); crew.tick(1000);
    const canvas = frame.querySelector('canvas'), p = frame.querySelector('.em3d-crew-talk p');
    canvas.dispatchEvent(new MouseEvent('pointermove', at(1)));
    expect(p.classList.contains('on')).toBe(true); expect(life.REACT).toContain(p.textContent);
    expect(canvas.style.cursor).toBe('pointer');
    crew.set({ on: true }); crew.sync(); await new Promise((r) => setTimeout(r, 0)); crew.tick(1000);
    const mm = window.matchMedia; window.matchMedia = (q) => ({ matches: /reduce/.test(q) });
    try {
      const q = frame.querySelector('.em3d-crew-talk p');
      canvas.dispatchEvent(new MouseEvent('pointermove', at(0)));
      expect(q.classList.contains('on')).toBe(false); // pointing alone: nothing
      canvas.dispatchEvent(new MouseEvent('pointerdown', at(0))); canvas.dispatchEvent(new MouseEvent('pointerup', at(0)));
      expect(q.classList.contains('on')).toBe(true); expect(life.REACT).toContain(q.textContent); // a tap: hello
    } finally { window.matchMedia = mm; }
  });
  it('only over the 3D view: the section view hides the bubbles and the crew can\'t be pointed at there', async () => {
    await ready();
    const canvas = frame.querySelector('canvas'), box = frame.querySelector('.em3d-crew-talk'), p = box.querySelector('p');
    for (let t = 1; t < 15 && !p.classList.contains('on'); t += 0.1) crew.tick(t * 1000);
    expect(p.classList.contains('on')).toBe(true);
    canvas.hidden = true; await new Promise((r) => setTimeout(r, 0)); // studio.js showView('section')
    expect(box.hidden).toBe(true); expect(p.classList.contains('on')).toBe(false);
    canvas.dispatchEvent(new MouseEvent('pointerdown', at(1))); canvas.dispatchEvent(new MouseEvent('pointerup', at(1)));
    expect(p.classList.contains('on')).toBe(false);
    canvas.hidden = false; await new Promise((r) => setTimeout(r, 0)); // back to 3D
    expect(box.hidden).toBe(false); expect(p.classList.contains('on')).toBe(false); // no stale bubble
    let back = null; for (let t = 20; t < 40 && !back; t += 0.1) { crew.tick(t * 1000); if (p.classList.contains('on')) back = t; }
    expect(back).toBeGreaterThan(21); expect(back).toBeLessThan(26); // chatter starts afresh
  });
  it('off removes the bubbles and the listeners', async () => {
    await ready(); expect(frame.querySelector('.em3d-crew-talk')).toBeTruthy();
    crew.set({ on: false }); crew.sync();
    expect(frame.querySelector('.em3d-crew-talk')).toBe(null);
  });
});
