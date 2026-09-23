import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { relaxationNotice } from '../src/utils/relaxationNotice.js';

// Ontario legacy claim numbers.
//
// Ontario converted every staked claim to grid cells in April 2018. The one
// failed Ontario session of 2026-09-22 searched 1198474 — a real claim, on
// MLAS's "Legacy Claim" layer — first as a company, then as a number, and got
// nothing both times: only the current Mining Claim layer was ever queried.

const square = (x, y, d) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });
const cell = (id, x, y) => ({ type: 'Feature', properties: { TENURE_NUMBER_ID: id, HOLDER: '(100) A HOLDER' }, geometry: square(x, y, 0.01) });

let queries;
beforeEach(() => {
  queries = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = decodeURIComponent(String(url).replace(/\+/g, ' '));
    const json = (body) => ({ ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => body, text: async () => JSON.stringify(body) });
    if (/MapServer\?f=json/.test(u)) return json({ layers: [{ id: 1, name: 'Mining Claim' }, { id: 8, name: 'Legacy Claim' }] });
    if (/MapServer\/1\?f=json/.test(u)) {
      return json({ name: 'Mining Claim', maxRecordCount: 1000, objectIdField: 'OBJECTID', advancedQueryCapabilities: { supportsPagination: true },
        fields: [{ name: 'OBJECTID', type: 'esriFieldTypeOID' }, { name: 'TENURE_NUMBER_ID', type: 'esriFieldTypeString' }, { name: 'HOLDER', type: 'esriFieldTypeString' }] });
    }
    if (/MapServer\/8\?f=json/.test(u)) return json({ name: 'Legacy Claim', maxRecordCount: 1000, objectIdField: 'OBJECTID', advancedQueryCapabilities: { supportsPagination: true }, fields: [] });
    if (/MapServer\/8\/query/.test(u)) {
      queries.push(u);
      return json({ type: 'FeatureCollection', features: /CLAIM_NUM = '1198474'/.test(u) ? [{ type: 'Feature', properties: { CLAIM_NUM: '1198474' }, geometry: square(-81.4, 46.2, 0.03) }] : [] });
    }
    if (/MapServer\/1\/query/.test(u)) {
      queries.push(u);
      // Spatial query: two cells inside the legacy outline, one neighbour whose
      // centre lies outside it (it only touches the edge).
      if (/esriGeometryPolygon/.test(u)) return json({ type: 'FeatureCollection', features: [cell('135568', -81.395, 46.205), cell('254819', -81.385, 46.205), cell('999999', -81.37, 46.205)] });
      return json({ type: 'FeatureCollection', features: [] });
    }
    throw new Error(`unexpected url ${u}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const res = () => ({ statusCode: null, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
async function search(q, type, ip) {
  vi.resetModules();
  const { default: handler } = await import('../api/claims.js');
  const r = res();
  await handler({ method: 'GET', headers: { 'x-forwarded-for': ip }, query: { province: 'on', q, type }, url: `/api/claims?q=${q}` }, r);
  return r;
}

describe('Ontario legacy claim numbers', () => {
  it('answers a pre-2018 claim number with the current claims on its ground', async () => {
    const r = await search('1198474', 'number', '10.1.0.1');
    expect(r.statusCode).toBe(200);
    expect(r.body.features.map((f) => f.properties.TAG_NUMBER || f.properties.TENURE_NUMBER_ID)).toEqual(['135568', '254819']);
    expect(r.body.meta.legacyClaim).toEqual({ number: '1198474', currentClaims: 2 });
  });

  it('treats a bare number typed into company search as a claim number', async () => {
    const r = await search('1198474', 'company', '10.1.0.2');
    expect(r.body.meta.legacyClaim?.number).toBe('1198474');
  });

  it('says the results are today\'s claims, not the number typed', () => {
    const n = relaxationNotice({ legacyClaim: { number: '1198474', currentClaims: 8 } }, { province: 'on' });
    expect(n.headline).toMatch(/1198474 is a legacy Ontario claim number/);
    expect(n.headline).toMatch(/8 current claims on its ground/);
    expect(relaxationNotice({ legacyClaim: { number: '1', currentClaims: 0 } }).headline).toMatch(/No current claim covers its ground/);
  });
});
