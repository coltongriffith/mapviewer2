import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DESIGN_VERSION, LEGACY_V1, LEGACY_V2, FEATURES, uses, withDefaults } from '../src/three-d/design-version.js';
import { intercept } from '../src/three-d/intercepts.js';

// A figure saved before the October 2026 design rounds: getProject() then, with no designVersion.
const legacy = JSON.parse(readFileSync('tests/fixtures/three-d/pre-round4-project.json', 'utf8'));
// Today's defaults for the settings that changed (S_DEFAULTS in studio.js, abridged).
const NOW = {
  designVersion: DESIGN_VERSION, designOptIn: [], lockView: false, coPlacement: 'column', blockMargin: null, blockExtent: null,
  legend: { merge: 'auto', pos: {} }, imagery: { saturation: 1.05, contrast: 1.12, warmth: 0.25, relief: 0.55 },
  shell: { enabled: false, cutoff: null, opacity: 0.3, color: null, search: null, cell: null, throughTerrain: false },
  geology: { enabled: false, title: 'Lithology', faces: 'far', opacity: 0.85, strength: 1.3, hidden: 'nearest', anisotropy: 4, search: null, smooth: 2, texture: true, section: false, legend: [], images: {}, note: '' },
  tags: { at: 'toe', style: 'dark', status: {}, fadePrevious: false, groups: [], autoGroup: false, groupRadius: 140, emphasis: 'auto', highlight: {}, highlightNew: true, idMode: 'auto', showId: {}, showTag: {}, hideRows: [], pending: 'collar' },
};

