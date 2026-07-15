import { describe, it, expect } from 'vitest';
import handler from '../api/geo.js';

function mockRes() {
  const res = {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return res;
}

describe('api/geo', () => {
  it('rejects non-GET methods', () => {
    const res = mockRes();
    res.end = function () { this.ended = true; return this; };
    handler({ method: 'POST', headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('echoes Vercel geolocation headers as numbers/strings', () => {
    const res = mockRes();
    handler({ method: 'GET', headers: {
      'x-vercel-ip-latitude': '49.28',
      'x-vercel-ip-longitude': '-123.12',
      'x-vercel-ip-city': 'Vancouver',
      'x-vercel-ip-country-region': 'BC',
      'x-vercel-ip-country': 'CA',
    } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ lat: 49.28, lng: -123.12, city: 'Vancouver', region: 'BC', country: 'CA' });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('returns nulls for missing or malformed headers', () => {
    const res = mockRes();
    handler({ method: 'GET', headers: { 'x-vercel-ip-latitude': 'not-a-number' } }, res);
    expect(res.body).toEqual({ lat: null, lng: null, city: null, region: null, country: null });
  });
});
