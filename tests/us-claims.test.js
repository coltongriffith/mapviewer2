import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// End-to-end tests of the US federal (BLM MLRS) jurisdiction path through the
// real /api/claims handler, against a fully mocked BLM ArcGIS service.
//
// The mock mirrors the LIVE service as of October 2026:
//   nlsdbpubgis.blm.gov/arcgis/rest/services/Mining_Claims/MiningClaims/MapServer/1
//   "Active Mining Claims" — fields below, GEO_STATE and ADMIN_STATE present on
//   the schema but NULL on most rows, the state carried instead by the PLSS
//   legal description in CSE_META ("NV 21 0330N 0510E 033 A SE|…").
// It answers the ids-first protocol the engine uses on this layer:
// returnIdsOnly → objectIds batches. Variant tests drop fields to exercise the
// older schemas the engine still has to survive.

const BLM_FIELDS = [
  { name: 'OBJECTID', type: 'esriFieldTypeOID' },
  { name: 'ADMIN_STATE', type: 'esriFieldTypeString' },
  { name: 'GEO_STATE', type: 'esriFieldTypeString' },
  { name: 'BLM_PROD', type: 'esriFieldTypeString' },
  { name: 'CSE_DISP', type: 'esriFieldTypeString' },
  { name: 'CSE_TYPE_NR', type: 'esriFieldTypeString' },
  { name: 'CSE_NR', type: 'esriFieldTypeString' },
  { name: 'LEG_CSE_NR', type: 'esriFieldTypeString' },
  { name: 'CSE_NAME', type: 'esriFieldTypeString' },
  { name: 'LOC_DT', type: 'esriFieldTypeDate' },
  { name: 'QLTY', type: 'esriFieldTypeString' },
  { name: 'CSE_META', type: 'esriFieldTypeString' },
  { name: 'RCRD_ACRS', type: 'esriFieldTypeDouble' },
];
// The layer the engine was first written against had no legacy serial and no
// legal description; several resilience tests still need that shape.
const withoutFields = (re) => BLM_FIELDS.filter((f) => !re.test(f.name));

const claim = (i, over = {}, st = 'NV') => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[-116, 40], [-116, 40.01], [-115.99, 40.01], [-115.99, 40], [-116, 40]]] },
  properties: {
    OBJECTID: i,
    // As published: both state fields empty on the great majority of rows.
    ADMIN_STATE: null,
    GEO_STATE: null,
    BLM_PROD: 'Lode Claim',
    CSE_DISP: 'Active',
    CSE_NR: `${st}10${5000000 + i}`,
    LEG_CSE_NR: '',
    CSE_NAME: `GOLDIE #${i}`,
    CSE_META: `${st} 21 0330N 0510E 033 A SE|${st} 21 0320N 0510E 004 A NE`,
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
const req = (query, method = 'GET', headers = {}) => ({
  method, query, url: `/api/claims?${new URLSearchParams(query)}`,
  headers: { 'x-forwarded-for': `172.16.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`, ...headers },
});
const jsonResponse = (body) => ({ ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => body, text: async () => JSON.stringify(body) });

// Every FILTER query the handler sends upstream (ids / count / plain queries),
// decoded, so tests can assert on the WHERE clause the engine built. The
// objectIds row fetches that follow go to rowFetchUrls.
let queryUrls;
let rowFetchUrls;
let metaUrls;
let totalClaims;
let blmFields;
// Optional per-test row source. Given a decoded WHERE clause it returns the rows
// that clause should match, so tiered searches (the company alias ladder) can be
// tested for real instead of always seeing the same canned rows.
let rowsForWhere;
// Optional fixed rows for every filter query.
let fixtureRows;
function installBlmMock(fields = BLM_FIELDS) {
  queryUrls = [];
  rowFetchUrls = [];
  metaUrls = [];
  totalClaims = 3;
  blmFields = fields;
  rowsForWhere = null;
  fixtureRows = null;
  const store = new Map();
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    if (/MapServer\/\d+\?f=json/.test(u)) {
      metaUrls.push(u);
      return jsonResponse({
        name: 'Active Mining Claims',
        maxRecordCount: 2000,
        // Offset paging IS advertised; the engine must not use it on BLM.
        advancedQueryCapabilities: { supportsPagination: true },
        fields: blmFields,
      });
    }
    if (/MapServer\/\d+\/query/.test(u)) {
      // URLSearchParams encodes spaces as '+', which decodeURIComponent leaves alone
      const decoded = decodeURIComponent(u.replace(/\+/g, ' '));
      const params = new URL(u).searchParams;
      if (params.get('objectIds')) {
        rowFetchUrls.push(decoded);
        const ids = params.get('objectIds').split(',').map(Number);
        return jsonResponse({ type: 'FeatureCollection', features: ids.map((id) => store.get(id)).filter(Boolean) });
      }
      queryUrls.push(decoded);
      if (params.get('returnCountOnly')) return jsonResponse({ count: 42 });
      const st = decoded.match(/CSE_NR\)? LIKE '([A-Z]{2})%'/)?.[1] || 'NV';
      const rows = rowsForWhere ? rowsForWhere(decoded)
        : fixtureRows || Array.from({ length: totalClaims }, (_, i) => claim(i + 1, {}, st));
      rows.forEach((r) => store.set(r.properties.OBJECTID, r));
      if (params.get('returnIdsOnly')) {
        // Live ArcGIS answers "no matches" with objectIds: null, not [].
        return jsonResponse({ objectIdFieldName: 'OBJECTID', objectIds: rows.length ? rows.map((r) => r.properties.OBJECTID) : null });
      }
      return jsonResponse({ type: 'FeatureCollection', features: rows });
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

describe('US service location (October 2026 move)', () => {
  it('queries the public MapServer, layer 1 "Active Mining Claims", by default', async () => {
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(metaUrls[0]).toMatch(/^https:\/\/nlsdbpubgis\.blm\.gov\/arcgis\/rest\/services\/Mining_Claims\/MiningClaims\/MapServer\/1\?f=json/);
    expect(queryUrls[0]).toMatch(/MapServer\/1\/query/);
  });

  it('takes the layer id from BLM_MLRS_LAYER_ID', async () => {
    process.env.BLM_MLRS_LAYER_ID = '7';
    try {
      vi.resetModules();
      installBlmMock();
      const { default: h } = await import('../api/claims.js');
      const res = mockRes();
      await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
      expect(res.statusCode).toBe(200);
      expect(metaUrls[0]).toMatch(/MapServer\/7\?f=json/);
    } finally {
      delete process.env.BLM_MLRS_LAYER_ID;
    }
  });

  it('reports a redirect that drops the path as a moved service, not a schema change', async () => {
    // Exactly what gis.blm.gov did: 301 from the layer to the bare REST root.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 301,
      headers: new Map([['location', 'https://nlsdbpubgis.blm.gov/arcgis/rest?f=json']]),
      json: async () => ({}),
      text: async () => '',
    })));
    vi.resetModules();
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe('registry_moved');
    expect(res.body.error).toMatch(/moved/i);
    expect(res.body.error).not.toMatch(/schema changed/i);
  });

  it('never follows a redirect: every request is sent with redirect "manual"', async () => {
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    const calls = global.fetch.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, init] of calls) expect(init?.redirect).toBe('manual');
  });

  it('follows a redirect that keeps the path (scheme or host change)', async () => {
    vi.resetModules();
    installBlmMock();
    const blm = global.fetch;
    let redirected = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const u = String(url);
      if (u.startsWith('https://nlsdbpubgis.blm.gov/')) {
        redirected += 1;
        const moved = u.replace('https://nlsdbpubgis.blm.gov/', 'https://mirror.blm.example/');
        return { ok: false, status: 301, headers: new Map([['location', moved]]), json: async () => ({}), text: async () => '' };
      }
      return blm(url, init);
    }));
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(redirected).toBeGreaterThan(0);
    expect(res.body.features.length).toBe(3);
  });

  it('redirectTarget: same path follows, a changed path is an error', async () => {
    const { redirectTarget } = await import('../api/claims.js');
    const r = (status, location) => ({ status, headers: new Map(location ? [['location', location]] : []) });
    const from = 'https://a.example/arcgis/rest/services/X/MapServer/1?f=json';
    expect(redirectTarget(from, r(200))).toBeNull();
    expect(redirectTarget(from, r(301, 'https://b.example/arcgis/rest/services/X/MapServer/1?f=json')).follow)
      .toBe('https://b.example/arcgis/rest/services/X/MapServer/1?f=json');
    // A target that kept the path but dropped the query gets ours back.
    expect(redirectTarget(from, r(302, 'https://b.example/arcgis/rest/services/X/MapServer/1')).follow)
      .toBe('https://b.example/arcgis/rest/services/X/MapServer/1?f=json');
    const moved = redirectTarget(from, r(301, 'https://b.example/arcgis/rest?f=json'));
    expect(moved.error.registryMoved).toBe(true);
    expect(moved.error.message).toMatch(/has moved/);
    expect(redirectTarget(from, r(308)).error.registryMoved).toBe(true);
  });
});

