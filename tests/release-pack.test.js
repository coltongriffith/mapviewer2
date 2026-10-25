import { describe, it, expect } from 'vitest';
import { packStatus, batchSentence, approvalRequest } from '../shared/releasePack.js';

const MAP = 'm1', FIG = 'f1', LOC = 'm2';
const pack = { id: 'p1', items: [{ kind: 'results_table', ref: 'Default' }, { kind: 'drill_plan', ref: MAP }, { kind: 'figure_3d', ref: FIG }, { kind: 'location_map', ref: LOC }] };
const b1 = { id: 'b1', kind: 'collars', filename: 'collars.csv', summary: { new: 12 }, created_at: '2026-10-18T00:00:00Z', rolled_back_at: null };
const b2 = { id: 'b2', kind: 'assays', filename: 'assays 7.csv', summary: { new: 12, changed: 0 }, created_at: '2026-10-25T00:00:00Z', rolled_back_at: null };
const figures = { [MAP]: { name: 'Drill plan', revision: 3 }, [LOC]: { name: 'Location', revision: 1 }, [FIG]: { name: 'Rails 3D', versionId: 'v2', version: 2, savedAt: '2026-10-20T00:00:00Z' } };
const recipes = { Default: { id: 'r1', version: 1 } };
const approval = {
  items: pack.items.map((it) => ({ ref: it.ref, kind: it.kind })), batch_ids: ['b1'], recipe: { name: 'Default', id: 'r1', version: 1 },
  figures: [{ kind: 'map', id: MAP, revision: 3 }, { kind: 'figure', id: FIG, version_id: 'v2', version: 2, saved_at: '2026-10-20T00:00:00+00:00' }, { kind: 'map', id: LOC, revision: 1 }],
  approved_at: '2026-10-21T09:00:00Z', approved_by_email: 'geo@star.test',
};
const base = { pack, approval, batches: [b1], figures, recipes };

describe('packStatus', () => {
  it('is empty without items and a draft before the first approval', () => {
    expect(packStatus({ pack: { items: [] } }).state).toBe('empty');
    expect(packStatus({ ...base, approval: null })).toMatchObject({ state: 'draft', label: 'Draft: not approved yet' });
  });

  it('is up to date when nothing changed since the approval (item key order does not matter)', () => {
    const s = packStatus(base);
    expect(s).toMatchObject({ state: 'up_to_date', label: 'Up to date: approved 2026-10-21 by geo@star.test', changes: [], diff: '' });
    expect(s.items.every((i) => i.state === 'ok')).toBe(true);
  });

  it('a new import after the approval makes a draft, with its holes in words, on the items drawn from drill data', () => {
    const s = packStatus({ ...base, batches: [b2, b1], holes: { b2: ['077', '078', '077'] } });
    expect(s).toMatchObject({ state: 'draft', label: 'Draft: data changed since approved', diff: '12 new assays in holes 077, 078' });
    expect(s.items.map((i) => i.state)).toEqual(['changed', 'changed', 'changed', 'ok']);
    expect(s.items[0].notes).toEqual(['Drill data changed']);
  });

  it('a roll back of an approved import, a new figure version, an edited map and a new recipe version are listed', () => {
    const s = packStatus({ ...base, batches: [{ ...b1, rolled_back_at: '2026-10-22T00:00:00Z' }],
      figures: { ...figures, [MAP]: { ...figures[MAP], revision: 4 }, [FIG]: { ...figures[FIG], versionId: 'v3', version: 3 } }, recipes: { Default: { id: 'r2', version: 2 } } });
    expect(s.changes).toEqual(['collars.csv rolled back', 'Recipe "Default" is now version 2 (approved: version 1)', 'Drill plan edited since approval', 'Rails 3D: version 3 published since approval']);
    expect(s.state).toBe('draft');
  });

  it('a 3D figure saved after the approval without a new version, and changed items, are drafts too', () => {
    expect(packStatus({ ...base, figures: { ...figures, [FIG]: { ...figures[FIG], savedAt: '2026-10-24T00:00:00Z' } } }).diff).toBe('Rails 3D edited since approval (not published as a version)');
    expect(packStatus({ ...base, pack: { ...pack, items: pack.items.slice(0, 3) } }).changes[0]).toBe('The pack’s items changed');
  });

  it('flags items that stop an approval: an unsaved recipe, a map moved out of the property', () => {
    const s = packStatus({ ...base, figures: { [FIG]: figures[FIG], [LOC]: figures[LOC] }, recipes: {} });
    expect(s.items.map((i) => i.state)).toEqual(['missing', 'missing', 'ok', 'ok']);
    expect(s.items[0].notes).toEqual(['Save the results recipe "Default" first']);
  });
});

describe('batchSentence', () => {
  it('counts new and changed rows and lists up to five holes', () => {
    expect(batchSentence({ kind: 'assays', summary: { new: 1, changed: 3 } })).toBe('1 new assay and 3 changed assays');
    expect(batchSentence({ kind: 'collars', summary: { new: 2 } }, ['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe('2 new collars in holes A, B, C, D, E and 2 more');
    expect(batchSentence({ kind: 'surveys', summary: {} }, ['A'])).toBe('surveys import in hole A');
  });
});

describe('approvalRequest', () => {
  it('sends the live batches, each map revision and 3D figure version in item order, and the recipe', () => {
    expect(approvalRequest({ pack, batches: [b2, { ...b1, rolled_back_at: 'x' }], figures, recipes }, '  NR 26-14 ')).toEqual({
      pack_id: 'p1', batch_ids: ['b2'], recipe: { id: 'r1' }, note: 'NR 26-14',
      figures: [{ kind: 'map', id: MAP, version_id: null, revision: 3 }, { kind: 'figure', id: FIG, version_id: 'v2', revision: null }, { kind: 'map', id: LOC, version_id: null, revision: 1 }],
    });
    expect(approvalRequest({ pack: { id: 'p', items: [{ kind: 'figure_3d', ref: 'x' }] } }).figures).toEqual([{ kind: 'figure', id: 'x', version_id: null, revision: null }]);
  });
});
