import { describe, it, expect, vi, beforeEach } from 'vitest';

// The app's client for the user's own 3D figures (src/utils/figures.js),
// against a fake Supabase that records every query.

const calls = [];
let results = {}; // table or 'storage.copy' etc. → what the next call returns
const uid = 'u-1';

function builder(table) {
  const q = { table, ops: [] };
  calls.push(q);
  const result = () => {
    const r = results[`${table}.${q.ops[0]?.[0]}`];
    return typeof r === 'function' ? r(q) : (r || { data: [], error: null });
  };
  const b = {
    then: (ok, bad) => Promise.resolve(result()).then(ok, bad),
    single: () => Promise.resolve(result()),
    maybeSingle: () => Promise.resolve(result()),
  };
  for (const m of ['select', 'insert', 'update', 'eq', 'is', 'order', 'limit', 'in']) {
    b[m] = (...args) => { q.ops.push([m, ...args]); return b; };
  }
  return b;
}
const storage = { copy: vi.fn(async () => ({ data: {}, error: null })), remove: vi.fn(async () => ({ data: [], error: null })) };
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'geo@example.com' } }, error: null }) },
    from: (t) => builder(t),
    storage: { from: () => storage },
    rpc: vi.fn(async () => ({ data: [], error: null })),
  },
}));

const fig = await import('../src/utils/figures.js');

beforeEach(() => {
  calls.length = 0;
  results = {};
  storage.copy.mockClear();
  storage.remove.mockClear();
  storage.copy.mockImplementation(async () => ({ data: {}, error: null }));
});

describe('helpers', () => {
  it('adds up the stored file sizes and ignores anything that is not one', () => {
    expect(fig.figureBytes([{ size: 100 }, { size: '50' }, { size: -3 }, {}, null])).toBe(150);
    expect(fig.figureBytes(null)).toBe(0);
  });
  it('only shows image data URLs as thumbnails', () => {
    expect(fig.safeThumbnail('data:image/jpeg;base64,AAA')).toBe('data:image/jpeg;base64,AAA');
    expect(fig.safeThumbnail('javascript:alert(1)')).toBeNull();
    expect(fig.safeThumbnail('https://evil.test/x.png')).toBeNull();
  });
  it('builds the /3d links', () => {
    expect(fig.figureUrl('a b')).toBe('/3d?project=a%20b');
    expect(fig.newFigureUrl()).toBe('/3d');
    expect(fig.newFigureUrl('p1')).toBe('/3d?property=p1');
  });
  it('keeps a copied file inside the copy\'s own folder', () => {
    expect(fig.copyPath('u-1/old/r1/collars.csv', 'u-1', 'new', 'r2')).toBe('u-1/new/r2/collars.csv');
    expect(() => fig.copyPath('u-1/../x/collars.csv', 'u-1', 'new', 'r2')).toThrow(/outside/);
  });
});

describe('listMyFigures', () => {
  it('asks for the user\'s personal, live figures and maps the rows', async () => {
    results['three_d_projects.select'] = { data: [
      { id: 'f1', name: 'Tower 3D', thumbnail: 'data:image/jpeg;base64,AA', created_at: 'c', updated_at: '2026-10-20T00:00:00Z', file_paths: [{ size: 2048 }, { size: 1024 }] },
    ], error: null };
    const list = await fig.listMyFigures();
    expect(list).toEqual([{ id: 'f1', name: 'Tower 3D', thumbnail: 'data:image/jpeg;base64,AA', createdAt: 'c', updatedAt: '2026-10-20T00:00:00Z', bytes: 3072 }]);
    const ops = calls[0].ops;
    expect(ops).toContainEqual(['eq', 'user_id', uid]);
    expect(ops).toContainEqual(['is', 'org_id', null]);
    expect(ops).toContainEqual(['is', 'deleted_at', null]);
  });
  it('says what failed in plain words', async () => {
    results['three_d_projects.select'] = { data: null, error: { message: 'Failed to fetch' } };
    await expect(fig.listMyFigures()).rejects.toThrow(/could not reach exploration maps/i);
  });
});

