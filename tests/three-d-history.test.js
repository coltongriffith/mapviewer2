import { describe, it, expect } from 'vitest';
import { createHistory, describe as describeChange } from '../src/three-d/history.js';
import { isConflict } from '../src/three-d/account-core.js';

describe('settings history', () => {
  const base = { terrain: 'natural', vex: 1, geology: { opacity: 0.85, strength: 1.3 }, logo: null };
  it('records changes, undoes, redoes and drops the redo branch on a new change', () => {
    let t = 0; const H = createHistory(base, 50, () => ++t);
    expect(H.note({ ...base })).toBe(false); // nothing changed
    H.note({ ...base, terrain: 'satellite' });
    H.note({ ...base, terrain: 'satellite', vex: 2 });
    expect(H.states.map((s) => s.label)).toEqual(['Opened', 'Terrain', 'Vertical exaggeration']);
    expect(H.undo()).toMatchObject({ terrain: 'satellite', vex: 1 });
    expect(H.undo()).toMatchObject({ terrain: 'natural' });
    expect(H.undo()).toBeNull();
    expect(H.redo()).toMatchObject({ terrain: 'satellite', vex: 1 });
    H.note({ ...base, terrain: 'satellite', vex: 1 }); // the restore settling: absorbed, not a new entry
    H.note({ ...base, terrain: 'dark' });
    expect(H.states.map((s) => s.label)).toEqual(['Opened', 'Terrain', 'Terrain']);
    expect(H.redo()).toBeNull();
  });
  it('keeps the 50 most recent states', () => {
    const H = createHistory(base);
    for (let i = 0; i < 80; i++) H.note({ ...base, vex: 1 + i / 100 });
    expect(H.states).toHaveLength(50);
    expect(H.states[49].snap.vex).toBeCloseTo(1.79);
  });
  it('says what changed, by name and field', () => {
    expect(describeChange(base, { ...base, geology: { opacity: 1, strength: 1.6 } })).toBe('Geology: opacity, strength');
    expect(describeChange(base, { ...base, terrain: 'dark', vex: 2, lockView: true, title: 'X' })).toBe('Terrain · Vertical exaggeration · Lock view …');
  });
  it('compares long images by a fingerprint, not their full text', () => {
    const img = `data:image/png;base64,${'A'.repeat(50000)}`, H = createHistory({ ...base, geology: { images: { N: img } } });
    expect(H.note({ ...base, geology: { images: { N: `${img}` } } })).toBe(false);
  });
});

describe('save conflict check', () => {
  it('warns when the saved copy is newer than the one this tab opened or saved', () => {
    expect(isConflict('2026-10-20T10:00:00.000Z', '2026-10-20T10:05:00.000Z')).toBe(true);
    expect(isConflict('2026-10-20T10:05:00.000Z', '2026-10-20T10:05:00.000Z')).toBe(false);
    expect(isConflict('2026-10-20T10:05:00+00:00', '2026-10-20T10:05:00.000Z')).toBe(false); // same instant, other format
    expect(isConflict(null, '2026-10-20T10:05:00.000Z')).toBe(false); // a first save
    expect(isConflict('2026-10-20T10:05:00.000Z', undefined)).toBe(false); // the row is gone
  });
});
