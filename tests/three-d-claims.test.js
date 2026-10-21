import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchClaims, claimsInBbox, bboxAround, toClaims, mergeClaims, splitClaims, ownersOf, claimContains, claimsCredit, registryOf } from '../shared/claimSearch.js';
import { claimFrame } from '../src/three-d/tags.js';
import { asGeoJSON } from '../src/three-d/claims.js';

const sq = (x, y, d = 0.01) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });
const bc = (n, owner, x, y, extra = {}) => ({ type: 'Feature', properties: { TENURE_NUMBER_ID: n, CLAIM_NAME: `C${n}`, OWNER_NAME: owner, TITLE_TYPE_DESCRIPTION: 'Mineral', GOOD_TO_DATE: '2028-01-01', AREA_IN_HECTARES: '20.51', ...extra }, geometry: sq(x, y) });
const ok = (data) => ({ ok: true, json: () => Promise.resolve(data) });

let fetchMock;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('claim registry requests (the 2D app\'s, through the same proxies)', () => {
  it('searches one jurisdiction by holder, number or name', async () => {
    fetchMock.mockResolvedValue(ok({ type: 'FeatureCollection', features: [bc(1, 'A', 0, 0)] }));
    const data = await searchClaims('  Example Resources ', 'company', 'on');
    expect(fetchMock).toHaveBeenCalledWith('/api/claims?q=Example+Resources&type=company&province=on', undefined);
    expect(data.features).toHaveLength(1);
    const ac = new AbortController(); await searchClaims('1012345', 'number', 'bc', ac.signal);
    expect(fetchMock.mock.calls[1]).toEqual(['/api/claims?q=1012345&type=number&province=bc', { signal: ac.signal }]);
  });
  it('reports the registry\'s error the way the 2D search does', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: () => Promise.resolve({ error: 'Upstream', detail: 'timed out' }) });
    await expect(searchClaims('x', 'company', 'bc')).rejects.toThrow('Upstream: timed out');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.reject(new Error('not json')) });
    await expect(searchClaims('x', 'company', 'bc')).rejects.toThrow('Request failed (500)');
    fetchMock.mockResolvedValueOnce(ok({ nope: 1 }));
    await expect(searchClaims('x', 'company', 'bc')).rejects.toThrow('Unexpected response format from registry');
  });
  it('asks BC\'s proxy for a bbox in BC, the multi-province proxy elsewhere', async () => {
    fetchMock.mockResolvedValue(ok({ type: 'FeatureCollection', features: [] }));
    await claimsInBbox([-130.6, 57.9, -130.5, 58], 'bc');
    await claimsInBbox('-80,48,-79,49', 'on');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/bc-claims?bbox=-130.6%2C57.9%2C-130.5%2C58');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/claims?bbox=-80%2C48%2C-79%2C49&province=on');
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({ error: 'rate limited' }) });
    await expect(claimsInBbox([0, 0, 1, 1], 'bc')).rejects.toThrow('rate limited');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.reject(new Error('html')) });
    await expect(claimsInBbox([0, 0, 1, 1], 'sk')).rejects.toThrow('Request failed: 503');
  });
});

