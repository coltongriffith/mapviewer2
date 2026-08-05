import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Claim-NUMBER search across a layer that publishes more than one identifier.
//
// This is the Manitoba shape, and it is the reason these tests exist. MB's
// iMaQs claim layer carries both a numeric TENURE_NUMBER_ID and a string
// TAG_NUMBER, and `numberFields` lists them in that order. The resolver used to
// take the first name that existed and search only that, so TAG_NUMBER was
// unreachable — while the search box placeholder told people to type exactly a
// staking tag ("e.g. CB12345"). A tag search hit a numeric column, failed the
// digits-only check, and came back as a 400 the interface renders as "no
// results". Every Manitoba number search on record returned nothing.
//
// The fixtures below are field SHAPES, not a claim that MB publishes these
// exact types — the sandbox cannot reach rdmaps.gov.mb.ca to confirm. That is
// the point: the engine must behave correctly whichever way round the types
// are, because it resolves them at runtime.

const MB_SERVICE = 'https://rdmaps.gov.mb.ca/arcgis/rest/services/iMaQs/imaqsMining/MapServer';

// Numeric primary identifier + string secondary. The combination that broke.
const MB_FIELDS = [
  { name: 'OBJECTID', type: 'esriFieldTypeOID' },
  { name: 'TENURE_NUMBER_ID', type: 'esriFieldTypeInteger' },
  { name: 'TAG_NUMBER', type: 'esriFieldTypeString' },
  { name: 'AREA_HA', type: 'esriFieldTypeDouble' },
];

let queryUrls;
function installMock(fields) {
  queryUrls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    const json = (body) => ({
      ok: true,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    if (/MapServer\/3\?f=json/.test(u)) {
      return json({
        name: 'Mining Claim',
        maxRecordCount: 1000,
        objectIdField: 'OBJECTID',
        advancedQueryCapabilities: { supportsPagination: true },
        fields,
      });
    }
    if (/MapServer\/3\/query/.test(u)) {
      queryUrls.push(decodeURIComponent(u.replace(/\+/g, ' ')));
      return json({ type: 'FeatureCollection', features: [] });
    }
    throw new Error(`unexpected url ${u}`);
  }));
}

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
const req = (query) => ({
  method: 'GET',
  query,
  url: `/api/claims?${new URLSearchParams(query)}`,
  headers: { 'x-forwarded-for': `10.90.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}` },
});

async function run(query, fields = MB_FIELDS) {
  vi.resetModules();
  installMock(fields);
  const { default: handler } = await import('../api/claims.js');
  const res = mockRes();
  await handler(req(query), res);
  return res;
}

beforeEach(() => { ipN += 1; });
afterEach(() => vi.unstubAllGlobals());

describe('Manitoba claim-number search', () => {
  it('reaches the string tag column for an alphanumeric tag', async () => {
    const res = await run({ q: 'CB12345', type: 'number', province: 'mb' });
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).toMatch(/UPPER\(TAG_NUMBER\) LIKE UPPER\('%CB12345%'\)/i);
  });

  it('no longer rejects a tag as "numeric — enter digits only"', async () => {
    // The exact failure mode: a 400 the UI renders as an empty result set.
    const res = await run({ q: 'CB12345', type: 'number', province: 'mb' });
    expect(res.statusCode).not.toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/digits only/i);
  });

  it('searches BOTH identifiers when the term is all digits', async () => {
    const res = await run({ q: '1044501', type: 'number', province: 'mb' });
    expect(res.statusCode).toBe(200);
    const where = queryUrls[0];
    // Numeric column can only be compared for equality...
    expect(where).toMatch(/TENURE_NUMBER_ID = 1044501/);
    // ...but the string column still gets a substring match, which is what
    // makes a partial number findable at all on this layer.
    expect(where).toMatch(/UPPER\(TAG_NUMBER\) LIKE UPPER\('%1044501%'\)/i);
    expect(where).toMatch(/ OR /);
  });

  it('does not inject a numeric comparison for a non-numeric term', async () => {
    const res = await run({ q: 'CB12345', type: 'number', province: 'mb' });
    expect(queryUrls[0]).not.toMatch(/TENURE_NUMBER_ID *= *CB/i);
  });

  it('works the other way round too — string primary, numeric secondary', async () => {
    // The engine resolves types at runtime; it must not depend on the order we
    // happened to guess in the candidate list.
    const res = await run({ q: 'CB12345', type: 'number', province: 'mb' }, [
      { name: 'OBJECTID', type: 'esriFieldTypeOID' },
      { name: 'TENURE_NUMBER_ID', type: 'esriFieldTypeString' },
      { name: 'TAG_NUMBER', type: 'esriFieldTypeInteger' },
    ]);
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).toMatch(/UPPER\(TENURE_NUMBER_ID\) LIKE UPPER\('%CB12345%'\)/i);
  });

  it('still refuses honestly when EVERY identifier is numeric', async () => {
    // Not every miss is a bug to paper over. With no string column there is no
    // valid comparison for a tag, and saying so beats returning empty.
    const res = await run({ q: 'CB12345', type: 'number', province: 'mb' }, [
      { name: 'OBJECTID', type: 'esriFieldTypeOID' },
      { name: 'TENURE_NUMBER_ID', type: 'esriFieldTypeInteger' },
      { name: 'TAG_NUMBER', type: 'esriFieldTypeInteger' },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/numeric/i);
    expect(res.body.error).toMatch(/TENURE_NUMBER_ID/);
    expect(res.body.error).toMatch(/TAG_NUMBER/);
  });

  it('a genuinely unmatched number still returns an empty set, not an error', async () => {
    // User error stays user error: a number nobody staked returns zero results
    // and a 200. Nothing here tries to turn that into a hit.
    const res = await run({ q: '9999999', type: 'number', province: 'mb' });
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toEqual([]);
  });
});
