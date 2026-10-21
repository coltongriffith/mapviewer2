import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { DESIGN_VERSION, LEGACY_V1, LEGACY_V2, LEGACY_V4, withDefaults } from '../src/three-d/design-version.js';
import * as mapuse from '../src/three-d/mapuse.js';

// Exploration Maps 3D export options: the drop shadow and "Map use" are plain settings whose defaults keep
// today's look, so no design version or legacy table changes; transparent export is an export option only.
const legacy = JSON.parse(readFileSync('tests/fixtures/three-d/pre-round4-project.json', 'utf8'));
const studio = readFileSync('src/three-d/studio.js', 'utf8');
const NOW = { designVersion: DESIGN_VERSION, designOptIn: [], dropShadow: true, mapInfo: { use: 'presentation', what: '', project: '', date: '', sources: '' } };

describe('export options and design versions', () => {
  it('a figure saved before them opens as a presentation figure with its drop shadow', () => {
    const S = withDefaults(legacy.settings, NOW);
    expect(S.dropShadow).toBe(true);
    expect(S.mapInfo).toEqual(NOW.mapInfo);
    for (const v of [2, 3, 4]) expect(withDefaults({ ...legacy.settings, designVersion: v }, NOW).mapInfo.use).toBe('presentation');
  });
  it('adds no new defaults through the legacy tables or a design version', () => {
    expect(DESIGN_VERSION).toBe(5);
    for (const T of [LEGACY_V1, LEGACY_V2, LEGACY_V4]) { expect(T).not.toHaveProperty('dropShadow'); expect(T).not.toHaveProperty('mapInfo'); }
    // The page's defaults are today's look: the shadow on, a presentation figure.
    expect(studio).toMatch(/dropShadow: true, mapInfo: \{ use: 'presentation', what: '', project: '', date: '', sources: '' \}/);
  });
  it('exports are unchanged without options: the background and shadow apply only when asked', () => {
    expect(studio).toMatch(/clearBg = o\.background === 'transparent'/);
    expect(studio).toMatch(/foot\(o\.shadow \?\? S\.dropShadow\)/);
    expect(studio).toMatch(/background must be "white" or "transparent"/);
  });
});

describe('map use (mapuse.js)', () => {
  let S;
  const host = () => ({
    S, geo: () => ({ label: 'NAD83 / UTM zone 9N (EPSG:26909)' }), fitText: (ctx, t) => t, terrainCredits: (d3) => (d3 ? ['Imagery: Esri'] : []), autoNotes: () => ['Grade shell: exploratory envelope.'],
    INK: '#111', MUTED: '#555', RULE: '#ccc', brandTone: () => '#0b3954',
  });
  beforeEach(() => {
    S = { title: 'STAR PROJECT · RAILS ZONE', subtitle: '3D drilling, looking northeast', company: 'Star Copper', footnote: 'Illustrative data.', mapInfo: { ...NOW.mapInfo } };
    mapuse.init(host());
  });
  it('validates and stores the use and its details', () => {
    expect(mapuse.on()).toBe(false);
    mapuse.set({ use: 'standalone', what: '  Drill plan · Rails zone ', date: 'October 2026', sources: null });
    expect(S.mapInfo).toEqual({ use: 'standalone', what: 'Drill plan · Rails zone', project: '', date: 'October 2026', sources: '' });
    expect(mapuse.on()).toBe(true);
    expect(() => mapuse.set({ use: 'poster' })).toThrow(/presentation.*standalone/);
    const el = { hidden: false }; mapuse.set({ use: 'presentation' }); mapuse.renderUI(el); expect(el.hidden).toBe(true);
  });
  it('gathers the block: what it shows, project and company, date, coordinates, sources, credits and notes', () => {
    mapuse.set({ use: 'standalone', sources: 'Assays: ALS' });
    const D = mapuse.details('3d');
    expect(D.title).toBe(S.title);
    expect(D.what).toBe(S.subtitle); // the subtitle when left blank
    expect(Object.fromEntries(D.rows)).toEqual({
      Project: 'STAR PROJECT · Star Copper', Date: expect.stringMatching(/\d{4}$/), Coordinates: 'NAD83 / UTM zone 9N (EPSG:26909)',
      Sources: 'Assays: ALS · Imagery: Esri', Notes: 'Illustrative data. Grade shell: exploratory envelope.',
    });
  });
  it('lays the block out as a legend card of fixed width, rows sized to their wrapped lines', () => {
    mapuse.set({ use: 'standalone', what: 'Drill plan', date: 'Oct 2026' });
    const ctx = { measureText: (t) => ({ width: t.length * 6 }), fillText: () => {} }, K = { u: 1, font: () => {} };
    const [sec] = mapuse.secs(ctx, K);
    expect(sec).toMatchObject({ key: 'info', minW: 280 });
    expect(sec.rows).toHaveLength(6); // what, then five label rows
    expect(sec.rows[0].h).toBe(20);
    expect(sec.rows.every((r) => typeof r.full === 'function' && r.h > 0)).toBe(true);
  });
});
