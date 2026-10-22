import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { init, setBlock, BLOCK, bandSpot, fadeAlpha, ghostMaterial } from '../src/three-d/block.js';
import { init as initTags, bracketSides, groupItems, set as setTags } from '../src/three-d/tags.js';

// Exploration Maps 3D round 5F: bracket callouts, wall labels by unit, a see-through terrain that keeps its colours,
// the fade at the bottom of the block, and bracket callouts never pulled into a group card (B6).

const host = () => { const S = { holesShown: null, block: null }; init({ S, G: {}, project: { holes: [{ id: 'A' }] }, rebuild: () => {}, setStyle: () => {}, renderExtUI: () => {}, status: () => {} }); return S; };

describe('block settings of round 5F', () => {
  it('starts a new block with unit labels inside their band, a vivid see-through terrain and no fade', () => {
    expect(BLOCK).toMatchObject({ brackets: 'plain', units: 'auto', surface: 'vivid', fadeBottom: 0 });
  });
  it('checks the bracket style, the unit labels, the terrain blend and the fade', () => {
    const S = host();
    setBlock({ brackets: 'callout', units: 'fixed', surface: 'mix', fadeBottom: 1.7 });
    expect(S.block).toMatchObject({ brackets: 'callout', units: 'fixed', surface: 'mix', fadeBottom: 1 });
    setBlock({ fadeBottom: -1 }); expect(S.block.fadeBottom).toBe(0);
    expect(() => setBlock({ brackets: 'boxed' })).toThrow(/brackets must be "plain".*"callout"/);
    expect(() => setBlock({ units: 'free' })).toThrow(/units must be "auto"/);
    expect(() => setBlock({ surface: 'clear' })).toThrow(/surface must be "vivid"/);
    expect(() => setBlock({ fadeBottom: 'a lot' })).toThrow(/fadeBottom must be 0/);
    expect(S.block.brackets).toBe('callout'); // a refused patch changes nothing
  });
  it('keeps the earlier look for a block saved before these settings', () => {
    const S = host();
    S.block = { furniture: true, traces: 'overlay', brackets: 'plain', page: 'bare', hist: BLOCK.hist }; // as saved by round 5E
    setBlock({ page: 'clean' });
    expect(S.block.units).toBeUndefined(); expect(S.block.surface).toBeUndefined(); expect(S.block.fadeBottom).toBeUndefined();
  });
});

describe('the fade at the bottom', () => {
  it('is opaque at the base and gone at the top of its band, falling all the way', () => {
    expect(fadeAlpha(0)).toBe(1); expect(fadeAlpha(1)).toBe(0); expect(fadeAlpha(2)).toBe(0); expect(fadeAlpha(-1)).toBe(1);
    const a = [0, 0.25, 0.5, 0.75, 1].map(fadeAlpha);
    a.slice(1).forEach((v, i) => expect(v).toBeLessThan(a[i]));
    expect(fadeAlpha(0.5)).toBeLessThan(0.5); // eases out: most of the fade is low down
  });
});

describe('the see-through terrain\'s ghosts (ghostMaterial)', () => {
  it('keeps each object\'s own colour and opacity, at the share the terrain lets through', () => {
    const model = new THREE.MeshLambertMaterial({ color: '#3366cc', transparent: true, opacity: 0.5 }), g = ghostMaterial(model, 0.6);
    expect(g.color.getHexString()).toBe('3366cc'); expect(g.opacity).toBeCloseTo(0.3, 9);
    const shell = new THREE.MeshLambertMaterial({ color: '#c65322' }), gs = ghostMaterial(shell, 0.6);
    expect(gs.color.getHexString()).toBe('c65322'); expect(gs.opacity).toBeCloseTo(0.6, 9); expect(gs).not.toBe(g);
    expect(ghostMaterial(model, 0.6)).toBe(g); // one ghost per material, kept up to date
    model.color.set('#00ff00'); expect(ghostMaterial(model, 0.6).color.getHexString()).toBe('00ff00');
  });
  it('draws nothing for an object at opacity 0, hidden, or with the terrain opaque', () => {
    expect(ghostMaterial(new THREE.MeshLambertMaterial({ transparent: true, opacity: 0 }), 0.6)).toBe(null);
    expect(ghostMaterial(new THREE.MeshLambertMaterial({ visible: false }), 0.6)).toBe(null);
    expect(ghostMaterial(new THREE.MeshLambertMaterial(), 0)).toBe(null);
    expect(ghostMaterial([new THREE.MeshLambertMaterial()], 0.6)).toBe(null);
  });
});

