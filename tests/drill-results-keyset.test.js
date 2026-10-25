import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { drillResultsDb, PAGE } from '../src/utils/drillResultsDb.js';
import { computeResults } from '../shared/drillResults.js';
import { parseDrillFilter, matchesDrillFilter } from './fixtures/drill-filter.js';

const KEYS = ['hole_id', 'from_m', 'to_m'];
const compare = (a, b) => { for (const k of KEYS) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; } return 0; };
const RECIPE = {
  version: 1, primary: 'Cu', equivalent: true,
  elements: [{ name: 'Cu', unit: '%', price: 4.5, recovery: 90 }, { name: 'Au', unit: 'g/t', price: 3000, recovery: 70 }],
  cutoff: 0.2, minLength: 2, maxDilution: 6, inclCutoff: 1, inclMinLength: 2, inclMaxDilution: 0,
  bdl: 'stored', lengthDecimals: 1, gradeDecimals: {}, trueWidth: '',
};

// 2,900 current assays over 13 holes (pages end mid-hole), with punctuation in IDs, tied from_m and
// fractional depths, plus superseded and other-property rows the reads must skip.
function fixture({ onRequest = () => {}, ignoreCursor = false } = {}) {
  const ids = ['A,(x)."q"\\z: *', 'Éclair', ...Array.from({ length: 11 }, (_, i) => `H${i + 1}`)];
  const base = { property_id: 'p1', superseded_by_batch: null, bdl: {}, units: { Cu: '%', Au: 'g/t' } };
  const rows = ids.flatMap((hole_id, h) => Array.from({ length: h ? 150 : 1100 }, (_, i) => {
    const from_m = Math.floor(i / 2) * 1.5 + (h % 3) * 0.1, to_m = from_m + (i % 2 ? 1.5 : 0.7);
    return { ...base, hole_id, from_m, to_m, values: { Cu: ((i * 7 + h) % 13) / 10, Au: ((i * 3 + h) % 11) / 20 } };
  }));
  rows.push({ ...rows[5], superseded_by_batch: 'old', values: { Cu: 9 } }, { ...rows[5], property_id: 'other', values: { Cu: 9 } });
  const calls = [];
  const sb = createClient('https://example.supabase.co', 'placeholder', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      const url = new URL(input), q = url.searchParams;
      calls.push(q);
      const fault = onRequest({ q, rows, calls });
      if (fault) return new Response(JSON.stringify({ message: fault }), { status: 403 });
      expect(url.pathname).toBe('/rest/v1/drill_assays');
      expect(q.get('property_id')).toBe('eq.p1');
      expect(q.get('superseded_by_batch')).toBe('is.null');
      let out = rows.filter((r) => r.property_id === 'p1' && r.superseded_by_batch === null);
      if (!ignoreCursor) {
        if (q.has('hole_id')) out = out.filter((r) => matchesDrillFilter(r, parseDrillFilter(`hole_id.${q.get('hole_id')}`)));
        if (q.has('or')) out = out.filter((r) => matchesDrillFilter(r, parseDrillFilter(`or${q.get('or')}`)));
      }
      const offset = Number(q.get('offset') || 0), limit = Number(q.get('limit'));
      out = out.sort(compare).slice(offset, offset + limit).map(({ property_id, superseded_by_batch, ...r }) => r);
      return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { sb, rows, calls };
}

// The offset loader this replaced, kept to compare against.
async function offsetAssays(sb, propertyId, max) {
  const rows = [];
  for (let at = 0; at < max; at += PAGE) {
    const { data, error } = await sb.from('drill_assays').select('hole_id,from_m,to_m,values,bdl,units')
      .eq('property_id', propertyId).is('superseded_by_batch', null)
      .order('hole_id').order('from_m').order('to_m').range(at, at + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}

describe('drillResultsDb.assays keyset pages', () => {
  it('requests the first page plainly and later pages after the last key, never by offset', async () => {
    const f = fixture();
    const out = await drillResultsDb(f.sb).assays('p1');
    expect(out.rows).toHaveLength(2900);
    expect(out.capped).toBe(false);
    expect(f.calls).toHaveLength(3);
    for (const q of f.calls) {
      expect(q.get('order')).toBe('hole_id.asc,from_m.asc,to_m.asc');
      expect(q.get('limit')).toBe('1000');
      expect(q.has('offset')).toBe(false);
      expect(q.get('select')).toBe('hole_id,from_m,to_m,values,bdl,units');
    }
    expect(f.calls[0].has('hole_id')).toBe(false);
    expect(f.calls[0].has('or')).toBe(false);
    const last = out.rows[999], quoted = (v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`, h = quoted(last.hole_id);
    expect(f.calls[1].get('hole_id')).toBe(`gte.${last.hole_id}`);
    expect(f.calls[1].get('or')).toBe(`(hole_id.gt.${h},and(hole_id.eq.${h},from_m.gt.${last.from_m}),and(hole_id.eq.${h},from_m.eq.${last.from_m},to_m.gt.${last.to_m}))`);
  });

  it('passes punctuation in a cursor hole ID literally to gte and quoted inside or()', async () => {
    const f = fixture();
    const { rows } = await drillResultsDb(f.sb).assays('p1');
    expect(rows[999].hole_id).toBe('A,(x)."q"\\z: *');
    expect(f.calls[1].get('hole_id')).toBe('gte.A,(x)."q"\\z: *');
    expect(f.calls[1].get('or')).toContain('hole_id.gt."A,(x).\\"q\\"\\\\z: *"');
  });

  it('returns the same rows, order and results as the offset path', async () => {
    const f = fixture(), keyset = await drillResultsDb(f.sb).assays('p1');
    const old = await offsetAssays(fixture().sb, 'p1', 200000);
    expect(keyset).toEqual(old);
    expect(keyset.rows.map((r) => r.values.Cu)).not.toContain(9);
    expect(computeResults(keyset.rows, RECIPE)).toEqual(computeResults(old.rows, RECIPE));
    expect(computeResults(keyset.rows, RECIPE).results.length).toBeGreaterThan(0);
  });

  it('keeps the page cap: capped after max rows, as before', async () => {
    const f = fixture(), out = await drillResultsDb(f.sb).assays('p1', 2000);
    expect(out).toEqual(await offsetAssays(fixture().sb, 'p1', 2000));
    expect(out).toMatchObject({ capped: true });
    expect(out.rows).toHaveLength(2000);
    expect(f.calls).toHaveLength(2);
  });

  it('throws a later page failure instead of returning part of the assays', async () => {
    const f = fixture({ onRequest: ({ q }) => q.has('or') ? 'read denied' : null });
    await expect(drillResultsDb(f.sb).assays('p1')).rejects.toThrow('read denied');
  });

  it('stops on a repeated page instead of looping or duplicating intervals', async () => {
    const f = fixture({ ignoreCursor: true });
    await expect(drillResultsDb(f.sb).assays('p1')).rejects.toThrow('repeated page cursor');
    expect(f.calls).toHaveLength(2);
  });
});
