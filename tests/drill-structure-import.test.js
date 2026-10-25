// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { autoMapping, buildImport, detectKind, diffSentence, drillDb } from '../src/utils/drillDb.js';
import { newerSince, snapshotOf, toFiles } from '../src/three-d/property-data.js';
const header = ['HoleID', 'Depth', 'Type', 'Alpha', 'Beta', 'Dip', 'DipDir', 'Comments'];
const build = (rows, h = header) => buildImport('structure', { header: h, rows, lines: rows.map((_, i) => i + 2) }, autoMapping('structure', h, rows));

describe('structure measurement mapping', () => {
  it('detects structure from core angles, dip direction or a structure column, never from a plain survey', () => {
    expect(detectKind(header, [['H1', '10', 'vein', '45', '210', '', '', '']], 'data.csv')).toBe('structure');
    expect(detectKind(['Hole', 'Depth', 'Structure', 'Dip', 'Dip Direction'], [], 'logs.csv')).toBe('structure');
    expect(detectKind(['HoleID', 'Depth', 'Dip', 'Azimuth', 'Comments'], [], 'structure.csv')).toBe('structure');
    expect(detectKind(['HoleID', 'Depth', 'Azimuth', 'Dip'], [['H1', '5', '90', '-60']], 'surveys.csv')).toBe('surveys');
    expect(detectKind(['HoleID', 'From', 'To', 'Code'], [['H1', '0', '1', 'QZ']], 'data.csv')).toBe('lithology');
  });
  it('maps common headers, preferring an explicit dip direction over azimuth', () => {
    expect(autoMapping('structure', header, []).columns).toEqual({ hole_id: 'HoleID', depth_m: 'Depth', type: 'Type', alpha: 'Alpha', beta: 'Beta', dip: 'Dip', dip_direction: 'DipDir', description: 'Comments' });
    expect(autoMapping('structure', ['Hole', 'Depth', 'Structure', 'Azimuth', 'Dip', 'Dip Direction'], []).columns).toMatchObject({ type: 'Structure', dip: 'Dip', dip_direction: 'Dip Direction' });
    expect(autoMapping('structure', ['Hole', 'Depth', 'Dip', 'Azimuth'], []).columns).toMatchObject({ dip: 'Dip', dip_direction: 'Azimuth' });
  });
  it('builds point rows keeping type as text and dips positive', () => {
    const r = build([['H1', '10.5', 'Vein', '45', '210', '', '', ''], ['H1', '12', 'fault', '', '', '70', '135', 'Gouge'], ['H1', '14', '', '', '', '', '', 'Broken core']]);
    expect(r.errorCount).toBe(0); expect(r.warnings).toEqual([]);
    expect(r.rows).toEqual([{ hole_id: 'H1', depth_m: 10.5, type: 'Vein', alpha: 45, beta: 210 },
      { hole_id: 'H1', depth_m: 12, type: 'fault', dip: 70, dip_direction: 135, description: 'Gouge' }, { hole_id: 'H1', depth_m: 14, description: 'Broken core' }]);
  });
  it.each([
    [['H1', '1', 'vein', '91', '', '', '', ''], /Alpha 91 is outside 0 to 90/],
    [['H1', '1', 'vein', '10', '361', '', '', ''], /Beta 361 is outside 0 to 360/],
    [['H1', '1', 'vein', '', '', '-60', '', ''], /Dip -60 is outside 0 to 90/],
    [['H1', '1', 'vein', '', '', '60', '400', ''], /Dip direction 400 is outside 0 to 360/],
    [['H1', '1', 'vein', '', '20', '', '', 'x'], /Beta needs an alpha/],
    [['H1', '1', 'vein', '', '', '', '20', 'x'], /Dip direction needs a dip/],
    [['H1', '1', 'vein', '', '', '', '', ''], /No alpha, dip or description/],
    [['H1', '', 'vein', '10', '', '', '', ''], /Depth is empty/],
    [['H1', '-1', 'vein', '10', '', '', '', ''], /Negative depth/],
    [['H1', '1', 'x'.repeat(61), '10', '', '', '', ''], /Type.*60/],
    [['', '1', 'vein', '10', '', '', '', ''], /Hole ID is empty/],
  ])('refuses invalid rows with their line', (row, error) => {
    expect(build([row]).errors).toContainEqual({ line: 2, message: expect.stringMatching(error) });
  });
  it('refuses two measurements at one hole and depth', () => {
    const r = build([['H1', '5', 'vein', '10', '', '', '', ''], ['H1', '5', 'joint', '20', '', '', '', '']]);
    expect(r.errors).toEqual([{ line: 3, message: 'This depth of H1 is also on line 2' }]);
    expect(diffSentence('structure', { new: 2, changed: 1, unchanged: 0, new_holes: 1 })).toBe('1 new hole, 2 new structure measurements, 1 changed structure measurement');
  });
  it('explains an old database kind rejection', async () => {
    const sb = { rpc: vi.fn().mockResolvedValueOnce({ error: { code: '22023', message: 'INVALID_KIND: structure' } }).mockResolvedValue({ data: { ok: true } }) };
    const db = drillDb(sb);
    await expect(db.dryRun({ propertyId: 'p', kind: 'structure', rows: [] })).rejects.toThrow(/Structure imports are not available.*existing drill imports still work/);
    await expect(db.dryRun({ propertyId: 'p', kind: 'surveys', rows: [] })).resolves.toEqual({ ok: true });
  });
  it('leaves the 3D property loader unchanged by structure batches', () => {
    const batches = [{ id: 's', kind: 'structure', summary: { new: 5 }, created_at: '2026-10-25T00:00:00Z' }, { id: 'c', kind: 'collars', summary: { new: 1 }, created_at: '2026-10-01T00:00:00Z' }];
    expect(snapshotOf({ propertyId: 'p' }, batches, { collars: [{}] })).toMatchObject({ latestBatchId: 'c', latestAt: '2026-10-01T00:00:00.000Z' });
    expect(newerSince({ latestAt: '2026-10-02T00:00:00Z' }, batches)).toBe(null);
    expect(toFiles({ structure: [{ hole_id: 'H1', depth_m: 1, alpha: 10 }] }, batches).map(f => f.name)).toEqual([]);
  });
});
