import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// qc_claims holds a row per owner: a claim with two holders is two rows with
// the same tag_number. The owner/number search paged with no order (so
// PostgREST could shuffle rows across pages) and deduped on TAG_NUMBER, which
// kept whichever owner arrived first and dropped the rest.

const cols = ['tag_number', 'owner_name', 'status', 'good_to_date', 'area_hectares', 'title_type'];
const byColumns = (a, b) => {
  for (const c of cols) {
    const x = String(a[c] ?? ''), y = String(b[c] ?? '');
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};
const row = (tag, owner) => ({ tag_number: tag, owner_name: owner, status: 'Actif', good_to_date: '2027-05-01', area_hectares: 52.6, title_type: 'CDC', geometry: null });

function mockRes() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}
let ipN = 0;
const req = (query) => ({ method: 'GET', query, url: '/api/claims', headers: { 'x-forwarded-for': `10.9.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}` } });

describe('/api/claims Quebec search: co-owners', () => {
  let rows;
  let urls;

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://stub.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    rows = [];
    urls = [];
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = new URL(String(url));
      urls.push(decodeURIComponent(u.search));
      const offset = Number(u.searchParams.get('offset')), limit = Number(u.searchParams.get('limit'));
      // Unordered, PostgREST may return rows in any order; reverse to show it.
      // Only the tag_number filters matter here (in., gte., lt.).
      const keep = (r) => u.searchParams.getAll('tag_number').every((f) => {
        const [op, v] = [f.slice(0, f.indexOf('.')), f.slice(f.indexOf('.') + 1)];
        return op === 'in' ? v.slice(1, -1).split(',').includes(r.tag_number) : op === 'gte' ? r.tag_number >= v : op === 'lt' ? r.tag_number < v : true;
      });
      const ordered = (u.searchParams.get('order') ? [...rows].sort(byColumns) : [...rows].reverse()).filter(keep);
      const page = ordered.slice(offset, offset + limit);
      return { ok: true, status: 200, headers: new Map(), json: async () => page, text: async () => JSON.stringify(page) };
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  });

  const run = async (query) => {
    const { default: handler } = await import('../api/claims.js');
    const res = mockRes();
    await handler(req({ province: 'qc', ...query }), res);
    return res;
  };

  it('merges co-owner rows into one claim listing every owner', async () => {
    rows = [row('2400001', 'Exploration Azimut inc.'), row('2400001', 'Corporation Aurifère Vior Inc.')];
    const res = await run({ q: '2400001', type: 'number' });
    expect(res.statusCode).toBe(200);
    expect(urls[0]).toContain('order=tag_number,owner_name,status,good_to_date,area_hectares,title_type,geometry');
    const [f, ...rest] = res.body.features;
    expect(rest).toEqual([]);
    expect(f.properties.OWNERS).toEqual(['Corporation Aurifère Vior Inc.', 'Exploration Azimut inc.']);
    expect(f.properties.OWNER_NAME).toBe('Corporation Aurifère Vior Inc.; Exploration Azimut inc.');
    expect(f.properties.QC_ROW).toBeUndefined();
    expect(res.body.meta).toMatchObject({ returned: 1, totalKnown: 1, truncated: false });
  });

  it('pages in a stable order and keeps co-owners split across a page boundary', async () => {
    for (let i = 0; i < 1499; i++) rows.push(row(String(2_400_000 + i), 'Exploration Azimut inc.'));
    // Sorted, rows 999 and 1000 are the same claim: one owner per page.
    rows.push(row(String(2_400_999), 'Azimut co-owner inc.'));
    const res = await run({ q: 'Azimut', type: 'company' });
    expect(res.statusCode).toBe(200);
    expect(urls).toHaveLength(2);
    for (const u of urls) expect(u).toContain('&order=tag_number,owner_name,');
    expect(res.body.features).toHaveLength(1499);
    const tags = new Set(res.body.features.map((f) => f.properties.TAG_NUMBER));
    expect(tags.size).toBe(1499);
    const split = res.body.features.find((f) => f.properties.TAG_NUMBER === '2400999');
    expect(split.properties.OWNERS).toEqual(['Azimut co-owner inc.', 'Exploration Azimut inc.']);
    expect(res.body.meta).toMatchObject({ returned: 1499, totalKnown: 1499, truncated: false });
  });

  it('keeps a prefix search truncated when merging co-owners leaves fewer claims than rows', async () => {
    for (let i = 0; i < 100; i++) for (const o of ['Owner A inc.', 'Owner B inc.']) rows.push(row(String(2_400_000 + i), o));
    const res = await run({ q: '24000', type: 'number' });
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toHaveLength(25);
    expect(res.body.features[0].properties.OWNERS).toEqual(['Owner A inc.', 'Owner B inc.']);
    expect(res.body.meta.truncated).toBe(true);
  });

  it('leaves a single-owner claim as it was', async () => {
    rows = [row('2400002', 'Exploration Azimut inc.')];
    const res = await run({ q: '2400002', type: 'number' });
    expect(res.body.features[0].properties).toMatchObject({ OWNER_NAME: 'Exploration Azimut inc.', OWNERS: ['Exploration Azimut inc.'] });
  });
});
