import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateBbox, validateTerm, publicErrorMessage } from '../api/_lib/guard.js';

function mockRes() {
  return {
    headers: {}, statusCode: null, body: null, ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { this.ended = true; return this; },
  };
}
const req = (query = {}, method = 'GET', headers = {}) => ({
  method, query, headers, url: `/api/claims?${new URLSearchParams(query)}`,
});

let handler;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in tests'); }));
  ({ default: handler } = await import('../api/claims.js'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ADMIN_API_SECRET;
});

describe('validateBbox', () => {
  it('rejects malformed, out-of-range, mis-ordered, and oversized boxes', () => {
    expect(validateBbox('1,2,3').ok).toBe(false);
    expect(validateBbox('a,b,c,d').ok).toBe(false);
    expect(validateBbox('-190,49,-120,50').ok).toBe(false);      // lng out of range
    expect(validateBbox('-120,50,-123,49').ok).toBe(false);      // min >= max
    expect(validateBbox('-140,40,-60,60').ok).toBe(false);       // continent-sized
    expect(validateBbox('-123.5,49.0,-122.5,49.8').ok).toBe(true);
  });
});

describe('validateTerm', () => {
  it('enforces minimum and maximum lengths', () => {
    expect(validateTerm('a').ok).toBe(false);
    expect(validateTerm('x'.repeat(200)).ok).toBe(false);
    expect(validateTerm('  Goliath Resources  ')).toEqual({ ok: true, term: 'Goliath Resources' });
  });
});

describe('publicErrorMessage', () => {
  it('passes friendly messages, blocks raw upstream bodies in production', () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(publicErrorMessage(new Error('The provincial registry is temporarily unavailable. Please try again shortly.'), 'x'))
      .toMatch(/temporarily unavailable/);
    expect(publicErrorMessage(new Error('Upstream 500: <ows:ExceptionReport ... java.lang.NullPointerException at line...'), 'Generic fallback.'))
      .toBe('Generic fallback.');
    process.env.NODE_ENV = oldEnv;
  });
});

describe('api/claims request hardening', () => {
  it('rejects non-GET methods with 405 + Allow', async () => {
    const res = mockRes();
    await handler(req({ q: 'goldco' }, 'POST'), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toContain('GET');
  });

  it('answers OPTIONS with 204', async () => {
    const res = mockRes();
    await handler(req({}, 'OPTIONS'), res);
    expect(res.statusCode).toBe(204);
  });

  it('rejects oversized query strings with 414', async () => {
    const res = mockRes();
    await handler(req({ q: 'x'.repeat(5000) }), res);
    expect(res.statusCode).toBe(414);
  });

  it('rejects over-length search terms with 400', async () => {
    const res = mockRes();
    await handler(req({ q: 'y'.repeat(300), province: 'bc' }), res);
    expect([400, 414]).toContain(res.statusCode);
  });

  it('rejects continent-sized bboxes with 400', async () => {
    const res = mockRes();
    await handler(req({ bbox: '-140,40,-60,60', province: 'on' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
  });

  it('CORS is not wildcarded; allowed origins are reflected', async () => {
    const res = mockRes();
    await handler({ ...req({ q: 'ab', province: 'bc' }), headers: { origin: 'https://evil.example' } }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();

    const res2 = mockRes();
    await handler({ ...req({}, 'OPTIONS'), headers: { origin: 'https://www.explorationmaps.com' } }, res2);
    expect(res2.headers['Access-Control-Allow-Origin']).toBe('https://www.explorationmaps.com');
  });

  it('diagnostic modes are hidden in production without the admin secret', async () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = mockRes();
      await handler(req({ schema: 'raw', province: 'yt' }), res);
      expect(res.statusCode).toBe(404);

      process.env.ADMIN_API_SECRET = 'sekrit';
      const denied = mockRes();
      await handler(req({ schema: '1', province: 'yt' }), denied);
      expect(denied.statusCode).toBe(404);

      const allowed = mockRes();
      await handler({ ...req({ schema: 'raw', province: 'yt' }), headers: { 'x-admin-secret': 'sekrit' } }, allowed);
      expect(allowed.statusCode).toBe(200); // raw mode reports fetch attempts even when upstream is down
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
  });

  it('rate limits repeated requests from one IP', async () => {
    const codes = [];
    for (let i = 0; i < 70; i++) {
      const res = mockRes();
      await handler({ ...req({ q: 'ab', province: 'zz' }), headers: { 'x-forwarded-for': '9.9.9.9' } }, res);
      codes.push(res.statusCode);
    }
    expect(codes).toContain(429);
  });

  it('production error responses never contain upstream bodies', async () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false, status: 500,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => 'java.lang.NullPointerException: secret-internal-hostname:5432',
        json: async () => ({}),
      })));
      vi.resetModules();
      const { default: prodHandler } = await import('../api/claims.js');
      const res = mockRes();
      await prodHandler(req({ q: 'goldco', province: 'yt' }, 'GET', { 'x-forwarded-for': '8.8.4.4' }), res);
      expect(res.statusCode).toBe(502);
      expect(JSON.stringify(res.body)).not.toContain('NullPointerException');
      expect(JSON.stringify(res.body)).not.toContain('secret-internal-hostname');
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
  });
});