describe('wall labels by unit (bandSpot)', () => {
  // A 100 × 50 grid, 100 units across and 50 up (row 0 at the top): unit 1 a band rising to the right, about 12 rows
  // thick, between unit 0 above and unit 2 below; -1 (above the terrain) over the top rows.
  const nx = 101, ny = 51, len = 100, ht = 50;
  const grid = (thick = 12, slope = 0.2) => {
    const cls = new Int16Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const top = 30 - slope * i; cls[j * nx + i] = j < 3 ? -1 : j < top ? 0 : j < top + thick ? 1 : 2; }
    return cls;
  };
  const inside = (cls, s, w, h) => { // every corner and the middle of the placed label in unit 1
    const a = s.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), hw = w * s.scale / 2, hh = h * s.scale / 2;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].every(([p, q]) => { const x = s.x + p * hw * ca - q * hh * sa, z = s.z + p * hw * sa + q * hh * ca; return cls[Math.round(ht - z) * nx + Math.round(x)] === 1; });
  };
  it('puts the label wholly inside its unit, turned to follow the band', () => {
    const cls = grid(), s = bandSpot(cls, nx, ny, 1, len, ht, 30, 5);
    expect(s).not.toBe(null);
    expect(inside(cls, s, 30, 5)).toBe(true);
    expect(s.angle).toBeGreaterThan(5); expect(s.angle).toBeLessThan(18); // the band rises about 11° to the right
    expect(s.scale).toBe(1);
  });
  it('shrinks the label to fit a thinner band, and gives up rather than cross into another unit', () => {
    const thin = grid(6, 0), s = bandSpot(thin, nx, ny, 1, len, ht, 30, 5);
    expect(s.scale).toBeLessThan(1); expect(inside(thin, s, 30, 5)).toBe(true); expect(s.angle).toBe(0);
    expect(bandSpot(grid(2, 0), nx, ny, 1, len, ht, 30, 5)).toBe(null);
  });
  it('keeps clear of what room() marks: covered spots never, holes as far as it can', () => {
    const cls = grid(14, 0);
    const right = bandSpot(cls, nx, ny, 1, len, ht, 20, 4, (x) => (x < 60 ? -Infinity : 10));
    expect(right.x).toBeGreaterThanOrEqual(60);
    const far = bandSpot(cls, nx, ny, 1, len, ht, 20, 4, (x) => Math.abs(x - 20) - 5); // a hole at x = 20
    expect(Math.abs(far.x - 20)).toBeGreaterThan(50);
    expect(bandSpot(cls, nx, ny, 1, len, ht, 20, 4, () => -Infinity)).toBe(null);
  });
});

describe('bracket callouts (tags.js)', () => {
  it('puts the holes on alternate sides, left to right', () => {
    const s = bracketSides([{ id: '078', x: 300 }, { id: '077', x: 520 }, { id: '078', x: 340 }, { id: '061', x: 900 }]);
    expect(s.get('078')).toBe(-1); expect(s.get('077')).toBe(1); expect(s.get('061')).toBe(-1);
    expect(bracketSides([{ id: 'A', x: 10 }]).get('A')).toBe(-1);
  });
  it('never merges a bracket callout into a group card (B6: the column could drop it)', () => {
    const S = { tags: { groups: [], autoGroup: true, groupRadius: 140 }, coPlacement: 'bracket', designVersion: 5 };
    initTags({ S, coOv: () => ({}), calloutLines: () => ({ l1: '10 m @ 1 g/t', l1b: '', l2: '' }) });
    const ctx = { measureText: () => ({ width: 50 }), set font(v) { this.f = v; } }, K = { u: 1, font: () => {} };
    const it_ = (id, x) => ({ c: { h: { id, posAt: () => ({ x, y: 0, z: 0 }) }, ic: { broad: { mid: 0 } }, key: id }, s: [x, 100, 0], rank: 0 });
    const items = [it_('077', 0), it_('078', 5)];
    expect(groupItems(ctx, K, items).filter((x) => x.group)).toHaveLength(0);
    S.coPlacement = 'beside'; setTags({});
    expect(groupItems(ctx, K, items).filter((x) => x.group)).toHaveLength(1); // boxes beside their hole still group
  });
});
