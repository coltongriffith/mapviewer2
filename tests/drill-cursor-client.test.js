import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { pull } from '../src/three-d/property-data.js';
import { parseDrillFilter, matchesDrillFilter } from './fixtures/drill-filter.js';

const compare = (keys) => (a, b) => {
  for (const k of keys) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; } return 0;
};
function fixture({ cap = 2, onRequest = () => {}, ignoreCursor = false, ids = ['A,(x)."q"\\z: *', 'H10', 'H2', 'Éclair'] } = {}) {
  const calls = [], base = { property_id: 'p1', superseded_by_batch: null };
  const db = { drill_import_batches: [{ property_id: 'p1', id: 'b1', kind: 'collars', created_at: '2026-10-01T00:00:00Z' }],
    drill_collars: ids.map((hole_id) => ({ ...base, hole_id, x: 1, y: 2, z: 3, crs: null })),
    drill_surveys: ids.flatMap((hole_id) => [0, 0.1, 0.2, 2, 10].map((depth_m) => ({ ...base, hole_id, depth_m, azimuth: 0, dip: -60 }))),
    drill_assays: ids.flatMap((hole_id) => [[0, 1], [0, 2], [0, 3], [0.1, 0.2], [0.1, 0.3]].map(([from_m, to_m]) => ({ ...base, hole_id, from_m, to_m, values: { Au: 1 }, units: { Au: 'g/t' } }))),
    drill_lithology: ids.flatMap((hole_id) => [[0, 1], [0, 2], [0, 3], [0.1, 0.2], [0.1, 0.3]].map(([from_m, to_m]) => ({ ...base, hole_id, from_m, to_m, code: 'QZ' }))),
  };
  for (const kind of ['collars', 'surveys', 'assays', 'lithology']) {
    const rows = db[`drill_${kind}`];
    rows.push({ ...rows[0], superseded_by_batch: 'old' }, { ...rows[0], property_id: 'other' });
  }
  const sb = createClient('https://example.supabase.co', 'placeholder', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      const url = new URL(input), table = url.pathname.split('/').at(-1), q = url.searchParams;
      calls.push({ table, q, url: url.href });
      const fault = onRequest({ table, q, db, calls });
      if (fault) return new Response(JSON.stringify({ message: fault }), { status: 403 });
      expect(q.get('property_id')).toBe('eq.p1');
      let rows = db[table].filter((r) => r.property_id === 'p1');
      if (table !== 'drill_import_batches') {
        expect(q.get('superseded_by_batch')).toBe('is.null');
        expect(q.has('offset')).toBe(false); expect(q.get('limit')).toBe('1000');
        rows = rows.filter((r) => r.superseded_by_batch === null);
        if (!ignoreCursor) {
          for (const [k, v] of q) if (k === 'hole_id') rows = rows.filter((r) => matchesDrillFilter(r, parseDrillFilter(`${k}.${v}`)));
          if (q.has('or')) rows = rows.filter((r) => matchesDrillFilter(r, parseDrillFilter(`or${q.get('or')}`)));
        }
      }
      const keys = q.get('order').split(',').map((k) => k.split('.')[0]);
      rows = rows.slice().sort(compare(keys)).slice(0, table === 'drill_import_batches' ? 1000 : cap);
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { sb, db, calls };
}

describe('property cursors through the real Supabase client', () => {
  it('keeps every current row across tied keys, fractional depths and a smaller server page cap', async () => {
    const { sb, db, calls } = fixture();
    const { rows, ref } = await pull(sb, { id: 'p1' });
    for (const [kind, keys] of Object.entries({ collars: ['hole_id'], surveys: ['hole_id', 'depth_m'], assays: ['hole_id', 'from_m', 'to_m'], lithology: ['hole_id', 'from_m', 'to_m'] })) {
      const expected = db[`drill_${kind}`].filter((r) => r.property_id === 'p1' && r.superseded_by_batch === null).sort(compare(keys));
      expect(rows[kind]).toEqual(expected);
      expect(calls.filter((c) => c.table === `drill_${kind}`)).toHaveLength(expected.length / 2 + 1);
    }
    expect(ref).toMatchObject({ holes: 4, assays: 20, latestBatchId: 'b1' });
    const page = calls.filter((c) => c.table === 'drill_assays')[1];
    const quoted = '"A,(x).\\"q\\"\\\\z: *"';
    expect(page.q.get('hole_id')).toBe('gte.A,(x)."q"\\z: *');
    expect(page.q.get('or')).toBe(`(hole_id.gt.${quoted},and(hole_id.eq.${quoted},from_m.gt.0),and(hole_id.eq.${quoted},from_m.eq.0,to_m.gt.2))`);
    expect(page.url).toContain('%5C');
  });

  it('restarts at the beginning after a concurrent import, replacing the earlier rows', async () => {
    let changed = false;
    const f = fixture({ onRequest: ({ table, q, db }) => {
      if (!changed && table === 'drill_assays' && q.has('or')) {
        changed = true;
        db.drill_assays[0].values.Au = 9;
        db.drill_import_batches.unshift({ property_id: 'p1', id: 'b2', kind: 'assays', created_at: '2026-10-02T00:00:00Z' });
      }
    } });
    const loaded = await pull(f.sb, { id: 'p1' });
    expect(loaded.rows.assays[0].values.Au).toBe(9);
    expect(loaded.ref.latestBatchId).toBe('b2');
    expect(f.calls.filter((c) => c.table === 'drill_assays' && !c.q.has('or'))).toHaveLength(2);
  });

  it('passes the single collar key literally without treating punctuation as filter operators', async () => {
    const f = fixture({ cap: 1 });
    const loaded = await pull(f.sb, { id: 'p1' });
    expect(loaded.rows.collars).toHaveLength(4);
    const second = f.calls.filter((c) => c.table === 'drill_collars')[1];
    expect(second.q.get('hole_id')).toBe('gt.A,(x)."q"\\z: *');
    expect(second.q.has('or')).toBe(false);
  });

  it.each(['H0001', '"H0001"', 'A,(x)."q"\\z: *'])('finishes the terminal page with literal SDK cursor values for %s', async (id) => {
    const f = fixture({ ids: [id], cap: 1000 });
    const loaded = await pull(f.sb, { id: 'p1' });
    expect(loaded.rows.collars.map((r) => r.hole_id)).toEqual([id]);
    for (const table of ['drill_collars', 'drill_surveys', 'drill_assays', 'drill_lithology']) {
      const calls = f.calls.filter((c) => c.table === table);
      expect(calls).toHaveLength(2);
      expect(calls[1].q.get('hole_id')).toBe(`${table === 'drill_collars' ? 'gt' : 'gte'}.${id}`);
    }
  });

  it('models standalone quoted IDs literally and unquotes only inside logic groups', () => {
    expect(parseDrillFilter('hole_id.gt."H0001"').value).toBe('"H0001"');
    expect(parseDrillFilter('or(hole_id.gt."H0001")').parts[0].value).toBe('H0001');
  });

  it('refuses an unstable import history after the existing bounded retry', async () => {
    let version = 0;
    const f = fixture({ onRequest: ({ table, db }) => {
      if (table === 'drill_import_batches') db.drill_import_batches = [{ property_id: 'p1', id: `b${++version}`, kind: 'assays', created_at: `2026-10-0${version}T00:00:00Z` }];
    } });
    await expect(pull(f.sb, { id: 'p1' })).rejects.toThrow('changed while it was loading');
    expect(version).toBe(4);
  });

  it('propagates a later page failure instead of returning a partial figure', async () => {
    const f = fixture({ onRequest: ({ table, q }) => table === 'drill_assays' && q.has('or') ? 'read denied' : null });
    await expect(pull(f.sb, { id: 'p1' })).rejects.toThrow("Could not read the property's assays (read denied)");
  });

  it('stops a repeated page instead of looping or silently duplicating intervals', async () => {
    const f = fixture({ ignoreCursor: true });
    await expect(pull(f.sb, { id: 'p1' })).rejects.toThrow('repeated page cursor');
    expect(f.calls.filter((c) => c.table === 'drill_assays').length).toBeLessThanOrEqual(2);
  });

  it('refuses a malformed cursor returned by the service', async () => {
    const f = fixture({ onRequest: ({ table, db }) => { if (table === 'drill_assays') db.drill_assays = [{ property_id: 'p1', superseded_by_batch: null, hole_id: 'A', from_m: null, to_m: 1 }]; } });
    await expect(pull(f.sb, { id: 'p1' })).rejects.toThrow('invalid or repeated page cursor');
  });
});
