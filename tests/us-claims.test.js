import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// End-to-end tests of the US federal (BLM MLRS) jurisdiction path through the
// real /api/claims handler, against a fully mocked BLM ArcGIS service.
// Fixture field names follow the primary candidates (CSE_NR / CSE_NAME /
// STATE_GEO / CSE_TYPE_TXT / CSE_DISP_TXT / RCRD_ACRS / LGCY_CSE_NR); the
// engine resolves them at runtime exactly as it will against the live layer.

const BLM_FIELDS = [
  { name: 'OBJECTID', type: 'esriFieldTypeOID' },
  { name: 'CSE_NR', type: 'esriFieldTypeString' },
  { name: 'LGCY_CSE_NR', type: 'esriFieldTypeString' },
  { name: 'CSE_NAME', type: 'esriFieldTypeString' },
  { name: 'STATE_GEO', type: 'esriFieldTypeString' },
  { name: 'CSE_TYPE_TXT', type: 'esriFieldTypeString' },
  { name: 'CSE_DISP_TXT', type: 'esriFieldTypeString' },
  { name: 'RCRD_ACRS', type: 'esriFieldTypeDouble' },
];

const claim = (i, over = {}) => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[-116, 40], [-116, 40.01], [-115.99, 40.01], [-115.99, 40], [-116, 40]]] },
  properties: {
    OBJECTID: i,
    CSE_NR: `NV10${5000000 + i}`,
    LGCY_CSE_NR: `NMC${100000 + i}`,
    CSE_NAME: `GOLDIE #${i}`,
    STATE_GEO: 'NV',
    CSE_TYPE_TXT: 'LODE CLAIM',
    CSE_DISP_TXT: 'ACTIVE',
    RCRD_ACRS: 20.66,
    ...over,
  },
});

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
const req = (query, method = 'GET') => ({
  method, query, url: `/api/claims?${new URLSearchParams(query)}`,
  headers: { 'x-forwarded-for': `172.16.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}` },
});

// Captures every query URL the handler sends upstream, so tests can assert
// on the WHERE clause the engine actually built.
let queryUrls;
let totalClaims;
function installBlmMock() {
  queryUrls = [];
  totalClaims = 3;
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    const json = (body) => ({ ok: true, headers: new Map([['content-type', 'application/json']]), json: async () => body, text: async () => JSON.stringify(body) });
    if (/FeatureServer\/0\?f=json/.test(u)) {
      return json({
        name: 'Mining Claims Not Closed',
        maxRecordCount: 2000,
        objectIdField: 'OBJECTID',
        advancedQueryCapabilities: { supportsPagination: true },
        fields: BLM_FIELDS,
      });
    }
    if (/FeatureServer\/0\/query/.test(u)) {
      // URLSearchParams encodes spaces as '+', which decodeURIComponent leaves alone
      queryUrls.push(decodeURIComponent(u.replace(/\+/g, ' ')));
      const offset = Number(u.match(/resultOffset=(\d+)/)?.[1]) || 0;
      const count = Number(u.match(/resultRecordCount=(\d+)/)?.[1]) || 2000;
      const features = [];
      for (let i = offset; i < Math.min(offset + count, totalClaims); i++) features.push(claim(i + 1));
      return json({ type: 'FeatureCollection', features });
    }
    throw new Error(`unexpected url ${u}`);
  }));
}

let handler;
beforeEach(async () => {
  vi.resetModules();
  installBlmMock();
  ({ default: handler } = await import('../api/claims.js'));
});
afterEach(() => vi.unstubAllGlobals());

describe('US claim-name search (us-nv)', () => {
  it('resolves the name field, scopes to the state, and normalizes results', async () => {
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);

    // WHERE contains both the name match and the state scope
    const where = queryUrls[0];
    expect(where).toMatch(/UPPER\(CSE_NAME\) LIKE UPPER\('%goldie%'\)/i);
    expect(where).toMatch(/UPPER\(STATE_GEO\) = 'NV'/);

    const p = res.body.features[0].properties;
    expect(p.CLAIM_NAME).toBe('GOLDIE #1');
    expect(p.TAG_NUMBER).toMatch(/^NV10/);
    expect(p.LEGACY_NR).toMatch(/^NMC/);
    expect(p.CLAIM_TYPE).toBe('lode');
    expect(p.TITLE_TYPE_DESCRIPTION).toBe('LODE CLAIM');
    expect(p.STATUS).toBe('ACTIVE');
    expect(p.US_STATE).toBe('NV');
    expect(p.SOURCE_SYSTEM).toBe('BLM MLRS');
    expect(p.GEOM_GENERALIZED).toBe(true);
    // acres → hectares (20.66 ac ≈ 8.36 ha), original preserved
    expect(p.AREA_IN_HECTARES).toBeCloseTo(8.36, 1);
    expect(p.RCRD_ACRS).toBe(20.66);
    // No fabricated expiry for US records
    expect(p.GOOD_TO_DATE).toBeUndefined();
    expect(res.body.meta.provider).toBe('blm-mlrs');
  });
});