describe('US claim-name search (us-nv)', () => {
  it('resolves the name field, scopes to the state, and normalizes results', async () => {
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);

    // BLM stores names and serials in capitals, so the column is compared raw
    // (index-friendly) against an upper-cased pattern; the state narrowing is
    // the serial prefix. GEO_STATE is NOT in the WHERE: it is mostly NULL on
    // the live layer, and filtering on it returned an empty Nevada.
    const where = queryUrls[0];
    expect(where).toMatch(/CSE_NAME LIKE '%GOLDIE%'/);
    expect(where).not.toMatch(/UPPER\(CSE_NAME\)/);
    expect(where).toMatch(/CSE_NR LIKE 'NV%'/);
    expect(where).not.toMatch(/GEO_STATE|ADMIN_STATE/);
    expect(where).toMatch(/returnIdsOnly=true/);

    const p = res.body.features[0].properties;
    expect(p.CLAIM_NAME).toBe('GOLDIE #1');
    expect(p.TAG_NUMBER).toMatch(/^NV10/);
    expect(p.CLAIM_TYPE).toBe('lode');
    expect(p.TITLE_TYPE_DESCRIPTION).toBe('Lode Claim'); // from BLM_PROD
    expect(p.STATUS).toBe('Active');                     // from CSE_DISP
    expect(p.US_STATE).toBe('NV');
    expect(p.SOURCE_SYSTEM).toBe('BLM MLRS');
    expect(p.GEOM_GENERALIZED).toBe(true);
    // acres → hectares (20.66 ac ≈ 8.36 ha), original preserved
    expect(p.AREA_IN_HECTARES).toBeCloseTo(8.36, 1);
    expect(p.RCRD_ACRS).toBe(20.66);
    // No fabricated expiry, and an empty legacy serial is not reported
    expect(p.GOOD_TO_DATE).toBeUndefined();
    expect(p.LEGACY_NR).toBeUndefined();
    expect(res.body.meta.provider).toBe('blm-mlrs');
  });
});

describe('US query shape (performance on the national layer)', () => {
  it('runs ids-first with parallel objectIds batches, never offset paging', async () => {
    totalClaims = 1200;
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toHaveLength(1200);
    for (const u of [...queryUrls, ...rowFetchUrls]) {
      expect(u).not.toMatch(/resultOffset|orderByFields/);
    }
    expect(rowFetchUrls.length).toBe(5);   // 1,200 ids in batches of 250
    for (const u of rowFetchUrls) {
      expect(u.match(/objectIds=([^&]*)/)[1].split(',').length).toBeLessThanOrEqual(250);
    }
  });

  it('asks only for the fields it uses, at a sane precision', async () => {
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    const fetchRows = rowFetchUrls[0];
    expect(fetchRows).not.toMatch(/outFields=\*/);
    expect(fetchRows).toMatch(/outFields=[^&]*CSE_META/);
    expect(fetchRows).toMatch(/outFields=[^&]*CSE_NR/);
    expect(fetchRows).not.toMatch(/QLTY/);
    expect(fetchRows).toMatch(/geometryPrecision=6/);
  });

  it('answers a repeated search from the short-lived cache', async () => {
    const a = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-nv' }), a);
    const sent = queryUrls.length;
    const b = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-nv' }), b);
    expect(queryUrls.length).toBe(sent);
    expect(b.body.features).toHaveLength(a.body.features.length);
  });
});

