import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bcCqlFilter } from '../api/claims.js';
import { emptyResultMessage, looksLikeMapSheet } from '../src/utils/scopingNotice.js';
import { readFileSync } from 'node:fs';

// BC map-sheet search was offered for the whole life of the product and could
// never work. MTA_ACQUIRED_TENURE_SVW publishes no map sheet column — the
// --discover run of 2026-08-05 recorded all 34 of its fields (schema
// fingerprint 93a271e8) and none is one — but the filter named MAP_UNIT_NO
// anyway, so the WFS rejected every request.
//
// It was used exactly once in production, on 2026-08-19, by a mobile visitor in
// Terrace BC who arrived from Google, clicked "Search BC Claims", and typed a
// 7-character query. Terrace sits on NTS sheet 103I. They got a 502 reading
// "Failed to reach the provincial registry" — our field name, blamed on the
// government — and left. There is no successful map-mode search on record.
//
// So these tests cover the whole path, not the filter string: the mode must be
// gone from the UI, refused by the API, absent from the filter builder, and a
// sheet number typed anyway must get an explanation rather than silence.

describe('map sheet search is not offered', () => {
  it('is not a BC search mode', () => {
    const ui = readFileSync('src/components/RegistrySearch.jsx', 'utf8');
    expect(ui).not.toMatch(/modes:\s*\['company',\s*'number',\s*'map'\]/);
  });

  it('does not auto-route a sheet-shaped query into a mode that cannot run', () => {
    // The rule read /^\d{3}[A-Za-z]/ -> 'map', so a user never had to choose
    // the broken mode; typing their own sheet number was enough.
    const ui = readFileSync('src/components/RegistrySearch.jsx', 'utf8');
    expect(ui).not.toMatch(/allowedModes\.includes\('map'\)/);
  });

  it('never builds a filter on the absent column', () => {
    ['082F', '082F056', '103I 09', '093K'].forEach((t) => {
      expect(bcCqlFilter(t, 'map')).not.toMatch(/MAP_UNIT_NO/);
    });
  });
});

describe('a map sheet typed into search', () => {
  it('recognises the NTS forms people actually type', () => {
    ['093K', '082F056', '103I 09', '104b', '103I09'].forEach((q) => {
      expect(looksLikeMapSheet(q), q).toBe(true);
    });
  });

  it('does not mistake a company or claim number for a sheet', () => {
    ['Teck Resources', '1012345', 'Vior', 'MC00001234', '', null].forEach((q) => {
      expect(looksLikeMapSheet(q), String(q)).toBe(false);
    });
  });

  const msg = (query) => emptyResultMessage({
    query, jurisdictionLabel: 'British Columbia', isUs: false, mode: 'company', province: 'bc',
  });

  it('explains why, instead of reporting nothing found', () => {
    // "No active claims found for 103I 09" is false in the way that matters:
    // the sheet is not empty, it is unsearchable.
    const m = msg('103I 09');
    expect(m.headline).toMatch(/not available/i);
    expect(m.headline).not.toMatch(/no active claims found/i);
  });

  it('refuses to imply the sheet holds nothing', () => {
    expect(msg('103I 09').detail).toMatch(/not a statement that the sheet holds no claims/i);
  });

  it('points at something that does work', () => {
    expect(msg('082F056').hint).toMatch(/company name|claim number|overlay/i);
  });

  it('leaves an ordinary company search on its own guidance', () => {
    expect(msg('Teck Resources').headline).toMatch(/no active claims found/i);
  });
});

describe('the API refuses the mode rather than failing upstream', () => {
  const makeRes = () => ({
    headers: {}, statusCode: null, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  });

  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('answers 400 without calling the registry', async () => {
    // The old behaviour reached the WFS, was rejected, and surfaced as a 502
    // blaming the province. A request we know cannot succeed must not be sent.
    const fetchMock = vi.fn(async () => { throw new Error('must not query'); });
    vi.stubGlobal('fetch', fetchMock);
    const { default: handler } = await import('../api/claims.js');
    const res = makeRes();
    await handler(
      { method: 'GET', query: { q: '103I 09', type: 'map', province: 'bc' }, headers: {} },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says what to do instead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('must not query'); }));
    const { default: handler } = await import('../api/claims.js');
    const res = makeRes();
    await handler(
      { method: 'GET', query: { q: '103I 09', type: 'map', province: 'bc' }, headers: {} },
      res,
    );
    expect(`${res.body.error} ${res.body.detail}`).toMatch(/claim number|company/i);
    // Not a 5xx, and not phrased as an upstream failure.
    expect(`${res.body.error} ${res.body.detail}`).not.toMatch(/failed to reach/i);
  });
});
