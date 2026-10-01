import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory error_events with just the query surface the handler uses.
const db = vi.hoisted(() => ({ rows: [] }));
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
        insert: async (row) => { db.rows.push({ id: db.rows.length + 1, seen_count: 1, occurred_at: new Date().toISOString(), ...row }); return {}; },
        update: (patch) => ({ eq: async (_col, id) => { Object.assign(db.rows.find((r) => r.id === id), patch); return {}; } }),
      };
      return query;
    },
  }),
}));

async function report(sessionId, ip = '198.51.100.1') {
  const { default: handler } = await import('../api/client-error.js');
  const res = { statusCode: 200, setHeader() { return this; }, status(c) { this.statusCode = c; return this; }, end() { return this; }, json() { return this; } };
  await handler({
    method: 'POST',
    headers: { 'x-forwarded-for': ip, origin: 'https://www.explorationmaps.com' },
    body: { kind: 'error', message: 'Unable to preload CSS for /assets/App-abc123.css', path: '/app', sessionId },
  }, res);
  return res;
}

describe('api/client-error de-duplication', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    db.rows = [];
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