describe('US serial-number search', () => {
  it('tolerates spacing/dash formatting and asks for an indexed exact match first', async () => {
    const res = mockRes();
    await handler(req({ q: 'nv 105-000-001', type: 'number', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    const where = queryUrls[0];
    expect(where).toMatch(/CSE_NR = 'NV105000001'/);
    expect(where).toMatch(/LEG_CSE_NR = 'NV105000001'/);
    expect(where).not.toMatch(/UPPER\(CSE_NR\)/);
    expect(where).not.toMatch(/LIKE '%/);
  });

  it('leaves the legacy OR out when the layer has no legacy field', async () => {
    vi.resetModules();
    installBlmMock(withoutFields(/LEG_CSE_NR/));
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'NV105000001', type: 'number', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).not.toMatch(/LEG|LGCY/i);
  });

  it('ORs the legacy serial field under its older LGCY_ spelling too', async () => {
    vi.resetModules();
    installBlmMock([...withoutFields(/LEG_CSE_NR/), { name: 'LGCY_CSE_NR', type: 'esriFieldTypeString' }]);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'nmc123456', type: 'number', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).toMatch(/OR LGCY_CSE_NR = 'NMC123456'/);
  });

  it('reads bare digits as this state\'s serial, before any widening', async () => {
    vi.resetModules();
    installBlmMock();
    rowsForWhere = (where) => (/CSE_NR = 'NV105222372'/.test(where) ? [claim(9, { CSE_NR: 'NV105222372' })] : []);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: '105222372', type: 'number', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.features.map((f) => f.properties.TAG_NUMBER)).toEqual(['NV105222372']);
    // The typed form first, then the prefixed form — not a contains scan.
    expect(queryUrls[0]).toMatch(/CSE_NR = '105222372'/);
    expect(queryUrls[1]).toMatch(/CSE_NR = 'NV105222372'/);
    expect(queryUrls).toHaveLength(2);
    // Honest: the answer is labelled as the prefixed form, not what was typed.
    expect(res.body.meta.relaxedTo).toBe('NV105222372');
  });

  it('answers a pasted list with one exact IN query on the raw columns', async () => {
    const res = mockRes();
    await handler(req({ q: 'NV105000001, NV105000002', type: 'number', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).toMatch(/CSE_NR IN \('NV105000001','NV105000002'\)/);
    expect(queryUrls[0]).not.toMatch(/UPPER\(/);
  });
});

describe('US state scoping (per row)', () => {
  it('scopes geographically from the legal description when GEO_STATE is empty', async () => {
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toHaveLength(3);
    expect(res.body.meta.scopingMethod).toBe('legal_description');
    expect(res.body.meta.scopingDegraded).toBe(false);
    expect(res.body.meta.scopingNote).toBeUndefined();
  });

  it('declares geo_state when every claim carried a filled GEO_STATE', async () => {
    vi.resetModules();
    installBlmMock();
    fixtureRows = [1, 2].map((i) => claim(i, { GEO_STATE: 'NV', CSE_META: null }));
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.body.features).toHaveLength(2);
    expect(res.body.meta.scopingMethod).toBe('geo_state');
    expect(res.body.meta.scopingDegraded).toBe(false);
  });

  it('drops claims whose own location is in another state, whatever the serial says', async () => {
    vi.resetModules();
    installBlmMock();
    fixtureRows = [
      claim(1),                                                   // NV ground
      claim(2, { CSE_META: 'CA 21 0100N 0170E 012 A NW' }),       // NV serial, California ground
      claim(3, { GEO_STATE: 'AZ' }),                              // GEO_STATE wins when filled
      claim(4, { CSE_META: 'CA 21 0100N 0170E 012 A NW|NV 21 0100N 0170E 007 A NE' }), // straddles the line
    ];
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.body.features.map((f) => f.properties.OBJECTID)).toEqual([1, 4]);
    expect(res.body.meta.returned).toBe(2);
    expect(res.body.meta.totalKnown).toBe(2);
  });

  it('places a claim with no location by serial prefix, and declares that as degraded', async () => {
    vi.resetModules();
    installBlmMock();
    fixtureRows = [claim(1), claim(2, { CSE_META: '' }), claim(3, { CSE_META: null })];
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.body.features).toHaveLength(3);
    expect(res.body.meta.scopingMethod).toBe('serial_prefix');
    expect(res.body.meta.scopingDegraded).toBe(true);
    expect(res.body.meta.scopingNote).toMatch(/^2 of 3 claims/);
  });

  it('does not trust a GEO_STATE that exists but is empty (no legal description either)', async () => {
    // The October 2026 failure mode, isolated: the field resolves, is NULL on
    // every row, and must neither filter the query nor masquerade as geographic.
    vi.resetModules();
    installBlmMock(withoutFields(/CSE_META/));
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).not.toMatch(/GEO_STATE/);
    expect(res.body.features).toHaveLength(3);
    expect(res.body.meta.scopingMethod).toBe('serial_prefix');
    expect(res.body.meta.scopingDegraded).toBe(true);
  });

  it('separates Oregon from Washington by location, under their shared OR serials', async () => {
    const rows = [
      claim(1, { CSE_NR: 'OR105000001', CSE_META: 'OR 33 0100S 0100E 012 A NW' }),
      claim(2, { CSE_NR: 'OR105000002', CSE_META: 'WA 33 0300N 0400E 001 A NE' }),
      claim(3, { CSE_NR: 'OR105000003', CSE_META: null }),     // nowhere on record
    ];
    for (const [province, want] of [['us-or', [1]], ['us-wa', [2]]]) {
      vi.resetModules();
      installBlmMock();
      fixtureRows = rows;
      const { default: h } = await import('../api/claims.js');
      const res = mockRes();
      await h(req({ q: 'goldie', type: 'name', province }), res);
      expect(res.statusCode, province).toBe(200);
      // One office, one prefix: both states narrow to OR… serials.
      expect(queryUrls[0], province).toMatch(/CSE_NR LIKE 'OR%'/);
      expect(res.body.features.map((f) => f.properties.OBJECTID), province).toEqual(want);
      expect(res.body.features[0].properties.US_STATE).toBe(province.slice(3).toUpperCase());
      // The unlocated claim is left out — never guessed — and that is declared.
      expect(res.body.meta.scopingDegraded, province).toBe(true);
      expect(res.body.meta.scopingNote, province).toMatch(/1 claims administered by the Oregon\/Washington/);
    }
  });

  it('keeps Oregon/Washington precise (not degraded) when every claim is located', async () => {
    vi.resetModules();
    installBlmMock();
    fixtureRows = [claim(1, { CSE_NR: 'OR105000001', CSE_META: 'WA 33 0300N 0400E 001 A NE' })];
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-wa' }), res);
    expect(res.body.features).toHaveLength(1);
    expect(res.body.meta.scopingMethod).toBe('legal_description');
    expect(res.body.meta.scopingDegraded).toBe(false);
  });

  it('legalDescriptionStates reads every aliquot, and ignores junk', async () => {
    const { legalDescriptionStates } = await import('../api/claims.js');
    expect(legalDescriptionStates('NV 21 0330N 0510E 033 A SE|NV 21 0320N 0510E 004 A NE')).toEqual(['NV']);
    expect(legalDescriptionStates('CA 21 0100N 0170E 012 A NW|NV 21 0100N 0170E 007 A NE')).toEqual(['CA', 'NV']);
    expect(legalDescriptionStates('')).toEqual([]);
    expect(legalDescriptionStates(null)).toEqual([]);
    expect(legalDescriptionStates('1: MIDPOINT')).toEqual([]);
  });
});