describe('rename and delete', () => {
  it('renames with the trimmed name and refuses an empty one', async () => {
    results['three_d_projects.update'] = { data: [{ id: 'f1', name: 'New' }], error: null };
    await fig.renameFigure('f1', '  New  ');
    expect(calls[0].ops[0]).toEqual(['update', { name: 'New' }]);
    expect(calls[0].ops).toContainEqual(['eq', 'id', 'f1']);
    await expect(fig.renameFigure('f1', '   ')).rejects.toThrow(/name/);
  });
  it('a rename that matched nothing is an error, not a silent success', async () => {
    results['three_d_projects.update'] = { data: [], error: null };
    await expect(fig.renameFigure('gone', 'X')).rejects.toThrow(/not found/);
  });
  it('deletes softly', async () => {
    results['three_d_projects.update'] = { data: [{ id: 'f1' }], error: null };
    await fig.deleteFigure('f1');
    expect(Object.keys(calls[0].ops[0][1])).toEqual(['deleted_at']);
  });
});

describe('duplicateFigure', () => {
  const src = { id: 'f1', name: 'Tower 3D', settings: { brand: { title: 'Tower' } }, thumbnail: 'data:image/jpeg;base64,AA',
    file_paths: [{ name: 'collars.csv', path: 'u-1/f1/r1/collars.csv', size: 10, role: 'collars' }, { name: 'assays.csv', path: 'u-1/f1/r1/assays.csv', size: 20, role: 'assays' }] };

  it('copies the files into the copy\'s folder, then inserts the copy named "(copy)"', async () => {
    let inserted = null;
    results['three_d_projects.select'] = { data: src, error: null };
    results['three_d_projects.insert'] = (q) => { inserted = q.ops[0][1]; return { data: { ...inserted, created_at: 'c', updated_at: 'u' }, error: null }; };
    const copy = await fig.duplicateFigure('f1', ['Tower 3D', 'Tower 3D (copy)']);
    expect(copy.name).toBe('Tower 3D (copy 2)');
    expect(inserted.name).toBe('Tower 3D (copy 2)');
    expect(inserted.id).not.toBe('f1');
    expect(inserted.settings).toEqual(src.settings);
    expect(storage.copy).toHaveBeenCalledTimes(2);
    for (const [from, to] of storage.copy.mock.calls) {
      expect(from.startsWith('u-1/f1/')).toBe(true);
      expect(to.startsWith(`u-1/${inserted.id}/`)).toBe(true);
    }
    expect(inserted.file_paths.map((f) => f.path)).toEqual(storage.copy.mock.calls.map(([, to]) => to));
    expect(inserted.file_paths.map((f) => f.role)).toEqual(['collars', 'assays']);
  });

  it('removes what it copied when the copy cannot be saved', async () => {
    results['three_d_projects.select'] = { data: src, error: null };
    results['three_d_projects.insert'] = { data: null, error: { message: 'boom' } };
    await expect(fig.duplicateFigure('f1')).rejects.toThrow(/could not copy/i);
    expect(storage.remove).toHaveBeenCalledWith(storage.copy.mock.calls.map(([, to]) => to));
  });

  it('stops before inserting when a file fails to copy', async () => {
    results['three_d_projects.select'] = { data: src, error: null };
    storage.copy.mockImplementationOnce(async () => ({ data: {}, error: null })).mockImplementationOnce(async () => ({ data: null, error: { message: 'Object not found' } }));
    await expect(fig.duplicateFigure('f1')).rejects.toThrow(/could not copy/i);
    expect(calls.some((c) => c.ops[0]?.[0] === 'insert')).toBe(false);
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove.mock.calls[0][0]).toHaveLength(1);
  });
});