describe('US serial-number search', () => {
  it('tolerates spacing/dash formatting and ORs the legacy serial field', async () => {
    const res = mockRes();
    await handler(req({ q: 'nv 105-000-001', type: 'number', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    const where = queryUrls[0];
    expect(where).toMatch(/UPPER\(CSE_NR\) LIKE UPPER\('%nv105000001%'\)/i);
    expect(where).toMatch(/OR UPPER\(LGCY_CSE_NR\) LIKE/i);
    expect(where).toMatch(/UPPER\(STATE_GEO\) = 'NV'/);
  });
});

describe('US pagination', () => {
  it('walks multiple pages beyond maxRecordCount with honest meta', async () => {
    totalClaims = 4500; // > 2 pages at maxRecordCount 2000
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-az' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toHaveLength(4500);
    expect(res.body.meta.truncated).toBe(false);
    expect(res.body.meta.pagesFetched).toBeGreaterThanOrEqual(3);
    // az jurisdiction scopes to AZ
    expect(queryUrls[0]).toMatch(/UPPER\(STATE_GEO\) = 'AZ'/);
  });
});

describe('US jurisdiction validation', () => {
  it('rejects unknown US states', async () => {
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-zz' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects map-sheet search for US (BC-only)', async () => {
    const res = mockRes();
    await handler(req({ q: '082F', type: 'map', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/only available for BC/i);
  });

  it('company/claimant search degrades cleanly (no claimant data in v1)', async () => {
    const res = mockRes();
    await handler(req({ q: 'barrick', type: 'company', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/not available here/i);
  });

  it('name search is rejected for jurisdictions without name fields (Canadian)', async () => {
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'yt' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/not available/i);
  });
});

describe('US bbox (nearby claims) search', () => {
  it('applies the state scope to spatial queries', async () => {
    const res = mockRes();
    await handler(req({ bbox: '-116.5,39.5,-115.5,40.5', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.features.length).toBeGreaterThan(0);
    const spatial = queryUrls.find((u) => u.includes('esriGeometryEnvelope'));
    expect(spatial).toBeTruthy();
    expect(spatial).toMatch(/UPPER\(STATE_GEO\) = 'NV'/);
    expect(res.body.features[0].properties.SOURCE_SYSTEM).toBe('BLM MLRS');
  });
});

describe('US claim-type normalization', () => {
  it('maps official type text onto normalized categories', async () => {
    const cases = [
      ['LODE CLAIM', 'lode'],
      ['PLACER CLAIM', 'placer'],
      ['MILL SITE', 'mill_site'],
      ['TUNNEL SITE', 'tunnel_site'],
      ['SOMETHING ELSE', 'other'],
    ];
    for (const [text, want] of cases) {
      vi.resetModules();
      installBlmMock();
      const orig = claim;
      totalClaims = 1;
      // Patch the mock's single claim type via a follow-up fetch stub layer:
      const prevFetch = global.fetch;
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        const r = await prevFetch(url);
        if (/\/query/.test(String(url))) {
          const body = await r.json();
          body.features = body.features.map((f) => ({ ...f, properties: { ...f.properties, CSE_TYPE_TXT: text } }));
          return { ok: true, headers: new Map([['content-type', 'application/json']]), json: async () => body, text: async () => JSON.stringify(body) };
        }
        return r;
      }));
      const { default: h } = await import('../api/claims.js');
      const res = mockRes();
      await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
      expect(res.body.features[0].properties.CLAIM_TYPE, text).toBe(want);
    }
  });
});

describe('Canadian paths untouched', () => {
  it('a Yukon company search still resolves through ARCGIS_PROVINCES with no state scoping', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      const json = (body) => ({ ok: true, headers: new Map([['content-type', 'application/json']]), json: async () => body, text: async () => JSON.stringify(body) });
      if (u.includes('GY_Mining/MapServer?f=json')) return json({ layers: [{ id: 5, name: 'Quartz Claims' }] });
      if (u.includes('/MapServer/5?f=json')) {
        return json({ maxRecordCount: 500, objectIdField: 'OBJECTID', advancedQueryCapabilities: { supportsPagination: true }, fields: [{ name: 'OBJECTID', type: 'esriFieldTypeOID' }, { name: 'OWNER', type: 'esriFieldTypeString' }] });
      }
      if (u.includes('/MapServer/5/query')) {
        expect(decodeURIComponent(u)).not.toMatch(/STATE_GEO/);
        return json({ type: 'FeatureCollection', features: [claim(1, { OWNER: 'Klondike Gold' })] });
      }
      throw new Error(`unexpected ${u}`);
    }));
    vi.resetModules();
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'klondike', type: 'company', province: 'yt' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toHaveLength(1);
  });
});