describe('US state scoping on older layer schemas (whole-set SQL modes)', () => {
  it('degrades to ADMIN_STATE and declares it as administrative, not geographic', async () => {
    vi.resetModules();
    installBlmMock(withoutFields(/GEO_STATE|CSE_META/));
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).toMatch(/UPPER\(ADMIN_STATE\) = 'NV'/);
    expect(res.body.meta.scopingMethod).toBe('admin_state');
    expect(res.body.meta.scopingDegraded).toBe(true);
    // The note must say the scope is administrative — a caller that renders it
    // verbatim has to be able to warn a user without knowing BLM internals.
    expect(res.body.meta.scopingNote).toMatch(/administering BLM office/i);
    expect(res.body.meta.scopingNote).toMatch(/not by claim location/i);
  });

  it('falls back to serial-prefix scoping when no state field resolves, and declares it', async () => {
    vi.resetModules();
    installBlmMock(withoutFields(/STATE|CSE_META|LEG_CSE_NR/));
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    // MLRS serials carry the two-letter state code (NV105331298). The NMC-style
    // office code belongs to the LEGACY serial field and must not be applied
    // to CSE_NR.
    expect(queryUrls[0]).toMatch(/UPPER\(CSE_NR\) LIKE 'NV%'/);
    expect(queryUrls[0]).not.toMatch(/CSE_NR\) LIKE 'NMC%'/);
    expect(res.body.meta.scopingMethod).toBe('serial_prefix');
    expect(res.body.meta.scopingDegraded).toBe(true);
    expect(res.body.meta.scopingNote).toMatch(/serial/i);
  });

  it('adds the legacy office prefix on the legacy field only (LEG_ and LGCY_ spellings)', async () => {
    for (const legacy of ['LEG_CSE_NR', 'LGCY_CSE_NR']) {
      vi.resetModules();
      installBlmMock([...withoutFields(/STATE|CSE_META|LEG_CSE_NR/), { name: legacy, type: 'esriFieldTypeString' }]);
      const { default: h } = await import('../api/claims.js');
      const res = mockRes();
      await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
      expect(res.statusCode).toBe(200);
      expect(queryUrls[0]).toMatch(/UPPER\(CSE_NR\) LIKE 'NV%'/);
      expect(queryUrls[0]).toMatch(new RegExp(`UPPER\\(${legacy}\\) LIKE 'NMC%'`));
      expect(res.body.meta.scopingMethod).toBe('serial_prefix');
    }
  });

  it('refuses Oregon and Washington when nothing on the layer locates a claim', async () => {
    // The Oregon/Washington state office administers both states, so no serial
    // prefix distinguishes them. Returning Oregon claims labelled Washington
    // would be a plausible-looking wrong answer — a hard error is correct.
    for (const province of ['us-or', 'us-wa']) {
      vi.resetModules();
      installBlmMock(withoutFields(/STATE|CSE_META/));
      const { default: h } = await import('../api/claims.js');
      const res = mockRes();
      await h(req({ q: 'goldie', type: 'name', province }), res);
      expect(res.statusCode, province).toBe(502);
      expect(res.body.error).toMatch(/state filtering is unavailable/i);
    }
  });

  it('surfaces the schema error only when neither state nor serial resolves', async () => {
    vi.resetModules();
    installBlmMock(withoutFields(/STATE|CSE_NR|CSE_META/));
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/state filtering is unavailable/i);
  });
});

describe('US scoping is declared on every path', () => {
  it('bbox, number and company all carry the declaration', async () => {
    // Acceptance: no code path returns claims under degraded scoping without
    // the response declaring it.
    vi.resetModules();
    installBlmMock(withoutFields(/GEO_STATE|CSE_META/));
    const { default: h } = await import('../api/claims.js');

    const bbox = mockRes();
    await h(req({ bbox: '-116.5,39.5,-115.5,40.5', province: 'us-nv' }), bbox);
    expect(bbox.statusCode).toBe(200);
    expect(bbox.body.features.length).toBeGreaterThan(0);
    expect(bbox.body.meta.scopingMethod).toBe('admin_state');
    expect(bbox.body.meta.scopingDegraded).toBe(true);

    const number = mockRes();
    await h(req({ q: 'NV105000001', type: 'number', province: 'us-nv' }), number);
    expect(number.body.meta.scopingDegraded).toBe(true);

    const company = mockRes();
    await h(req({ q: 'goldie', type: 'company', province: 'us-nv' }), company);
    expect(company.body.meta.scopingMethod).toBe('admin_state');
    expect(company.body.meta.scopingDegraded).toBe(true);
  });

  it('and on the live schema they all declare the per-row method', async () => {
    for (const query of [
      { bbox: '-116.5,39.5,-115.5,40.5', province: 'us-nv' },
      { q: 'NV105000001', type: 'number', province: 'us-nv' },
      { q: 'goldie', type: 'company', province: 'us-nv' },
      { q: 'goldie', type: 'name', province: 'us-nv' },
    ]) {
      const res = mockRes();
      await handler(req(query), res);
      expect(res.statusCode, JSON.stringify(query)).toBe(200);
      expect(res.body.meta.scopingMethod, JSON.stringify(query)).toBe('legal_description');
      expect(res.body.meta.usScope, 'internal counts never leak').toBeUndefined();
    }
  });
});

describe('US company resolution via the subsidiary alias ladder', () => {
  // Claim/claimant strings the mock will match a LIKE against.
  const namedClaim = (i, name) => claim(i, { CSE_NAME: name });

  function installNameMock(rows) {
    vi.resetModules();
    installBlmMock();
    rowsForWhere = (where) => {
      // Crude LIKE evaluator: pull each '%term%' out of the WHERE and match it
      // against the row's claim name, the way the live service would.
      const terms = [...where.matchAll(/LIKE (?:UPPER\()?'%([^%']*)%'/g)].map((m) => m[1].toUpperCase());
      return rows.filter((r) => {
        const n = String(r.properties.CSE_NAME).toUpperCase();
        return terms.some((t) => t && n.includes(t));
      });
    };
  }

  it('finds Nevada ground held under a US subsidiary from the parent-company name', async () => {
    // Acceptance case: the issuer is "Awesome Gold Corp."; its Nevada claims are
    // named after "AWESOME GOLD NEVADA LLC". The parent name alone matches
    // nothing exactly, so tier 2 (alias variants) has to carry it.
    installNameMock([
      namedClaim(1, 'AWESOME GOLD NEVADA LLC 1'),
      namedClaim(2, 'AWESOME GOLD NEVADA LLC 2'),
      namedClaim(3, 'SOMEONE ELSE #7'),
    ]);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'Awesome Gold Corp.', type: 'company', province: 'us-nv' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.resolution.status).toBe('resolved');
    expect(res.body.resolution.method).toBe('alias');
    // No claimant field on this layer, so the ladder ran against claim names —
    // and says so, rather than implying a real claimant match.
    expect(res.body.resolution.resolvedAgainst).toBe('claim_name');
    expect(res.body.features).toHaveLength(2);
    expect(res.body.features.map((f) => f.properties.CLAIM_NAME)).toEqual([
      'AWESOME GOLD NEVADA LLC 1', 'AWESOME GOLD NEVADA LLC 2',
    ]);
  });

  it('prefers an exact match and stops before the alias tier', async () => {
    installNameMock([namedClaim(1, 'AWESOME GOLD CORP')]);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'AWESOME GOLD CORP', type: 'company', province: 'us-nv' }), res);
    expect(res.body.resolution.method).toBe('exact');
    expect(res.body.resolution.tiersAttempted).toHaveLength(1);
  });

  it('score-filters the fuzzy tier and drops unrelated rows', async () => {
    // Nothing matches the parent or a subsidiary variant, so the ladder reaches
    // the fuzzy stem tier ('AWESOME GOLD'), whose broad rows are then scored.
    installNameMock([
      namedClaim(1, 'AWESOME GOLD #12'),           // same company, keep
      namedClaim(2, 'AWESOME GOLDFINCH TRUCKING'), // stem collision, drop
    ]);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'Awesome Gold Corp.', type: 'company', province: 'us-nv' }), res);
    expect(res.body.resolution.status).toBe('resolved');
    expect(res.body.resolution.method).toBe('fuzzy');
    expect(res.body.features.map((f) => f.properties.CLAIM_NAME)).toEqual(['AWESOME GOLD #12']);
  });

  it('reports UNRESOLVED — not "no claims found" — when nothing links the company', async () => {
    // The defect this fixes: a US issuer holding ground under a subsidiary was
    // indistinguishable from one holding no US ground at all.
    installNameMock([namedClaim(1, 'TOTALLY UNRELATED CLAIM')]);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'Awesome Gold Corp.', type: 'company', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toHaveLength(0);
    expect(res.body.resolution.status).toBe('unresolved');
    expect(res.body.resolution.reason).toBe('no_claim_name_match');
    // Every tier was tried before giving up.
    expect(res.body.resolution.tiersAttempted.map((t) => t.method)).toEqual(['exact', 'alias', 'fuzzy']);
  });

  it('reports no_claimant_field when the layer publishes neither claimant nor name', async () => {
    vi.resetModules();
    installBlmMock(withoutFields(/CSE_NAME/));
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'Awesome Gold Corp.', type: 'company', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.resolution.status).toBe('unresolved');
    expect(res.body.resolution.reason).toBe('no_claimant_field');
    expect(res.body.features).toHaveLength(0);
  });

  it('uses a real claimant field when BLM publishes one, and says so', async () => {
    vi.resetModules();
    installBlmMock([...BLM_FIELDS, { name: 'CLAIMANT_NAME', type: 'esriFieldTypeString' }]);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'Awesome Gold Corp.', type: 'company', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).toMatch(/CLAIMANT_NAME LIKE '%/);
    expect(res.body.resolution.resolvedAgainst).toBe('claimant');
  });

  it('keeps the state scope on every tier of the ladder', async () => {
    installNameMock([namedClaim(1, 'NOTHING MATCHES')]);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'Awesome Gold Corp.', type: 'company', province: 'us-az' }), res);
    expect(queryUrls.length).toBeGreaterThanOrEqual(3);
    for (const u of queryUrls) expect(u).toMatch(/CSE_NR LIKE 'AZ%'/);
  });
});

