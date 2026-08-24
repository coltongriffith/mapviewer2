import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  numberSearchLadder, numericPrefixRanges, relaxationMeta, claimNameFallbacks,
  bcCqlFilter, runLadder, MIN_NUMBER_PREFIX_LENGTH, NEAR_MISS_LIMIT,
} from '../api/claims.js';
import { relaxationNotice } from '../src/utils/relaxationNotice.js';
import { readFileSync } from 'node:fs';

// A search that answers "0 results" and stops is the worst outcome this product
// has. Measured over 120 days of search_events before this change:
//
//   all searches            340    114 zero   33.5%
//   claim-number searches    10     10 zero  100.0%   (BC 3/3, QC 4/4, MB 3/3)
//   NL company               24     13 zero   54.2%
//   BC company              127     31 zero   24.4%
//
// Quebec's holder search already widened itself rather than giving up. Nothing
// else did: no other province relaxed a company name, and NO jurisdiction
// relaxed a claim number anywhere. These tests pin the ladder that now runs
// everywhere, and — just as important — pin the limits on how far it may go.

describe('numberSearchLadder', () => {
  it('tries the exact number first', () => {
    expect(numberSearchLadder('2654321')[0]).toMatchObject({ match: 'exact', term: '2654321' });
  });

  it('widens to starts-with before contains', () => {
    const kinds = numberSearchLadder('2654321').map((s) => s.match);
    expect(kinds.indexOf('prefix')).toBeLessThan(kinds.indexOf('contains'));
  });

  it('treats separators as spelling, not as a different number', () => {
    // "CB 12345" and "CB-12345" are the same tag; registries differ on whether
    // they store the separator.
    const terms = numberSearchLadder('CB 12345').map((s) => s.term);
    expect(terms).toContain('CB12345');
  });

  it('offers the bare digits of an alphanumeric tag, but marks them derived', () => {
    // The mark is what keeps "12345" away from a numeric column, where it would
    // match tenure 12345 — a different claim from tag CB12345.
    const digits = numberSearchLadder('CB12345').find((s) => s.term === '12345');
    expect(digits).toBeTruthy();
    expect(digits.derived).toBe(true);
  });

  it('never widens a term too short to narrow anything', () => {
    // "1" as a prefix matches every number in the registry.
    const short = numberSearchLadder('12');
    expect(short.every((s) => s.match === 'exact')).toBe(true);
    expect(MIN_NUMBER_PREFIX_LENGTH).toBe(3);
  });

  it('issues each distinct search once', () => {
    const seen = numberSearchLadder('123456').map((s) => `${s.match}:${s.term}`);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('numericPrefixRanges', () => {
  it('expresses starts-with as ranges a numeric column can take', () => {
    // The only way to reach TENURE_NUMBER_ID, which is numeric and is the
    // identifier every B.C. title carries — the string tag is null on 87%.
    expect(numericPrefixRanges('26543', 7)).toEqual([[265430, 265439], [2654300, 2654399]]);
  });

  it('refuses a leading zero rather than quietly answering a different question', () => {
    // A numeric column cannot hold "012345" distinctly from "12345".
    expect(numericPrefixRanges('012345')).toEqual([]);
  });

  it('refuses anything that is not digits', () => {
    expect(numericPrefixRanges('CB123')).toEqual([]);
  });
});

describe('relaxationMeta', () => {
  it('labels a same-text prefix widening, which is the commonest near miss', () => {
    // "26543" exact and "26543" as a prefix are different searches returning
    // different claims. Suppressing this as a no-op would ship the widened
    // result unlabelled — the one failure this feature must not have.
    expect(relaxationMeta({ kind: 'number', match: 'prefix', from: '26543', to: '26543' }))
      .toMatchObject({ relaxedKind: 'number', relaxedMatch: 'prefix' });
  });

  it('stays silent when the exact search answered', () => {
    expect(relaxationMeta({ kind: 'owner', match: 'tokens', from: 'Vior', to: 'Vior' })).toBeNull();
  });

  it('reports the cap when the near-miss list was trimmed', () => {
    const meta = relaxationMeta({ kind: 'number', match: 'prefix', from: '265', to: '265', limited: true });
    expect(meta.relaxedLimited).toBe(NEAR_MISS_LIMIT);
  });
});

describe('claimNameFallbacks', () => {
  it('searches the name as typed first', () => {
    expect(claimNameFallbacks('Gold Hill Company')[0]).toEqual([]);
  });

  it('falls back to the most distinctive word, never to reordered tokens', () => {
    // Tokenising a claim name would match "Hill of Gold" — different ground.
    const sets = claimNameFallbacks('Gold Hill Company');
    expect(sets).toHaveLength(2);
    expect(sets[1]).toEqual(['company']);
  });

  it('has nothing to widen for a single-word name', () => {
    expect(claimNameFallbacks('Rattler')).toEqual([[]]);
  });
});

describe('bcCqlFilter widening', () => {
  it('reaches both identifiers on a starts-with', () => {
    const where = bcCqlFilter('26543', 'number', { match: 'prefix' });
    expect(where).toMatch(/TAG_NUMBER LIKE '26543%'/);
    expect(where).toMatch(/TENURE_NUMBER_ID >= 265430 AND TENURE_NUMBER_ID <= 265439/);
  });

  it('keeps a derived term off the numeric column', () => {
    const where = bcCqlFilter('12345', 'number', { match: 'prefix', derived: true });
    expect(where).toMatch(/TAG_NUMBER/);
    expect(where).not.toMatch(/TENURE_NUMBER_ID/);
  });

  it('still escapes wildcards in a widened pattern', () => {
    expect(bcCqlFilter('10%45', 'number', { match: 'prefix' })).toMatch(/10\\%45%/);
  });

  it('accepts an already-relaxed token set for the holder search', () => {
    expect(bcCqlFilter('Osisko Development Corp', 'company', { tokens: ['osisko'] }))
      .toBe("OWNER_NAME ILIKE '%osisko%'");
  });

  it('is byte-identical to the old filter when nothing is passed', () => {
    // The exact rung must not move. Everything here is a fallback.
    expect(bcCqlFilter('1012345', 'number'))
      .toBe("(TENURE_NUMBER_ID = 1012345 OR TAG_NUMBER = '1012345')");
  });
});

describe('runLadder', () => {
  it('stops at the first rung that answers', async () => {
    const calls = [];
    const out = await runLadder([{ n: 1 }, { n: 2 }, { n: 3 }], async (s) => {
      calls.push(s.n);
      return { features: s.n === 2 ? [{ id: 'x' }] : [], meta: {} };
    });
    expect(calls).toEqual([1, 2]);
    expect(out.step).toEqual({ n: 2 });
  });

  it('costs exactly one request when the exact search works', async () => {
    const calls = [];
    await runLadder([{ n: 1 }, { n: 2 }], async (s) => {
      calls.push(s.n);
      return { features: [{ id: 'x' }], meta: {} };
    });
    expect(calls).toEqual([1]);
  });

  it('reports no step when nothing answered, so callers do not claim a match', async () => {
    const out = await runLadder([{ n: 1 }], async () => ({ features: [], meta: {} }));
    expect(out.step).toBeNull();
    expect(out.features).toEqual([]);
  });
});

// ── The sentence the user reads ────────────────────────────────────────────

describe('relaxationNotice', () => {
  it('says nothing when the exact search answered', () => {
    expect(relaxationNotice({}, { query: 'Teck' })).toBeNull();
  });

  it('never lets a number near-miss read as the claim that was asked for', () => {
    const n = relaxationNotice(
      { relaxedTo: '26543', relaxedFrom: '26543', relaxedKind: 'number', relaxedMatch: 'prefix' },
      { jurisdictionLabel: 'Quebec', count: 8 },
    );
    expect(n.headline).toMatch(/No claim numbered 26543 in Quebec/);
    expect(n.headline).toMatch(/8 claims with a number starting with 26543/);
    expect(n.detail).toMatch(/different claims from the one you typed/);
  });

  it('names the cap when the list was trimmed', () => {
    const n = relaxationNotice(
      { relaxedTo: '265', relaxedFrom: '265', relaxedKind: 'number', relaxedMatch: 'prefix', relaxedLimited: 50 },
      { jurisdictionLabel: 'British Columbia', count: 50 },
    );
    expect(n.detail).toMatch(/capped at 50/);
  });

  it('does not call a claim-name match an ownership finding', () => {
    const n = relaxationNotice(
      { relaxedFrom: 'Rattler Gold Extension', relaxedTo: 'extension', relaxedKind: 'name' },
      { jurisdictionLabel: 'Nevada' },
    );
    expect(n.detail).toMatch(/not a statement about who holds the ground/i);
  });

  it('keeps the French-vocabulary explanation for Quebec holders', () => {
    const n = relaxationNotice(
      { relaxedFrom: 'Vior Gold Corporation', relaxedTo: 'vior', relaxedKind: 'owner' },
      { jurisdictionLabel: 'Quebec', province: 'qc' },
    );
    expect(n.detail).toMatch(/Aurif/);
  });

  it('explains a widened holder search everywhere else too', () => {
    // The relaxation was never Quebec-specific; only the code was.
    const n = relaxationNotice(
      { relaxedFrom: 'Osisko Development Corporation', relaxedTo: 'osisko', relaxedKind: 'owner' },
      { jurisdictionLabel: 'Ontario', province: 'on' },
    );
    expect(n.headline).toMatch(/No exact match for "Osisko Development Corporation" in Ontario/);
    expect(n.detail).toMatch(/subsidiary/);
    expect(n.detail).not.toMatch(/Quebec/);
  });
});

// ── End to end, through the real handler ───────────────────────────────────

// Manitoba (layer 3) for numbers — numeric TENURE_NUMBER_ID beside a string
// TAG_NUMBER is the shape that makes the numeric-range rung matter.
// Saskatchewan (layer 0) for holders — it publishes a string OWNERS column.
// Both are configured with an explicit layerId, so no service catalogue is
// fetched and the mock stays a layer-metadata call plus queries.
const MB_FIELDS = [
  { name: 'OBJECTID', type: 'esriFieldTypeOID' },
  { name: 'TENURE_NUMBER_ID', type: 'esriFieldTypeInteger' },
  { name: 'TAG_NUMBER', type: 'esriFieldTypeString' },
];
const SK_FIELDS = [
  { name: 'OBJECTID', type: 'esriFieldTypeOID' },
  { name: 'OWNERS', type: 'esriFieldTypeString' },
  { name: 'DISPOSIT_1', type: 'esriFieldTypeString' },
];

let queryUrls;
// answers: a function (whereClause) => features
function installMock(answers, fields) {
  queryUrls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = decodeURIComponent(String(url).replace(/\+/g, ' '));
    const json = (body) => ({
      ok: true, headers: new Map([['content-type', 'application/json']]),
      json: async () => body, text: async () => JSON.stringify(body),
    });
    if (/MapServer\/\d+\?f=json/.test(u)) {
      return json({
        name: 'Mining Claim', maxRecordCount: 1000, objectIdField: 'OBJECTID',
        advancedQueryCapabilities: { supportsPagination: true }, fields,
      });
    }
    if (/MapServer\/\d+\/query/.test(u)) {
      queryUrls.push(u);
      const where = /where=([^&]*)/.exec(u)?.[1] || '';
      return json({ type: 'FeatureCollection', features: answers(where) });
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
  method: 'GET', query,
  url: `/api/claims?${new URLSearchParams(query)}`,
  headers: { 'x-forwarded-for': `10.77.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}` },
});

async function run(query, answers, fields = MB_FIELDS) {
  vi.resetModules();
  installMock(answers, fields);
  const { default: handler } = await import('../api/claims.js');
  const res = mockRes();
  await handler(req(query), res);
  return res;
}

beforeEach(() => { ipN += 1; });
afterEach(() => vi.unstubAllGlobals());

const feature = (id) => ({ type: 'Feature', properties: { TENURE_NUMBER_ID: id }, geometry: null });

describe('a provincial claim-number search that used to dead-end', () => {
  it('finds the claims whose number starts with a partial one', async () => {
    // Every claim-number search on record returned nothing. A 5-digit prefix of
    // a 7-digit number is the shape people arrive with.
    const res = await run({ q: '26543', type: 'number', province: 'mb' }, (where) => (
      /26543[0-9]/.test(where) || /26543%/.test(where) ? [feature(2654301)] : []
    ));
    expect(res.statusCode).toBe(200);
    expect(res.body.features.length).toBeGreaterThan(0);
  });

  it('says so, rather than presenting near misses as the claim asked for', async () => {
    const res = await run({ q: '26543', type: 'number', province: 'mb' }, (where) => (
      / >= 265430 /.test(where) ? [feature(2654301)] : []
    ));
    expect(res.body.meta.relaxedKind).toBe('number');
    expect(res.body.meta.relaxedMatch).toBe('prefix');
    expect(res.body.meta.relaxedFrom).toBe('26543');
  });

  it('caps the near-miss list so a short prefix cannot page a province back', async () => {
    const many = Array.from({ length: 400 }, (_, i) => feature(2650000 + i));
    // Only the numeric-range rung answers: the string column's contains match
    // is rung 1 and is not a widening on this layer.
    const res = await run({ q: '265', type: 'number', province: 'mb' }, (where) => (
      />= 2650/.test(where) ? many : []
    ));
    expect(res.body.features).toHaveLength(NEAR_MISS_LIMIT);
    expect(res.body.meta.relaxedLimited).toBe(NEAR_MISS_LIMIT);
  });

  it('never repeats a search the layer has already answered', async () => {
    // A string identifier column takes a CONTAINS match on the first rung, so a
    // later contains rung against that same column would re-issue a query that
    // just returned nothing. Every rung has to be able to add something.
    await run({ q: '26543', type: 'number', province: 'mb' }, () => []);
    const wheres = queryUrls.map((u) => /where=([^&]*)/.exec(u)?.[1] || '');
    expect(new Set(wheres).size).toBe(wheres.length);
    expect(wheres.length).toBeLessThanOrEqual(3);
  });

  it('asks the registry for the cap, not for the province', async () => {
    // Bounded at fetch time: a short prefix must not page thousands of claims
    // back so that 50 can be kept.
    await run({ q: '265', type: 'number', province: 'mb' }, (where) => (
      />= 2650/.test(where) ? Array.from({ length: 50 }, (_, i) => feature(2650000 + i)) : []
    ));
    const widened = queryUrls.find((u) => />= 2650/.test(u));
    expect(widened).toMatch(new RegExp(`resultRecordCount=${NEAR_MISS_LIMIT}`));
  });

  it('does not tell the user to narrow a search that had to be widened', async () => {
    // The "large result set — narrow the search" banner is gated off when the
    // near-miss cap is what trimmed the list. Advising a narrower search after
    // widening one to answer at all points the wrong way.
    const ui = readFileSync('src/components/RegistrySearch.jsx', 'utf8');
    expect(ui).toMatch(/meta\?\.truncated\s*&&\s*!results\?\.meta\?\.relaxedLimited/);
  });

  it('leaves an exact hit exactly as it was — one request, no banner', async () => {
    const res = await run({ q: '1044501', type: 'number', province: 'mb' }, () => [feature(1044501)]);
    expect(queryUrls).toHaveLength(1);
    expect(res.body.meta.relaxedKind).toBeUndefined();
  });

  it('still returns an honest empty set when nobody staked that number', async () => {
    // Widening is not inventing. A number nobody staked, with no near misses,
    // is still zero results and still a 200.
    const res = await run({ q: '9999999', type: 'number', province: 'mb' }, () => []);
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toEqual([]);
    expect(res.body.meta.relaxedKind).toBeUndefined();
  });
});

describe('a provincial company search that used to dead-end', () => {
  it('drops the industry words when the full legal name finds nothing', async () => {
    // The Quebec ladder, now running in every province. 24% of B.C. company
    // searches and 54% of Newfoundland's returned nothing.
    const res = await run(
      { q: 'Osisko Development Corporation', type: 'company', province: 'sk' },
      (where) => (/%osisko%/i.test(where) && !/development/i.test(where) ? [feature(1)] : []),
      SK_FIELDS,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.features.length).toBeGreaterThan(0);
    expect(res.body.meta.relaxedKind).toBe('owner');
    // Reported back in the spelling the user typed, not the folded form used
    // to decide which words to drop — the banner quotes this at them.
    expect(res.body.meta.relaxedTo).toBe('Osisko');
  });

  it('prefers the exact holder match when there is one', async () => {
    const res = await run(
      { q: 'Eagle Plains Resources', type: 'company', province: 'sk' },
      () => [feature(1)],
      SK_FIELDS,
    );
    expect(queryUrls).toHaveLength(1);
    expect(res.body.meta.relaxedKind).toBeUndefined();
  });
});

// ── Quebec, whose store is ours and whose numbers we can count exactly ─────
//
// Measured against the live qc_claims table (258,608 rows) while writing this:
//
//   tag_number ilike '26543'      0 rows   ← what the user got: a blank page
//   tag_number ilike '26543%'    12 rows   ← what they were looking for
//   tag_number ilike '%26543%'   15 rows
//
// 250,636 of those tag numbers are seven digits, so a five-digit prefix off a
// claim schedule is the everyday case, not an edge one. The mock below answers
// with those counts.
describe('the Quebec store, whose exact numbers we measured', () => {
  const QC_ROWS = { exact: 0, prefix: 12, contains: 15 };

  function installQcMock() {
    queryUrls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = decodeURIComponent(String(url));
      queryUrls.push(u);
      const filter = /tag_number=ilike\.([^&]*)/.exec(u)?.[1] ?? '';
      let n = QC_ROWS.exact;
      if (/^\*.*\*$/.test(filter)) n = QC_ROWS.contains;
      else if (/\*$/.test(filter)) n = QC_ROWS.prefix;
      const rows = Array.from({ length: n }, (_, i) => ({
        tag_number: `26543${String(i).padStart(2, '0')}`,
        owner_name: 'HOLDER INC', status: 'Actif', good_to_date: null,
        area_hectares: 52.1, title_type: 'CDC', geometry: null,
      }));
      return {
        ok: true, headers: new Map([['content-type', 'application/json']]),
        json: async () => rows, text: async () => JSON.stringify(rows),
      };
    }));
  }

  async function runQc(query) {
    vi.resetModules();
    installQcMock();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
    const { default: handler } = await import('../api/claims.js');
    const res = mockRes();
    await handler(req(query), res);
    return res;
  }

  it('answers a partial claim number with the twelve claims that start with it', async () => {
    const res = await runQc({ q: '26543', type: 'number', province: 'qc' });
    expect(res.statusCode).toBe(200);
    expect(res.body.features).toHaveLength(12);
    expect(res.body.meta.relaxedKind).toBe('number');
    expect(res.body.meta.relaxedMatch).toBe('prefix');
  });

  it('tries the exact number first and only widens after it misses', async () => {
    await runQc({ q: '26543', type: 'number', province: 'qc' });
    expect(queryUrls[0]).toMatch(/tag_number=ilike\.26543(&|$)/);
    expect(queryUrls[1]).toMatch(/tag_number=ilike\.26543\*/);
  });
});
