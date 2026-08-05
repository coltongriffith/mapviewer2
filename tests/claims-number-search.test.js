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

// ── LIKE metacharacters ────────────────────────────────────────────────────
//
// escapeSql only doubles quotes, so `%` and `_` stayed live as wildcards. That
// was never an injection — field names are validated and quotes are escaped —
// but it was an amplifier: `q=%%` builds a match-everything pattern and asks a
// provincial server for its whole claim layer, from an endpoint anonymous
// callers can reach.
//
// Manitoba is where it started to matter. Its primary identifier is numeric, so
// a wildcard term used to be turned away by the digits-only check; now that the
// search reaches the string TAG_NUMBER column, that accidental shield is gone.
//
// searchBc in the same file has always escaped these for its CQL filter. This
// brings the ArcGIS path in line.
describe('LIKE wildcards in a claim-number term', () => {
  it('escapes % so a wildcard term cannot become a full-layer scan', async () => {
    const res = await run({ q: '%%', type: 'number', province: 'mb' });
    expect(res.statusCode).toBe(200);
    const where = queryUrls[0];
    expect(where).toMatch(/\\%/);              // escaped, not live
    expect(where).toMatch(/ESCAPE '\\'/);      // and declared to the server
    // The give-away of the old behaviour: four unescaped %% in a row.
    expect(where).not.toMatch(/LIKE UPPER\('%%%%'\)/);
  });

  it('escapes the single-character wildcard too', async () => {
    const res = await run({ q: 'CB_2345', type: 'number', province: 'mb' });
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).toMatch(/CB\\_2345/);
    expect(queryUrls[0]).toMatch(/ESCAPE '\\'/);
  });

  it('escapes a backslash, so the escape character cannot itself be smuggled', async () => {
    const res = await run({ q: 'CB\\%45', type: 'number', province: 'mb' });
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).toMatch(/CB\\\\\\%45/);
  });

  it('leaves an ordinary term byte-identical, with no ESCAPE clause', async () => {
    // The portability guard. ESCAPE support varies across the provincial ArcGIS
    // servers and none are reachable from CI, so emitting it unconditionally
    // would risk turning every working search into a 400 to fix a case that
    // almost never happens. Only a term that needs escaping gets the clause.
    const res = await run({ q: 'CB12345', type: 'number', province: 'mb' });
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).not.toMatch(/ESCAPE/);
    expect(queryUrls[0]).toMatch(/UPPER\(TAG_NUMBER\) LIKE UPPER\('%CB12345%'\)/);
  });

  it('still doubles quotes — the original escaping is not lost', async () => {
    const res = await run({ q: "CB'12", type: 'number', province: 'mb' });
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).toMatch(/CB''12/);
  });
});

// The same defect lived on the company/holder path long before the number
// search reached a string column — any province whose holder field is a string
// (all of them) took a wildcard term straight into the pattern. Fixing only the
// clause this PR touched would have been arbitrary, so the shared helper covers
// every user-supplied LIKE in the file.
describe('LIKE wildcards in a company/holder term', () => {
  const ON_SERVICE = 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/MLAS/mlas_op/MapServer';

  async function runOn(q) {
    vi.resetModules();
    queryUrls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      const json = (body) => ({
        ok: true,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => body,
        text: async () => JSON.stringify(body),
      });
      if (u === `${ON_SERVICE}?f=json`) return json({ layers: [{ id: 1, name: 'Mining Claims' }] });
      if (/MapServer\/1\?f=json/.test(u)) {
        return json({
          name: 'Mining Claims',
          maxRecordCount: 1000,
          objectIdField: 'OBJECTID',
          advancedQueryCapabilities: { supportsPagination: true },
          fields: [
            { name: 'OBJECTID', type: 'esriFieldTypeOID' },
            { name: 'HOLDER', type: 'esriFieldTypeString' },
            { name: 'TENURE_NUMBER_ID', type: 'esriFieldTypeString' },
          ],
        });
      }
      if (/MapServer\/1\/query/.test(u)) {
        queryUrls.push(decodeURIComponent(u.replace(/\+/g, ' ')));
        return json({ type: 'FeatureCollection', features: [] });
      }
      throw new Error(`unexpected url ${u}`);
    }));
    const { default: handler } = await import('../api/claims.js');
    const res = mockRes();
    await handler(req({ q, type: 'company', province: 'on' }), res);
    return res;
  }

  it('escapes a wildcard holder term', async () => {
    const res = await runOn('%%');
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).toMatch(/\\%/);
    expect(queryUrls[0]).toMatch(/ESCAPE '\\'/);
    expect(queryUrls[0]).not.toMatch(/LIKE UPPER\('%%%%'\)/);
  });

  it('leaves a real company name untouched', async () => {
    const res = await runOn('Glencore');
    expect(res.statusCode).toBe(200);
    expect(queryUrls[0]).toMatch(/UPPER\(HOLDER\) LIKE UPPER\('%Glencore%'\)/);
    expect(queryUrls[0]).not.toMatch(/ESCAPE/);
  });
});