describe('US upstream resilience', () => {
  it('retries once when ArcGIS returns an in-body error, then succeeds', async () => {
    // BLM's SDE backend intermittently returns HTTP 200 + {error} on
    // expensive scans; a single retry must recover the search.
    vi.resetModules();
    installBlmMock();
    let queryCalls = 0;
    const prevFetch = global.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (/MapServer\/1\/query/.test(String(url)) && ++queryCalls === 1) {
        return jsonResponse({ error: { code: 500, message: 'Error performing query operation' } });
      }
      return prevFetch(url, init);
    }));
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-ut' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.features.length).toBeGreaterThan(0);
    expect(queryCalls).toBeGreaterThanOrEqual(2);
  }, 15000);

  it('maps upstream timeouts to 504 with actionable guidance (not "failed to reach")', async () => {
    vi.resetModules();
    installBlmMock();
    const prevFetch = global.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (/MapServer\/1\/query/.test(String(url))) {
        const e = new Error('The operation was aborted due to timeout');
        e.name = 'TimeoutError';
        throw e;
      }
      return prevFetch(url, init);
    }));
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-ut' }), res);
    expect(res.statusCode).toBe(504);
    expect(res.body.error).toMatch(/responding slowly/i);
    expect(res.body.error).toMatch(/more specific search/i);
  });

  it('keeps the rows it has when one batch fails, and says the set is incomplete', async () => {
    vi.resetModules();
    installBlmMock();
    totalClaims = 600;
    const prevFetch = global.fetch;
    let batches = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (/objectIds=/.test(String(url)) && ++batches === 2) throw new Error('socket hang up');
      return prevFetch(url, init);
    }));
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.features.length).toBe(350);
    expect(res.body.meta.truncated).toBe(true);
  });
});

describe('US pagination', () => {
  it('fetches every row beyond maxRecordCount with honest meta', async () => {
    totalClaims = 4500; // > 2 pages at maxRecordCount 2000
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-az' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toHaveLength(4500);
    expect(res.body.meta.truncated).toBe(false);
    expect(res.body.meta.totalKnown).toBe(4500);
    expect(res.body.meta.pagesFetched).toBeGreaterThanOrEqual(3);
    // az jurisdiction scopes to AZ
    expect(queryUrls[0]).toMatch(/CSE_NR LIKE 'AZ%'/);
  });
});

