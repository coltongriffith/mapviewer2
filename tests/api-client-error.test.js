import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory error_events with just the query surface the handler uses.
const db = vi.hoisted(() => ({ rows: [], rejectKinds: [] }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: null }) },
    from: () => {
      let filters = [];
      const query = {
        select: () => query,
        eq: (col, value) => { filters.push((r) => r[col] === value); return query; },
        is: (col, value) => { filters.push((r) => r[col] === value); return query; },
        gte: (col, value) => { filters.push((r) => r[col] >= value); return query; },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: db.rows.filter((r) => filters.every((f) => f(r))).at(-1) || null }),
        insert: async (row) => {
          // A check constraint on kind, as production could one day have.
          if (db.rejectKinds.includes(row.kind)) return { error: { code: '23514', message: 'violates check constraint' } };
          db.rows.push({ id: db.rows.length + 1, seen_count: 1, occurred_at: new Date().toISOString(), ...row });
          return {};
        },
        update: (patch) => ({ eq: async (_col, id) => { Object.assign(db.rows.find((r) => r.id === id), patch); return {}; } }),
      };
      return query;
    },
  }),
}));

async function report(sessionId, ip = '198.51.100.1', body = {}) {
  const { default: handler } = await import('../api/client-error.js');
  const res = { statusCode: 200, setHeader() { return this; }, status(c) { this.statusCode = c; return this; }, end() { return this; }, json() { return this; } };
  await handler({
    method: 'POST',
    headers: { 'x-forwarded-for': ip, origin: 'https://www.explorationmaps.com' },
    body: { kind: 'error', message: 'Unable to preload CSS for /assets/App-abc123.css', path: '/app', sessionId, ...body },
  }, res);
  return res;
}

describe('api/client-error de-duplication', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    db.rows = [];
    db.rejectKinds = [];
  });
  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('folds a tab\'s repeats into one row', async () => {
    await report('tab-a');
    await report('tab-a');
    await report('tab-a');
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ session_id: 'tab-a', seen_count: 3 });
  });

  it('keeps a row per tab, so each person who saw the error is counted', async () => {
    await report('tab-a', '198.51.100.1');
    await report('tab-b', '198.51.100.2');
    await report('tab-a', '198.51.100.1');
    expect(db.rows.map((r) => [r.session_id, r.seen_count])).toEqual([['tab-a', 2], ['tab-b', 1]]);
  });
});

describe('api/client-error kinds', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    db.rows = [];
    db.rejectKinds = [];
  });
  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('stores a stale chunk apart from crashes, including one an older tab sent as a crash', async () => {
    await report('tab-a', '198.51.100.1', { kind: 'stale_chunk', message: 'Importing a module script failed.' });
    await report('tab-b', '198.51.100.2', { kind: 'react', message: 'Failed to fetch dynamically imported module: https://x/assets/App-1.js' });
    await report('tab-c', '198.51.100.3', { kind: 'react', message: "Cannot read properties of undefined (reading '_removePath')" });
    expect(db.rows.map((r) => r.kind)).toEqual(['stale_chunk', 'stale_chunk', 'react']);
  });

  it('stores tile failures as warnings, including the tile_error an older tab sends', async () => {
    await report('tab-a', '198.51.100.1', { kind: 'warning', message: 'Locator inset failed to load tiles' });
    await report('tab-b', '198.51.100.2', { kind: 'tile_error', message: 'Reference overlay "rail" failed to load tiles' });
    await report('tab-c', '198.51.100.3', { kind: 'nonsense', message: 'Something else' });
    expect(db.rows.map((r) => r.kind)).toEqual(['warning', 'warning', 'error']);
  });

  it('falls back to the old kind when an insert is rejected, keeping the new kind in context', async () => {
    db.rejectKinds = ['stale_chunk', 'warning'];
    await report('tab-a', '198.51.100.1', { kind: 'stale_chunk', message: 'Importing a module script failed.', context: { outcome: 'reload' } });
    await report('tab-b', '198.51.100.2', { kind: 'warning', message: 'Locator inset failed to load tiles' });
    expect(db.rows.map((r) => [r.kind, r.context])).toEqual([
      ['error', { outcome: 'reload', kind: 'stale_chunk' }],
      ['error', { kind: 'warning' }],
    ]);
  });
});