describe('figure design versions', () => {
  it('opens a figure saved before version 2 with the earlier look', () => {
    expect(legacy.settings.designVersion).toBeUndefined();
    const S = withDefaults(legacy.settings, NOW);
    expect(S.designVersion).toBe(1);
    expect(S.imagery).toEqual({ saturation: 1.15, contrast: 1, warmth: 0, relief: 0 });
    expect(S.legend).toEqual({ merge: 'separate', pos: { main: 'br' } });
    expect(S.tags).toMatchObject({ emphasis: 'none', highlightNew: false, idMode: 'all', showTag: {}, hideRows: [], highlight: {} });
    expect(S.geology).toMatchObject({ strength: 1, hidden: 'clear', note: legacy.settings.geology.note });
    expect(S.shell).toMatchObject({ color: '#1f9e96', throughTerrain: false });
    expect(S.designOptIn).toEqual([]);
    for (const f of Object.keys(FEATURES)) expect(uses(S, f), f).toBe(false);
    // What the figure saved is kept as it was.
    for (const [k, v] of Object.entries(legacy.settings)) expect(S[k], k).toEqual(v && typeof v === 'object' && !Array.isArray(v) ? expect.objectContaining(v) : v);
  });

  it('fills only what is missing: a saved choice wins over the legacy value', () => {
    const S = withDefaults({ ...legacy.settings, tags: { ...legacy.settings.tags, emphasis: 'key' }, imagery: { relief: 0.3 } }, NOW);
    expect(S.tags.emphasis).toBe('key');
    expect(S.tags.highlightNew).toBe(false);
    expect(S.imagery).toEqual({ saturation: 1.15, contrast: 1, warmth: 0, relief: 0.3 });
    expect(LEGACY_V1.imagery.relief).toBe(0); // the table itself is never written to
  });

  it('a current figure takes today\'s defaults for anything missing, and every new behaviour', () => {
    const S = withDefaults({ designVersion: DESIGN_VERSION, title: 'NEW' }, NOW);
    expect(S).toMatchObject({ designVersion: DESIGN_VERSION, title: 'NEW', imagery: NOW.imagery, legend: NOW.legend, tags: { emphasis: 'auto', idMode: 'auto', highlightNew: true }, geology: { strength: 1.3, hidden: 'nearest' } });
    for (const f of Object.keys(FEATURES)) expect(uses(S, f), f).toBe(true);
  });

  it('opens a version 2 figure without round 5\'s look, and a version 1 figure with both tables', () => {
    const now = { ...NOW, shell: { ...NOW.shell, shading: 'solid+edges' }, scene: { sunAz: 315, sunAlt: 40, shadow: 0.35, ao: 0.5, haze: 0, theme: 'light', edge: '#1e1d26' }, autoLabels: true };
    const two = withDefaults({ designVersion: 2, shell: { enabled: true, opacity: 0.3 }, geology: { enabled: true } }, now);
    expect(two.shell).toMatchObject({ enabled: true, opacity: 0.3, shading: 'glass' });
    expect(two.scene).toEqual(LEGACY_V2.scene);
    expect(two.geology).toMatchObject({ enabled: true, contacts: false, labels: false, clean: false });
    expect(two.autoLabels).toBe(false);
    expect(uses(two, 'holeTags')).toBe(true); expect(uses(two, 'clearLeaders')).toBe(false);
    expect(withDefaults({ designVersion: 2, autoLabels: true }, now).autoLabels).toBe(true); // a saved choice wins
    const one = withDefaults(legacy.settings, now);
    expect(one.shell).toMatchObject({ color: '#1f9e96', shading: 'glass' }); expect(one.scene.shadow).toBe(0);
    expect(withDefaults({ designVersion: 3 }, now)).toMatchObject({ scene: now.scene, autoLabels: true, shell: { shading: 'solid+edges' } });
  });

  it('a version 2 or 3 figure keeps its section drawing; version 4 cuts traces at the slab and spreads the IDs', () => {
    const S = withDefaults({ designVersion: 2, title: 'V2' }, NOW);
    expect(uses(S, 'sampledIntercepts')).toBe(true);
    expect(uses(S, 'cleanSection')).toBe(false);
    expect(FEATURES.cleanSection).toBe(4);
    expect(uses(withDefaults({ designVersion: 3 }, NOW), 'cleanSection')).toBe(false); // round 5 figures too
  });

  it('keeps the version through a save and reopen', () => {
    for (const v of [1, 2]) {
      const opened = withDefaults(v === 1 ? legacy.settings : { ...legacy.settings, designVersion: 2 }, NOW);
      const saved = JSON.parse(JSON.stringify({ ...legacy, settings: opened })); // getProject(), through the account or a share
      const again = withDefaults(saved.settings, NOW);
      expect(again.designVersion).toBe(v);
      expect(again).toEqual(opened);
    }
    expect(withDefaults({ designVersion: 'x' }, NOW).designVersion).toBe(1);
  });

  it('takes one newer behaviour early without the rest', () => {
    const S = { ...withDefaults(legacy.settings, NOW), designOptIn: ['sampledIntercepts'] };
    expect(uses(S, 'sampledIntercepts')).toBe(true);
    expect(uses(S, 'footerBand')).toBe(false);
  });

  it('the fixture\'s gap hole: the earlier 110 m callout is flagged, the recalculation never spans the gap', () => {
    const rows = legacy.files.find((f) => f.role === 'assay').text.split('\n').slice(1).map((l) => l.split(','));
    const hole = (id) => rows.filter((r) => r[0] === id).map(([, from, to, v]) => ({ from: +from, to: +to, vals: { Cu_pct: +v } })).sort((a, b) => a.from - b.from);
    const { coCut, coIncl, coMin } = legacy.settings;
    expect(intercept(hole('S-037'), 'Cu_pct', coCut, coIncl, coMin, false)).toMatchObject({ broad: { len: 110, avg: 1.5, from: 0 }, gap: 90 });
    expect(intercept(hole('S-037'), 'Cu_pct', coCut, coIncl, coMin, true)).toBeNull(); // two 10 m zones, each under 20 m
    expect(intercept(hole('S-038'), 'Cu_pct', coCut, coIncl, coMin, false)).toMatchObject({ overlap: true, gap: 0 });
    expect(intercept(hole('S-038'), 'Cu_pct', coCut, coIncl, coMin, true).broad).toMatchObject({ len: 24, from: 20 });
    expect(intercept(hole('S-035'), 'Cu_pct', coCut, coIncl, coMin, false)).toMatchObject({ gap: 0, overlap: false });
  });
});