describe('US jurisdiction validation', () => {
  it('rejects unknown US states', async () => {
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'us-zz' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects map-sheet search, and no longer says BC can do it', async () => {
    // This used to read "only available for BC", which was wrong in the
    // direction that costs a user a search: BC could not do it either.
    const res = mockRes();
    await handler(req({ q: '082F', type: 'map', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/not available/i);
    expect(`${res.body.error} ${res.body.detail}`).not.toMatch(/only available for BC/i);
  });

  it('company search resolves through the alias ladder instead of 400-ing', async () => {
    const res = mockRes();
    await handler(req({ q: 'barrick', type: 'company', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.resolution).toBeTruthy();
  });

  it('name search is rejected for jurisdictions without name fields (Canadian)', async () => {
    const res = mockRes();
    await handler(req({ q: 'goldie', type: 'name', province: 'yt' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/not available/i);
  });
});

describe('US bbox (nearby claims) search', () => {
  it('is geographic: no serial narrowing in SQL, rows placed by their own location', async () => {
    vi.resetModules();
    installBlmMock();
    fixtureRows = [claim(1), claim(2, { CSE_NR: 'CA105000002', CSE_META: 'CA 21 0100N 0170E 012 A NW' })];
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ bbox: '-116.5,39.5,-115.5,40.5', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    const spatial = queryUrls.find((u) => u.includes('esriGeometryEnvelope'));
    expect(spatial).toBeTruthy();
    expect(spatial).toMatch(/where=1=1/);
    expect(spatial).not.toMatch(/CSE_NR LIKE/);
    expect(res.body.features.map((f) => f.properties.OBJECTID)).toEqual([1]);
    expect(res.body.features[0].properties.SOURCE_SYSTEM).toBe('BLM MLRS');
    expect(res.body.meta.scopingMethod).toBe('legal_description');
  });
});

describe('US diagnostics (?schema=1)', () => {
  it('reports the resolved service, layer and field fill rates', async () => {
    const res = mockRes();
    await handler(req({ schema: '1', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.service).toMatch(/nlsdbpubgis\.blm\.gov\/.*MiningClaims\/MapServer$/);
    expect(res.body.layerId).toBe(1);
    expect(res.body.layerUrl).toMatch(/MapServer\/1$/);
    expect(res.body.legalDescriptionField).toBe('CSE_META');
    expect(res.body.scoping.method).toBe('legal_description');
    expect(res.body.scoping.perRow).toBe(true);
    expect(res.body.fillRates.counts.total).toBe(42);
    expect(res.body.fillRates.counts.geoStateFilled).toBe(42);
    expect(res.body.fillRates.percentOfLayer.geoStateFilled).toBe(100);
    const counted = queryUrls.filter((u) => /returnCountOnly=true/.test(u));
    expect(counted.some((u) => /GEO_STATE IS NOT NULL/.test(u))).toBe(true);
    expect(counted.some((u) => /CSE_META LIKE 'NV %'/.test(u))).toBe(true);
  });
});

describe('US claim-type normalization', () => {
  it('maps official product text onto normalized categories', async () => {
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
      totalClaims = 1;
      // Patch the mock's single claim type via a follow-up fetch stub layer:
      const prevFetch = global.fetch;
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        const r = await prevFetch(url);
        if (/\/query/.test(String(url))) {
          const body = await r.json();
          if (body.features) body.features = body.features.map((f) => ({ ...f, properties: { ...f.properties, BLM_PROD: text } }));
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
        expect(decodeURIComponent(u)).not.toMatch(/GEO_STATE/);
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

describe('Canadian responses carry no US scoping fields', () => {
  it('a Yukon search reports no scopingMethod at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      const json = (body) => ({ ok: true, headers: new Map([['content-type', 'application/json']]), json: async () => body, text: async () => JSON.stringify(body) });
      if (u.includes('GY_Mining/MapServer?f=json')) return json({ layers: [{ id: 5, name: 'Quartz Claims' }] });
      if (u.includes('/MapServer/5?f=json')) {
        return json({ maxRecordCount: 500, objectIdField: 'OBJECTID', advancedQueryCapabilities: { supportsPagination: true }, fields: [{ name: 'OBJECTID', type: 'esriFieldTypeOID' }, { name: 'OWNER', type: 'esriFieldTypeString' }] });
      }
      if (u.includes('/MapServer/5/query')) return json({ type: 'FeatureCollection', features: [claim(1, { OWNER: 'Klondike Gold' })] });
      throw new Error(`unexpected ${u}`);
    }));
    vi.resetModules();
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'klondike', type: 'company', province: 'yt' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.scopingMethod).toBeUndefined();
    expect(res.body.meta.scopingDegraded).toBeUndefined();
    expect(res.body.resolution).toBeUndefined();
  });
});

// ── Alias layer (unit) ──────────────────────────────────────────────────────

describe('US subsidiary alias layer', () => {
  it('generates jurisdiction-tagged subsidiary variants from a parent name', async () => {
    const { usClaimantVariants } = await import('../api/_lib/us-aliases.js');
    const nv = usClaimantVariants('Awesome Gold Corp.', 'NV');
    expect(nv).toContain('AWESOME GOLD US');
    expect(nv).toContain('AWESOME GOLD USA');
    expect(nv).toContain('AWESOME GOLD NEVADA');
    // The state token is jurisdiction-specific — an Arizona search must not
    // look for a Nevada subsidiary.
    expect(usClaimantVariants('Awesome Gold Corp.', 'AZ')).not.toContain('AWESOME GOLD NEVADA');
    expect(usClaimantVariants('Awesome Gold Corp.', 'AZ')).toContain('AWESOME GOLD ARIZONA');
  });

  it('honours the resolution order: exact, then alias, then fuzzy', async () => {
    const { resolveUsCompanyTiers } = await import('../api/_lib/us-aliases.js');
    const tiers = resolveUsCompanyTiers('Awesome Gold Corp.', 'us-nv');
    expect(tiers.map((t) => t.method)).toEqual(['exact', 'alias', 'fuzzy']);
    // Only the fuzzy tier is score-filtered after the query.
    expect(tiers.filter((t) => t.scored).map((t) => t.method)).toEqual(['fuzzy']);
  });

  it('scores candidates against the pipeline threshold, not a new one', async () => {
    const { matchesCompany } = await import('../api/_lib/us-aliases.js');
    const { NAME_MATCH } = await import('../api/_lib/name-match.js');
    expect(NAME_MATCH.auto).toBe(92);              // unchanged pipeline threshold
    expect(matchesCompany('Awesome Gold Corp.', 'AWESOME GOLD NEVADA LLC', 'us-nv')).toBe(true);
    expect(matchesCompany('Awesome Gold Corp.', 'AWESOME GOLD US INC', 'us-nv')).toBe(true);
    expect(matchesCompany('Awesome Gold Corp.', 'AWESOME GOLDFINCH TRUCKING', 'us-nv')).toBe(false);
    expect(matchesCompany('Awesome Gold Corp.', 'BARRICK GOLD OF NEVADA', 'us-nv')).toBe(false);
  });

  it('refuses a fuzzy stem too short to be a search', async () => {
    const { fuzzyStem } = await import('../api/_lib/us-aliases.js');
    expect(fuzzyStem('Awesome Gold Corp.')).toBe('AWESOME GOLD');
    expect(fuzzyStem('XY Inc.')).toBeNull();
    expect(fuzzyStem('Ltd.')).toBeNull();
  });

  it('ships no curated aliases that were never human-verified', async () => {
    const { CURATED_US_ALIASES } = await import('../api/_lib/us-aliases.js');
    for (const row of CURATED_US_ALIASES) {
      expect(row.verified, `${row.parent} → ${row.claimant}`).toBe('yes');
      expect(row.source).toBeTruthy();
    }
  });
});

// ── Jurisdiction ranking (Task 4) ───────────────────────────────────────────

describe('cross-jurisdiction ranking by materiality', () => {
  const hit = (value, label, areas, dates = []) => ({
    province: { value, label, modes: ['company', 'number'] },
    count: areas.length,
    data: {
      features: areas.map((ha, i) => ({
        type: 'Feature',
        properties: {
          AREA_IN_HECTARES: ha,
          ...(dates[i] ? { RECORDED_DATE: dates[i] } : {}),
        },
      })),
    },
  });

  it('ranks a four-claim flagship above forty dormant claims elsewhere', async () => {
    const { bestJurisdictionHit } = await import('../src/utils/claimRanking.js');
    // BC: 4 claims × 500 ha = 2,000 ha. Nevada: 40 lode claims × 8.4 ha = 336 ha.
    const bc = hit('bc', 'British Columbia', Array(4).fill(500));
    const nv = hit('us-nv', 'Nevada', Array(40).fill(8.4));
    const best = bestJurisdictionHit([nv, bc]);
    expect(best.province.value).toBe('bc');
    expect(best.rankedBy).toBe('area');
  });

  it('breaks an area tie on the most recent recording date', async () => {
    const { bestJurisdictionHit } = await import('../src/utils/claimRanking.js');
    const older = hit('on', 'Ontario', [100], ['2016-03-01']);
    const newer = hit('sk', 'Saskatchewan', [100], ['2025-11-20']);
    expect(bestJurisdictionHit([older, newer]).province.value).toBe('sk');
  });

  it('falls back to claim count only when no candidate publishes area', async () => {
    const { rankJurisdictionHits } = await import('../src/utils/claimRanking.js');
    const few = hit('mb', 'Manitoba', [0, 0]);
    const many = hit('nl', 'Newfoundland', [0, 0, 0, 0]);
    const ranked = rankJurisdictionHits([few, many]);
    expect(ranked[0].province.value).toBe('nl');
    expect(ranked[0].rankedBy).toBe('count');
  });

  it('ranks a candidate with area above one without, and stays stable otherwise', async () => {
    const { rankJurisdictionHits } = await import('../src/utils/claimRanking.js');
    const noArea = hit('mb', 'Manitoba', [0, 0, 0, 0, 0]);
    const withArea = hit('bc', 'British Columbia', [12]);
    expect(rankJurisdictionHits([noArea, withArea])[0].province.value).toBe('bc');
  });

  it('attributes an auto-adopted switch in words the reader can act on', async () => {
    const { autoAdoptionNotice } = await import('../src/utils/claimRanking.js');
    expect(autoAdoptionNotice('Nevada', 'British Columbia', 'Awesome Gold Corp.'))
      .toBe('Showing Nevada — no British Columbia claims found for Awesome Gold Corp.');
  });
});

// ── Degraded-scoping + unresolved messaging (UI text contract) ──────────────

describe('scoping and empty-state messaging', () => {
  it('warns only when scoping is degraded, using the server note', async () => {
    const { scopingWarning } = await import('../src/utils/scopingNotice.js');
    expect(scopingWarning({ scopingMethod: 'geo_state', scopingDegraded: false })).toBeNull();
    expect(scopingWarning(undefined)).toBeNull();
    const warn = scopingWarning({ scopingMethod: 'serial_prefix', scopingDegraded: true, scopingNote: 'Scoped by case-serial prefix …' });
    expect(warn.short).toMatch(/approximate/i);
    expect(warn.detail).toMatch(/case-serial prefix/i);
  });

  it('never gives "unresolved" and "no claims" the same message', async () => {
    const { emptyResultMessage } = await import('../src/utils/scopingNotice.js');
    const unresolved = emptyResultMessage({
      resolution: { status: 'unresolved', reason: 'no_claim_name_match' },
      query: 'Awesome Gold Corp.', jurisdictionLabel: 'Nevada', isUs: true,
    });
    const empty = emptyResultMessage({
      resolution: { status: 'resolved' },
      query: 'Awesome Gold Corp.', jurisdictionLabel: 'Nevada', isUs: true,
    });
    expect(unresolved.kind).toBe('unresolved');
    expect(empty.kind).toBe('empty');
    expect(unresolved.headline).not.toBe(empty.headline);
    expect(unresolved.headline).toMatch(/couldn't link/i);
    // The unresolved case must not imply the company holds nothing.
    expect(unresolved.detail).toMatch(/not a statement that the company holds no ground/i);
    expect(empty.headline).toMatch(/No active claims found/i);
  });

  it('explains the missing-claimant-field case distinctly', async () => {
    const { emptyResultMessage } = await import('../src/utils/scopingNotice.js');
    const msg = emptyResultMessage({
      resolution: { status: 'unresolved', reason: 'no_claimant_field' },
      query: 'Awesome Gold Corp.', jurisdictionLabel: 'Nevada', isUs: true,
    });
    expect(msg.detail).toMatch(/publishes no claimant names/i);
    expect(msg.hint).toMatch(/subsidiary/i);
  });
});

// ── Claim-name resolution is not an ownership finding (Task A) ──────────────

describe('claim-name titling and provenance helpers', () => {
  it('titles a set by the matched claim-name prefix, dropping claim sequence numbers', async () => {
    const { claimNamePrefix } = await import('../src/utils/claimProvenance.js');
    const feats = (names) => names.map((CLAIM_NAME) => ({ properties: { CLAIM_NAME } }));
    expect(claimNamePrefix(feats(['AWESOME GOLD NEVADA 1', 'AWESOME GOLD NEVADA 2'])))
      .toBe('AWESOME GOLD NEVADA');
    // A trailing "#12" is a claim number, not part of the project name.
    expect(claimNamePrefix(feats(['GOLDIE #12', 'GOLDIE #13']))).toBe('GOLDIE');
    // A single claim keeps its full name.
    expect(claimNamePrefix(feats(['LONE PINE 4']))).toBe('LONE PINE 4');
    // Heterogeneous names share no leading token — no honest single title.
    expect(claimNamePrefix(feats(['GOLDIE 1', 'SILVER KING 2']))).toBeNull();
    expect(claimNamePrefix([])).toBeNull();
  });

  it('states the ownership caveat once, for reuse everywhere', async () => {
    const { CLAIM_NAME_CAVEAT } = await import('../src/utils/claimProvenance.js');
    expect(CLAIM_NAME_CAVEAT).toMatch(/not by a claimant record/i);
    expect(CLAIM_NAME_CAVEAT).toMatch(/does not establish who holds the ground/i);
  });

  it('credits the BLM source for US layers and the provincial registry for Canadian ones', async () => {
    const { sourceCredit } = await import('../src/utils/claimProvenance.js');
    expect(sourceCredit({ country: 'us', label: 'Nevada', registry: 'BLM MLRS (federal)' }))
      .toMatch(/BLM MLRS/);
    expect(sourceCredit({ country: 'ca', label: 'British Columbia', registry: 'Mineral Titles Online' }))
      .toBe('British Columbia — Mineral Titles Online');
  });
});

// ── Export credit line (Task C) ─────────────────────────────────────────────

describe('export source credit', () => {
  const layer = (provenance) => ({ id: 'l1', name: 'Claims', provenance });

  it('renders source and retrieval date for a clean claim set', async () => {
    const { exportCreditLines } = await import('../src/utils/claimProvenance.js');
    const [line, ...rest] = exportCreditLines([layer({
      dataSource: 'BLM MLRS — Mining Claims Not Closed (federal)',
      retrievedAt: '2026-07-25',
      scopingMethod: 'geo_state',
    })]);
    expect(rest).toHaveLength(0);
    expect(line).toBe('Source: BLM MLRS — Mining Claims Not Closed (federal) · retrieved 2026-07-25 · state scope: geographic (GEO_STATE)');
  });

  it('states degraded scoping and a claim-name-only link explicitly', async () => {
    const { exportCreditLines } = await import('../src/utils/claimProvenance.js');
    const [line] = exportCreditLines([layer({
      dataSource: 'BLM MLRS — Mining Claims Not Closed (federal)',
      retrievedAt: '2026-07-25',
      scopingMethod: 'serial_prefix',
      resolvedAgainst: 'claim_name',
    })]);
    expect(line).toMatch(/case-serial prefix \(approximate\)/);
    expect(line).toMatch(/claim name only — not an ownership record/);
  });

  it('credits a claimant-resolved set as an ownership record', async () => {
    const { exportCreditLines } = await import('../src/utils/claimProvenance.js');
    const [line] = exportCreditLines([layer({
      dataSource: 'BLM MLRS + NDOM claimant extract',
      snapshotDate: '2026-07-01',
      scopingMethod: 'geo_state',
      resolvedAgainst: 'claimant',
    })]);
    // A periodic claimant source credits its snapshot date, not "retrieved".
    expect(line).toMatch(/snapshot 2026-07-01/);
    expect(line).toMatch(/company link: claimant record/);
  });

  it('credits identical provenance once across many layers, and skips layers without any', async () => {
    const { exportCreditLines } = await import('../src/utils/claimProvenance.js');
    const p = { dataSource: 'BLM MLRS', retrievedAt: '2026-07-25' };
    const lines = exportCreditLines([layer(p), layer({ ...p }), { id: 'x', name: 'Uploaded.kml' }]);
    expect(lines).toHaveLength(1);
  });

  it('produces nothing when no layer carries provenance (uploads stay uncredited)', async () => {
    const { exportCreditLines } = await import('../src/utils/claimProvenance.js');
    expect(exportCreditLines([{ id: 'x', name: 'Uploaded.kml' }])).toEqual([]);
    expect(exportCreditLines([])).toEqual([]);
  });
});

// ── Claimant join: ownership resolved by serial (inert until configured) ────

describe('US claimant store join', () => {
  const CLAIMANT_ROWS = [
    { serial: 'NV105000001', claimant_name: 'AWESOME GOLD NEVADA LLC', claimant_role: 'owner of record', state: 'NV', source: 'mlrs_report_120', snapshot_date: '2026-07-01' },
    { serial: 'NV105000002', claimant_name: 'AWESOME GOLD NEVADA LLC', claimant_role: 'owner of record', state: 'NV', source: 'mlrs_report_120', snapshot_date: '2026-07-01' },
  ];

  // Layers the claimant store answers for; `storeStatus` lets a test simulate
  // "setup SQL never run" (404) and "store down" (500).
  function installWithClaimantStore(rows, storeStatus = 200) {
    vi.resetModules();
    installBlmMock();
    const blmFetch = global.fetch;
    process.env.SUPABASE_URL = 'https://stub.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const u = String(url);
      if (u.includes('/rest/v1/us_claim_claimants')) {
        if (storeStatus !== 200) {
          return { ok: false, status: storeStatus, json: async () => ({}), text: async () => 'err' };
        }
        // Honour the ilike terms so tier order is genuinely exercised.
        const terms = [...u.matchAll(/claimant_name\.ilike\.\*([^*,)]+)\*/g)]
          .map((m) => decodeURIComponent(m[1]).toUpperCase());
        const matched = rows.filter((r) => terms.some((t) => r.claimant_name.toUpperCase().includes(t)));
        return { ok: true, status: 200, json: async () => matched, text: async () => JSON.stringify(matched) };
      }
      return blmFetch(url, init);
    }));
  }

  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  });

  it('resolves ownership through the store and reports resolvedAgainst=claimant', async () => {
    installWithClaimantStore(CLAIMANT_ROWS);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'Awesome Gold Corp.', type: 'company', province: 'us-nv' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.resolution.status).toBe('resolved');
    // This is the ONLY value permitted to title a layer as a company's claims.
    expect(res.body.resolution.resolvedAgainst).toBe('claimant');
    expect(res.body.resolution.serialsMatched).toBe(2);
    expect(res.body.resolution.claimants).toContain('AWESOME GOLD NEVADA LLC');
    // Roles are preserved as BLM words them, never collapsed to "owner".
    expect(res.body.resolution.claimantRoles).toEqual(['owner of record']);
    // Geometry came from BLM, joined on the serial.
    const joined = queryUrls.find((u) => /IN \(/.test(u));
    expect(joined).toMatch(/CSE_NR IN \('NV105000001','NV105000002'\)/);
    // State scoping still applies to the geometry fetch.
    expect(joined).toMatch(/CSE_NR LIKE 'NV%'/);
  });

  it('carries the extract snapshot date, so ownership cannot read as live', async () => {
    installWithClaimantStore(CLAIMANT_ROWS);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'Awesome Gold Corp.', type: 'company', province: 'us-nv' }), res);
    expect(res.body.resolution.snapshotDate).toBe('2026-07-01');
    expect(res.body.resolution.claimantSources).toEqual(['mlrs_report_120']);
  });

  it('stays inert when the store is not configured (the shipped default)', async () => {
    // No SUPABASE_URL → claim-name path, exactly as before the join existed.
    vi.resetModules();
    installBlmMock();
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'company', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.resolution.resolvedAgainst).toBe('claim_name');
    expect(res.body.resolution.snapshotDate).toBeUndefined();
  });

  it('falls back to claim names when the table is absent (setup SQL not run)', async () => {
    installWithClaimantStore(CLAIMANT_ROWS, 404);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'company', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.resolution.resolvedAgainst).toBe('claim_name');
  });

  it('falls back to claim names when the store errors, rather than failing the search', async () => {
    installWithClaimantStore(CLAIMANT_ROWS, 500);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'goldie', type: 'company', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.resolution.resolvedAgainst).toBe('claim_name');
  });

  it('does not claim ownership for a company the store has never heard of', async () => {
    installWithClaimantStore(CLAIMANT_ROWS);
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'Unrelated Mining Corp.', type: 'company', province: 'us-nv' }), res);
    // Store had no match → falls through to the claim-name ladder, which must
    // not be labelled as an ownership result.
    expect(res.body.resolution.resolvedAgainst).toBe('claim_name');
  });
});

