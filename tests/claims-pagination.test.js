import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAllPages, fetchWfsAll, featureKey, MAX_TOTAL_FEATURES } from '../api/_lib/paging.js';

const feat = (id) => ({ type: 'Feature', properties: { OBJECTID: id }, geometry: null });
const range = (a, b) => Array.from({ length: b - a }, (_, i) => feat(a + i));

describe('fetchAllPages (ArcGIS-style offset pagination)', () => {
  it('fetches more than 500 results across multiple pages with accurate metadata', async () => {
    // 1200 records served in pages of 500.
    const fetchPage = vi.fn(async (offset, count) => ({ features: range(offset, Math.min(offset + count, 1200)) }));
    const { features, meta } = await fetchAllPages({ fetchPage, pageSize: 500, provider: 'arcgis' });
    expect(features).toHaveLength(1200);
    expect(meta).toEqual({ totalKnown: 1200, returned: 1200, truncated: false, pagesFetched: 3, provider: 'arcgis' });
  });

  it('deduplicates records that repeat across pages', async () => {
    // Page overlap: server re-serves ids 450-499 on page 2.
    const pages = [range(0, 500), [...range(450, 500), ...range(500, 900)]];
    const fetchPage = vi.fn(async () => ({ features: pages.shift() || [] }));
    const { features, meta } = await fetchAllPages({ fetchPage, pageSize: 500, provider: 'arcgis' });
    expect(features).toHaveLength(900);
    const ids = new Set(features.map((f) => f.properties.OBJECTID));
    expect(ids.size).toBe(900);
    expect(meta.truncated).toBe(false);
  });

  it('a provider timeout on a later page keeps partial results and marks truncated', async () => {
    let call = 0;
    const fetchPage = vi.fn(async (offset, count) => {
      call += 1;
      if (call === 3) throw new Error('upstream timeout');
      return { features: range(offset, offset + count) };
    });
    const { features, meta } = await fetchAllPages({ fetchPage, pageSize: 500, provider: 'arcgis' });
    expect(features).toHaveLength(1000);
    expect(meta.truncated).toBe(true);
    expect(meta.pagesFetched).toBe(2);
  });

  it('a FIRST-page failure throws (no silent empty result)', async () => {
    const fetchPage = vi.fn(async () => { throw new Error('service down'); });
    await expect(fetchAllPages({ fetchPage, pageSize: 500, provider: 'arcgis' })).rejects.toThrow('service down');
  });

  it('enforces the hard safety ceiling and reports truncation', async () => {
    const fetchPage = vi.fn(async (offset, count) => ({ features: range(offset, offset + count) })); // infinite supply
    const { features, meta } = await fetchAllPages({ fetchPage, pageSize: 1000, provider: 'arcgis' });
    expect(features).toHaveLength(MAX_TOTAL_FEATURES);
    expect(meta.truncated).toBe(true);
  });

  it('a server that ignores offsets (same page repeatedly) stops after one page', async () => {
    const fetchPage = vi.fn(async () => ({ features: range(0, 500) }));
    const { features, meta } = await fetchAllPages({ fetchPage, pageSize: 500, provider: 'arcgis' });
    expect(features).toHaveLength(500);
    expect(meta.truncated).toBe(true); // full page + no progress = can't prove completeness
    expect(fetchPage.mock.calls.length).toBe(2);
  });

  it('does NOT warn when the first page simply contains exactly one short page of records', async () => {
    const fetchPage = vi.fn(async (offset) => ({ features: offset === 0 ? range(0, 320) : [] }));
    const { meta } = await fetchAllPages({ fetchPage, pageSize: 500, provider: 'arcgis' });
    expect(meta.truncated).toBe(false);
    expect(meta.totalKnown).toBe(320);
  });
});