describe('claims as figure data', () => {
  it('reads any registry\'s fields into number, title, owner, status; polygons only, no duplicates', () => {
    const fc = toClaims({ features: [
      bc(1012345, 'Example Resources Ltd.', 0, 0),
      bc(1012345, 'Example Resources Ltd.', 0, 0), // the same tenure twice (paged results)
      { type: 'Feature', properties: { TAG_NUMBER: 'YA1', HOLDER: 'Yukon Co', STATUS: 'Active' }, geometry: { type: 'MultiPolygon', coordinates: [sq(1, 1).coordinates] } },
      { type: 'Feature', properties: { TENURE_NUMBER_ID: 9 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: {}, geometry: null },
    ] });
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.map((f) => f.properties)).toEqual([
      { number: '1012345', title: 'C1012345', owner: 'Example Resources Ltd.', type: 'Mineral', good_to: '2028-01-01', area_ha: 20.51 },
      { number: 'YA1', owner: 'Yukon Co', status: 'Active' },
    ]);
    expect(fc.features[1].geometry.type).toBe('MultiPolygon');
    expect(mergeClaims({ features: [bc(1, 'A', 0, 0)] }, { features: [bc(1, 'A', 0, 0), bc(2, 'B', 0, 0)] }).features).toHaveLength(2);
  });
  it('splits the project\'s claims (holder, loosely, or numbers) from the neighbours, and counts holders', () => {
    const fc = toClaims({ features: [bc(1, 'Example Resources Ltd.', 0, 0), bc(2, 'EXAMPLE RESOURCES LTD', 1, 0), bc(3, 'Ridge Metals Corp.', 2, 0), bc(4, 'Ridge Metals Corp.', 3, 0), bc(5, 'Northern Inc.', 4, 0)] });
    const byOwner = splitClaims(fc, { owner: 'example resources' });
    expect(byOwner.project.features.map((f) => f.properties.number)).toEqual(['1', '2']);
    expect(byOwner.neighbours.features.map((f) => f.properties.number)).toEqual(['3', '4', '5']);
    expect(splitClaims(fc, { numbers: ['5', ' 3 '] }).project.features.map((f) => f.properties.number)).toEqual(['3', '5']);
    expect(splitClaims(fc, {}).project.features).toHaveLength(0);
    expect(ownersOf(fc)).toEqual([{ owner: 'Ridge Metals Corp.', count: 2 }, { owner: 'EXAMPLE RESOURCES LTD', count: 1 }, { owner: 'Example Resources Ltd.', count: 1 }, { owner: 'Northern Inc.', count: 1 }]);
  });
  it('finds the claim under a point (outer ring less its holes)', () => {
    const holed = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] } };
    expect(claimContains(holed, [3, 3])).toBe(true);
    expect(claimContains(holed, [1.5, 1.5])).toBe(false);
    expect(claimContains(holed, [5, 1])).toBe(false);
  });
  it('a box round the model, and the source credit', () => {
    expect(bboxAround([[-130.5, 57.9], [-130.48, 57.9], [-130.48, 57.91], [-130.5, 57.91]])).toEqual([-130.51, 57.89, -130.47, 57.92]);
    expect(bboxAround([[-130.5, 57.9], [-130.3, 58.1]], 0.5)).toEqual([-130.6, 57.8, -130.2, 58.2]);
    expect(claimsCredit('bc', new Date('2026-10-21T15:00:00Z'))).toBe('Claims: BC Mineral Titles Online, retrieved 2026-10-21');
    expect(registryOf('us-nv')).toBe('BLM MLRS');
    expect(registryOf('on')).toBe('Ontario MLAS');
  });
});

describe('claims already on the figure', () => {
  it('a multi-part claim split by overlays.js comes back whole, and survives the merge with fresh results', () => {
    const ring = (x) => [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]];
    const o = { data: { features: [{ g: 'A', c: ring(0), p: { number: '7', owner: 'A' } }, { g: 'A', c: ring(5), p: { number: '7', owner: 'A' } }, { g: 'A', c: ring(9), p: { number: '8' } }, { g: 'L', c: [[0, 0], [1, 1]], p: {} }] } };
    const fc = asGeoJSON(o);
    expect(fc.features.map((f) => [f.properties.number, f.geometry.type, f.geometry.coordinates.length])).toEqual([['7', 'MultiPolygon', 2], ['8', 'MultiPolygon', 1]]);
    const merged = mergeClaims({ features: [] }, fc);
    expect(merged.features.find((f) => f.properties.number === '7').geometry.coordinates).toEqual([ring(0), ring(5)]); // both parts kept
    // Fresh registry geometry of the same number wins over what the figure had.
    const fresh = { type: 'Feature', properties: { TENURE_NUMBER_ID: 7 }, geometry: { type: 'Polygon', coordinates: ring(20) } };
    expect(mergeClaims({ features: [fresh] }, fc).features[0].geometry).toEqual(fresh.geometry);
  });
});

describe('the claim map inset\'s frame', () => {
  const block = [1000, 2000, 2000, 2600]; // 1 km by 600 m
  it('fits the block and the project\'s claims, square, with a margin', () => {
    const f = claimFrame(block, [[800, 1800, 2400, 2800]]);
    expect(f.cx).toBe(1600); expect(f.cy).toBe(2300);
    expect(f.half).toBeCloseTo(800 * 1.16, 6); // the wider side, 1.6 km, plus 8% each side
  });
  it('takes in the neighbours, but no further than twice the project\'s extent', () => {
    const near = claimFrame(block, [[800, 1800, 2400, 2800]], [[2400, 1800, 3000, 2800]]);
    expect(near.cx).toBe(1900); expect(near.half).toBeCloseTo(1100 * 1.16, 6);
    const far = claimFrame(block, [[800, 1800, 2400, 2800]], [[-50000, -50000, 50000, 50000]]);
    expect(far.cx).toBe(1600); expect(far.cy).toBe(2300); expect(far.half).toBeCloseTo(1600 * 1.16, 6);
  });
  it('a block alone, or a tiny one, still gets a readable frame', () => {
    expect(claimFrame(block).half).toBeCloseTo(500 * 1.16, 6);
    expect(claimFrame([0, 0, 10, 10]).half).toBe(250);
  });
});