describe('claimant-resolved export credit', () => {
  it('names both sources and prefers the snapshot date', async () => {
    const { sourceCredit, exportCreditLines } = await import('../src/utils/claimProvenance.js');
    const dataSource = sourceCredit(
      { country: 'us', label: 'Nevada', registry: 'BLM MLRS (federal)' },
      { provider: 'blm-mlrs' },
      { resolvedAgainst: 'claimant', claimantSources: ['mlrs_report_120'] },
    );
    expect(dataSource).toMatch(/BLM MLRS — Active Mining Claims/);
    expect(dataSource).toMatch(/report 120/);

    const [line] = exportCreditLines([{
      id: 'l1',
      provenance: { dataSource, retrievedAt: '2026-07-25', snapshotDate: '2026-07-01', scopingMethod: 'geo_state', resolvedAgainst: 'claimant' },
    }]);
    expect(line).toMatch(/snapshot 2026-07-01/);
    expect(line).not.toMatch(/retrieved/);
    expect(line).toMatch(/company link: claimant record/);
  });
});

describe('legal_description scoping in the UI text contract', () => {
  it('credits per-row geographic scoping as geographic, and warns only when claims were left out', async () => {
    const { exportCreditLines } = await import('../src/utils/claimProvenance.js');
    const { scopingWarning } = await import('../src/utils/scopingNotice.js');
    const [line] = exportCreditLines([{ id: 'l1', provenance: { dataSource: 'BLM MLRS', retrievedAt: '2026-10-22', scopingMethod: 'legal_description' } }]);
    expect(line).toMatch(/state scope: geographic \(PLSS legal description\)/);
    expect(scopingWarning({ scopingMethod: 'legal_description', scopingDegraded: false })).toBeNull();
    const warn = scopingWarning({ scopingMethod: 'legal_description', scopingDegraded: true, scopingNote: '3 claims administered by the Oregon/Washington BLM office …' });
    expect(warn.detail).toMatch(/^3 claims/);
  });

  it('a search that matches nothing on the live layer answers an empty set, not an error', async () => {
    vi.resetModules();
    installBlmMock();
    rowsForWhere = () => [];
    const { default: h } = await import('../api/claims.js');
    const res = mockRes();
    await h(req({ q: 'nothing here', type: 'name', province: 'us-nv' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toEqual([]);
  });
});