describe('fetchWfsAll (WFS startIndex/count pagination)', () => {
  it('walks multiple WFS pages using totalFeatures and reports completeness', async () => {
    const TOTAL = 2350;
    const fetchJson = vi.fn(async (url) => {
      const start = Number(new URL('http://x/' + url.slice(url.indexOf('?'))).searchParams.get('startIndex')) || Number(url.match(/startIndex=(\d+)/)?.[1]) || 0;
      const count = Number(url.match(/count=(\d+)/)?.[1]) || 1000;
      return {
        type: 'FeatureCollection',
        totalFeatures: TOTAL,
        features: range(start, Math.min(start + count, TOTAL)),
      };
    });
    const buildUrl = (startIndex, count) => `https://wfs.example?count=${count}&startIndex=${startIndex}`;
    const { features, meta } = await fetchWfsAll({ fetchJson, buildUrl, pageSize: 1000, provider: 'bc-wfs' });
    expect(features).toHaveLength(TOTAL);
    expect(meta.totalKnown).toBe(TOTAL);
    expect(meta.truncated).toBe(false);
    expect(meta.pagesFetched).toBe(3);
  });

  it('reports truncated when totalFeatures exceeds what could be fetched', async () => {
    const fetchJson = vi.fn(async (url) => {
      const start = Number(url.match(/startIndex=(\d+)/)?.[1]) || 0;
      if (start > 0) throw new Error('gateway 502'); // later pages fail
      return { type: 'FeatureCollection', totalFeatures: 5000, features: range(0, 1000) };
    });
    const buildUrl = (startIndex, count) => `https://wfs.example?count=${count}&startIndex=${startIndex}`;
    const { features, meta } = await fetchWfsAll({ fetchJson, buildUrl, pageSize: 1000, provider: 'bc-wfs' });
    expect(features).toHaveLength(1000);
    expect(meta.totalKnown).toBe(5000);
    expect(meta.truncated).toBe(true);
  });
});

describe('featureKey', () => {
  it('prefers feature id, then object id, then tag number', () => {
    expect(featureKey({ id: 'ABC.1' })).toBe('id:ABC.1');
    expect(featureKey({ properties: { OBJECTID: 7 } })).toBe('OBJECTID:7');
    expect(featureKey({ properties: { TAG_NUMBER: 'T-9' } })).toBe('TAG_NUMBER:T-9');
  });
});

// End-to-end through the real /api/claims handler with a mocked global fetch:
// an ArcGIS province whose layer supports pagination and holds >500 records.
describe('api/claims handler pagination integration', () => {
  beforeEach(() => { vi.resetModules(); });

  it('returns all 1200 Yukon records plus meta through the handler', async () => {
    const TOTAL = 1200;
    const fetchMock = vi.fn(async (url) => {
      const u = String(url);
      const json = (body) => ({ ok: true, headers: new Map([['content-type', 'application/json']]), json: async () => body, text: async () => JSON.stringify(body) });
      if (u.includes('GY_Mining/MapServer?f=json')) {
        return json({ layers: [{ id: 5, name: 'Quartz Claims' }] });
      }
      if (u.includes('/MapServer/5?f=json')) {
        return json({
          maxRecordCount: 500,
          objectIdField: 'OBJECTID',
          advancedQueryCapabilities: { supportsPagination: true },
          fields: [
            { name: 'OBJECTID', type: 'esriFieldTypeOID' },
            { name: 'OWNER', type: 'esriFieldTypeString' },
            { name: 'GRANT_NUMBER', type: 'esriFieldTypeString' },
          ],
        });
      }
      if (u.includes('/MapServer/5/query')) {
        const offset = Number(u.match(/resultOffset=(\d+)/)?.[1]) || 0;
        const count = Number(u.match(/resultRecordCount=(\d+)/)?.[1]) || 500;
        return json({
          type: 'FeatureCollection',
          features: range(offset, Math.min(offset + count, TOTAL)).map((f) => ({
            ...f,
            properties: { ...f.properties, OWNER: 'Klondike Gold Corp.' },
          })),
        });
      }
      throw new Error(`unexpected url ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { default: handler } = await import('../api/claims.js');

    const res = {
      headers: {}, statusCode: null, body: null,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
      end() { return this; },
    };
    await handler({ method: 'GET', query: { q: 'klondike', type: 'company', province: 'yt' }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.features).toHaveLength(TOTAL);
    expect(res.body.meta.truncated).toBe(false);
    expect(res.body.meta.provider).toBe('arcgis');
    expect(res.body.meta.pagesFetched).toBeGreaterThanOrEqual(3);
    // Normalization still applied on top of pagination
    expect(res.body.features[0].properties.OWNER_NAME).toBe('Klondike Gold Corp.');
  });
});
