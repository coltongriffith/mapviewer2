import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The Quebec nearby-radius read: /api/claims?province=qc&bbox=… calls the
// qc_claims_in_bbox RPC. PostgREST caps every response at max-rows (1000 on
// the project), RPC results included, and says so only in Content-Range
// (0-999/*). Measured against prod: a box of 1,240 claims came back as
// exactly 1,000, with no meta at all.
//
// The mock serves the RPC the way PostgREST does: the function's own
// `limit 2000`, then order/offset/limit over its result, at most maxRows per
// response, and the total in Content-Range only for Prefer: count=exact.

const rect = (x = -77.5, y = 48.1, d = 0.01) => ({ type: 'Polygon', coordinates: [[[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]]] });

// tag_number is not unique in qc_claims: co-owners get a row each, and some
// rows are identical outright. Every third claim here has two owners.
const qcRows = (claims) => {
  const rows = [];
  for (let i = 1; rows.length < claims; i++) {
    const tag = String(2_400_000 + i);
    rows.push({ tag_number: tag, owner_name: 'Exploration Azimut inc.', status: 'Actif', good_to_date: '2027-05-01', area_hectares: 52.6, title_type: 'CDC', geometry: rect() });
    if (i % 3 === 0 && rows.length < claims) rows.push({ ...rows[rows.length - 1], owner_name: 'Corporation Aurifère Vior Inc.' });
  }
  return rows;
};

const cols = ['tag_number', 'owner_name', 'status', 'good_to_date', 'area_hectares', 'title_type'];
const byColumns = (a, b) => {
  for (const c of cols) {
    const x = String(a[c] ?? ''), y = String(b[c] ?? '');
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

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
const req = (query) => ({ method: 'GET', query, url: '/api/claims', headers: { 'x-forwarded-for': `10.8.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}` } });
const json = (body, status = 200) => ({ ok: status < 300, status, headers: new Map([['content-type', 'application/json']]), json: async () => body, text: async () => JSON.stringify(body) });

describe('/api/claims Quebec bbox: pages past the PostgREST row cap', () => {
  let rows;
  let maxRows;
  let calls;
  let failAt;
  let noTotal;
  let notSetUp;

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://stub.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    rows = [];
    maxRows = 1000;
    calls = [];
    failAt = null;
    noTotal = false;
    notSetUp = false;
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const u = decodeURIComponent(String(url));
      if (!u.includes('/rest/v1/rpc/qc_claims_in_bbox')) throw new Error(`unexpected ${u}`);
      if (notSetUp) return json({ code: 'PGRST202', message: 'Could not find the function' }, 404);
      const off = Number(u.match(/offset=(\d+)/)?.[1] || 0);
      const lim = Math.min(Number(u.match(/limit=(\d+)/)?.[1] || Infinity), maxRows);
      const count = /count=exact/.test(init.headers?.Prefer || '');
      calls.push({ offset: off, limit: lim, count, order: u.match(/order=([a-z_,]+)/)?.[1], body: JSON.parse(init.body) });
      if (failAt != null && off >= failAt) {
        return json({ code: '57014', message: 'canceling statement due to statement timeout' }, 500);
      }
      const result = rows.slice(0, 2000).sort(byColumns);   // the function's `limit 2000`, then order=
      const page = result.slice(off, off + lim);
      const res = json(page, count ? 206 : 200);
      const range = page.length ? `${off}-${off + page.length - 1}` : '*';
      res.headers.set('content-range', `${range}/${count && !noTotal ? result.length : '*'}`);
      return res;
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  });

  const run = async (bbox = '-77.6,48.0,-77.4,48.2') => {
    const { default: handler } = await import('../api/claims.js');
    const res = mockRes();
    await handler(req({ bbox, province: 'qc' }), res);
    return res;
  };
  const rowsPerTag = (features) => features.reduce((m, f) => m.set(f.properties.TAG_NUMBER, (m.get(f.properties.TAG_NUMBER) || 0) + 1), new Map());

  it('returns a small box in one page with an honest total', async () => {
    rows = qcRows(360);
    const res = await run('-77.6,48.0,-77.5,48.1');
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toHaveLength(360);
    expect(res.body.features[0].properties).toMatchObject({ OWNER_NAME: expect.any(String), TAG_NUMBER: expect.any(String), STATUS: 'Actif' });
    expect(res.body.meta).toMatchObject({ totalKnown: 360, returned: 360, truncated: false, pagesFetched: 1, provider: 'qc-store' });
    expect(calls[0].body).toEqual({ min_lng: -77.6, min_lat: 48.0, max_lng: -77.5, max_lat: 48.1 });
  });

  // The production bug: 1,240 rows in the box, exactly 1,000 returned.
  it('pages a box past the 1,000-row cap and returns every row (1,240)', async () => {
    rows = qcRows(1240);
    const res = await run();
    expect(res.body.features).toHaveLength(1240);
    expect(res.body.meta).toMatchObject({ totalKnown: 1240, returned: 1240, truncated: false, pagesFetched: 2 });
    expect(calls.map((c) => c.offset)).toEqual([0, 1000]);
    expect(calls[0].count).toBe(true);
    expect(calls[1].count).toBe(false);
    // tag_number is not unique, so the page order is every column returned.
    expect(calls[0].order).toBe('tag_number,owner_name,status,good_to_date,area_hectares,title_type,geometry');
    // Co-owner rows are kept, not collapsed by tag number.
    expect(rowsPerTag(res.body.features)).toEqual(rowsPerTag(rows.map((r) => ({ properties: { TAG_NUMBER: r.tag_number } }))));
  });

  it('steps by the rows a page actually held, so a lower cap still reads everything', async () => {
    maxRows = 400;
    rows = qcRows(1240);
    const res = await run();
    expect(res.body.features).toHaveLength(1240);
    expect(res.body.meta).toMatchObject({ totalKnown: 1240, truncated: false, pagesFetched: 4 });
    expect(calls.map((c) => c.offset)).toEqual([0, 400, 800, 1200]);
  });

  it('marks a box past the function limit as truncated, total unknown', async () => {
    // The function stops at 2,000: the count it reports is "at least".
    rows = qcRows(2128);
    const res = await run('-75.0,49.4,-74.6,49.6');
    expect(res.body.features).toHaveLength(2000);
    expect(res.body.meta).toMatchObject({ totalKnown: null, returned: 2000, truncated: true, pagesFetched: 2 });
  });

  it('keeps the page that arrived and says truncated when a later page fails', async () => {
    rows = qcRows(1500);
    failAt = 1000;   // the anon role's statement timeout on the second page
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toHaveLength(1000);
    expect(res.body.meta).toMatchObject({ totalKnown: 1500, returned: 1000, truncated: true });
  });

  it('reports an error when the first page fails, as before', async () => {
    rows = qcRows(1500);
    failAt = 0;
    const res = await run();
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBeTruthy();
  });

  it('says the search is not set up when the RPC is missing', async () => {
    notSetUp = true;
    const res = await run();
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/not set up/);
  });

  it('walks until a short page when no total is disclosed', async () => {
    noTotal = true;
    rows = qcRows(1240);
    const res = await run();
    expect(res.body.features).toHaveLength(1240);
    expect(res.body.meta).toMatchObject({ totalKnown: 1240, truncated: false, pagesFetched: 2 });
  });

  it('returns an empty box as complete', async () => {
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toEqual([]);
    expect(res.body.meta).toMatchObject({ totalKnown: 0, returned: 0, truncated: false, pagesFetched: 1 });
  });
});
