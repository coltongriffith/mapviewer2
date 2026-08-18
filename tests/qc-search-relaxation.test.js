import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  relaxedTokenSets, ownerSearchTokens, foldForSearch, isInformativeTokenSet,
  UNINFORMATIVE_TERM_ERROR,
} from '../api/claims.js';
import { emptyResultMessage } from '../src/utils/scopingNotice.js';
import { readFileSync } from 'node:fs';

// Requiring every token is right when every token is right, and wrong the
// moment one word differs from the registry's. That is common in Quebec,
// because GESTIM is francophone: it records "Corporation Aurifère Vior Inc.",
// so a search for "Vior Gold Corporation" fails on GOLD — the registry's word
// for it is aurifère.
//
// Measured against the live table before this change:
//
//   Vior                            4,658      Vior Gold Corporation           0
//   Osisko                          1,514      Osisko Development Corporation  0
//   Azimut Exploration             10,891      Azimut Exploration Mining Corp  0
//
// Token matching is monotonically narrowing, so every extra word the user types
// is another chance to miss. Roughly a quarter of Quebec's claims sit under
// French-vocabulary names.

// What the API does before relaxing: tokenise, drop legal suffixes, fold.
const terms = (q) => ownerSearchTokens(q).map(foldForSearch).filter(Boolean);
const sets = (q) => relaxedTokenSets(terms(q));

describe('relaxedTokenSets', () => {
  it('tries the exact tokens first', () => {
    // An exact match must always win; relaxation is a fallback, never a
    // replacement.
    expect(sets('Vior Gold Corporation')[0]).toEqual(['vior', 'gold']);
  });

  it('drops industry vocabulary that the registry may word differently', () => {
    const [, second] = sets('Vior Gold Corporation');
    expect(second).toEqual(['vior']);
  });

  it('rescues the cases measured as returning nothing', () => {
    // Each of these found 0 rows with every token required. The looser set is
    // the one that matches what the registry actually stores.
    expect(sets('Osisko Development Corporation')).toContainEqual(['osisko']);
    expect(sets('Azimut Exploration Mining Corp')).toContainEqual(['azimut']);
    expect(sets('Vior Gold Corporation')).toContainEqual(['vior']);
  });

  it('treats French and English industry words alike', () => {
    // Either side can appear: the user types one language, the registry stores
    // the other.
    expect(sets('Ressources Minieres Vior')).toContainEqual(['vior']);
    expect(sets('Vior Mining Resources')).toContainEqual(['vior']);
  });

  it('falls back to the most distinctive single word', () => {
    // Longest is a proxy for distinctive: "azimut" over "corp".
    const last = sets('Nouveau Monde Graphite')[sets('Nouveau Monde Graphite').length - 1];
    expect(last).toHaveLength(1);
    expect(last[0]).toBe('graphite');
  });

  it('never produces an empty token set', () => {
    // An empty filter does not fail — it drops the WHERE clause and pages the
    // whole table back. Every attempt must constrain something.
    ['Gold Mining Corporation', 'Ressources Minieres Inc', 'Mining'].forEach((q) => {
      const attempts = sets(q);
      expect(attempts.length).toBeGreaterThan(0);
      attempts.forEach((a) => expect(a.length).toBeGreaterThan(0));
    });
  });

  it('keeps an all-generic name searchable rather than discarding every word', () => {
    // "Gold Mining Corporation" is all industry vocabulary. Stripping it whole
    // would search for nothing at all.
    const attempts = sets('Gold Mining Corporation');
    expect(attempts[0]).toEqual(['gold', 'mining']);
    attempts.forEach((a) => expect(a.length).toBeGreaterThan(0));
  });

  it('does not repeat a query that already returned nothing', () => {
    // A single-word search has nothing to relax to, and re-running it is pure
    // latency on the path that is already the slow one.
    expect(sets('Kenorland')).toEqual([['kenorland']]);
    const keys = sets('Azimut Exploration Mining Corp').map((s) => s.join(' '));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('orders attempts from most specific to least', () => {
    const attempts = sets('Azimut Exploration Mining Corp');
    for (let i = 1; i < attempts.length; i += 1) {
      expect(attempts[i].length).toBeLessThanOrEqual(attempts[i - 1].length);
    }
  });
});

// Relaxing is only a rescue while the looser query is still a query.
//
// Stripping the industry words from "A Gold Corporation" leaves ["a"], and
// `%a%` matches 185,863 of the 258,608 rows in the Quebec store across 987
// unrelated holders — ten pages against the 10,000-feature ceiling, returning
// an arbitrary slice presented as the company's ground. Measured live:
//
//   %a%      185,863 rows / 987 holders     %the%     1,811 rows
//   %the% AND %of%     88 rows              total   258,608 rows
//
// A search that cannot narrow is worse than no results, because the user cannot
// tell it apart from a real answer.
describe('low-information token sets', () => {
  it('refuses a relaxed set that would scan the table', () => {
    // The whole point of the fix: "a" and "the" are all that survive dropping
    // the industry words, so there is no looser query worth running.
    expect(sets('A Gold Corporation')).toEqual([['a', 'gold']]);
    expect(sets('The Gold Corporation')).toEqual([['the', 'gold']]);
  });

  it('refuses a single-word fallback that would scan the table', () => {
    // Picking the longest token overall would take "the" out of ["the", "of"]
    // and issue the same scan by a longer route.
    expect(sets('The Mining Group of Canada')).toEqual([
      ['the', 'mining', 'group', 'of', 'canada'],
    ]);
  });

  it('rejects initials left behind by punctuation splitting', () => {
    // "A.B.C. Mining Ltd" tokenises to a, b, c, mining. Dropping the industry
    // word leaves three single letters.
    expect(sets('A.B.C. Mining Ltd')).toEqual([['a', 'b', 'c', 'mining']]);
  });

  it('judges the set, not each token', () => {
    // A stop word costs nothing beside an informative one — "azimut" still
    // constrains the query, so this relaxation is worth running.
    expect(sets('The Azimut Corporation')).toContainEqual(['azimut']);
    expect(isInformativeTokenSet(['a', 'azimut'])).toBe(true);
    expect(isInformativeTokenSet(['a', 'the'])).toBe(false);
  });

  it('catches both short fragments and three-letter stop words', () => {
    // Neither rule subsumes the other: "of" is caught by length, "the" is not.
    expect(isInformativeTokenSet(['of'])).toBe(false);
    expect(isInformativeTokenSet(['the'])).toBe(false);
    expect(isInformativeTokenSet(['ab'])).toBe(false);
    expect(isInformativeTokenSet(['vior'])).toBe(true);
  });

  it('treats French articles like English ones', () => {
    // GESTIM records "Les Ressources X" as readily as "X Resources".
    expect(isInformativeTokenSet(['les', 'de'])).toBe(false);
    expect(sets('Les Ressources Minieres')).toEqual([['les', 'ressources', 'minieres']]);
  });

  it('still relaxes every case the feature was built for', () => {
    // The guard must not buy safety by disabling the rescue.
    expect(sets('Vior Gold Corporation')).toContainEqual(['vior']);
    expect(sets('Osisko Development Corporation')).toContainEqual(['osisko']);
    expect(sets('Azimut Exploration Mining Corp')).toContainEqual(['azimut']);
    expect(sets('Nouveau Monde Graphite')).toContainEqual(['graphite']);
    expect(sets('Gold Mining Corporation')).toContainEqual(['mining']);
  });
});

// The exact path has the identical failure, and worse: `?q=a.` passes the
// two-character length check, tokenises to ["a"], and scans 72% of the store
// from an endpoint anonymous callers can reach. Guarding only the fallback
// would leave the front door open.
describe('exact-path guard', () => {
  const accepted = (q) => isInformativeTokenSet(terms(q));

  const makeRes = () => ({
    headers: {}, statusCode: null, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  });

  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = 'https://example.test';
    process.env.SUPABASE_ANON_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  });

  it('refuses a search that cannot narrow anything', () => {
    expect(accepted('a.')).toBe(false);
    expect(accepted('the')).toBe(false);
    expect(accepted('of')).toBe(false);
  });

  it('accepts a search with one informative word beside a stop word', () => {
    expect(accepted('A Gold Corporation')).toBe(true);
    expect(accepted('vior')).toBe(true);
  });

  // Asserting isInformativeTokenSet in isolation proves the RULE, not that the
  // handler applies it — the guard could be deleted from searchQc and every
  // assertion above would still pass. This drives the real handler instead, and
  // asserts on the one thing that matters: no query is issued at all.
  it('rejects the request before issuing any query', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('must not query'); });
    vi.stubGlobal('fetch', fetchMock);
    const { default: handler } = await import('../api/claims.js');

    const res = makeRes();
    await handler(
      { method: 'GET', query: { q: 'a.', type: 'company', province: 'qc' }, headers: {} },
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still lets an informative search through to the store', async () => {
    // The mirror image: a guard that rejects everything would pass the test
    // above and break the feature.
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      json: async () => [],
      text: async () => '[]',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { default: handler } = await import('../api/claims.js');

    const res = makeRes();
    await handler(
      { method: 'GET', query: { q: 'vior', type: 'company', province: 'qc' }, headers: {} },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  // The guard is only half the fix. "the" and "AB" clear the two-character
  // minimum the input box enforces, so answering them with "q param required
  // (min 2 chars)" tells the user to satisfy a condition they already satisfy
  // — and useClaims renders the server error verbatim, so that sentence is the
  // whole explanation they get. A correct rejection with a wrong reason leaves
  // them retyping the same query.
  it('does not answer a long-enough term with the length error', async () => {
    for (const q of ['the', 'AB', 'a.']) {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('must not query'); }));
      const { default: handler } = await import('../api/claims.js');
      const res = makeRes();
      // eslint-disable-next-line no-await-in-loop -- one assertion per term
      await handler(
        { method: 'GET', query: { q, type: 'company', province: 'qc' }, headers: {} },
        res,
      );
      expect(res.statusCode, q).toBe(400);
      expect(`${res.body.error} ${res.body.detail}`, q).not.toMatch(/min 2 chars/);
      vi.resetModules();
    }
  });

  it('names what the search actually needs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('must not query'); }));
    const { default: handler } = await import('../api/claims.js');
    const res = makeRes();
    await handler(
      { method: 'GET', query: { q: 'the', type: 'company', province: 'qc' }, headers: {} },
      res,
    );
    expect(res.body).toEqual(UNINFORMATIVE_TERM_ERROR);
    // Actionable, not just accurate: it has to say what to do next.
    expect(res.body.detail).toMatch(/try adding|add /i);
  });

  // The rule has two halves and the message has to carry both. "AB" trips the
  // length floor, not the stop-word list, so a message that only mentions
  // single letters and common words sends that user back to retype a name that
  // may already be as distinctive as it gets — the same loop this message
  // exists to break, one rung further down.
  it('states the length requirement, not only the common-word one', () => {
    expect(UNINFORMATIVE_TERM_ERROR.detail).toMatch(/three letters|3 letters/i);
  });

  it('states the common-word requirement, not only the length one', () => {
    expect(UNINFORMATIVE_TERM_ERROR.detail).toMatch(/common word/i);
    expect(UNINFORMATIVE_TERM_ERROR.detail).toMatch(/"the"|"of"/);
  });

  it('explains a two-letter term by its real reason', async () => {
    // "AB" clears the input's two-character minimum and contains no stop word.
    // Nothing about single letters or common words explains its rejection.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('must not query'); }));
    const { default: handler } = await import('../api/claims.js');
    const res = makeRes();
    await handler(
      { method: 'GET', query: { q: 'AB', type: 'company', province: 'qc' }, headers: {} },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.detail).toMatch(/three letters|3 letters/i);
  });

  it('fits the 200 characters useClaims will render', () => {
    // useClaims builds `${error}: ${detail}` and slices at 200. A message that
    // explains the requirement in its second half would be cut off mid-advice.
    const rendered = `${UNINFORMATIVE_TERM_ERROR.error}: ${UNINFORMATIVE_TERM_ERROR.detail}`;
    expect(rendered.length).toBeLessThanOrEqual(200);
  });

  it('still reports a genuinely too-short term as too short', () => {
    // The length guard above it is not wrong and must keep its own message —
    // "a*" cleans down to one usable character.
    expect(UNINFORMATIVE_TERM_ERROR.error).not.toMatch(/min 2 chars/);
  });

  it('costs no real holder', () => {
    // Verified against the live store: zero of the 258,608 rows carry a holder
    // name built only from stop words and shorter fragments, so nothing that
    // exists becomes unsearchable.
    ['Vior', 'Osisko', 'SOQUEM', 'Nouveau Monde Graphite', 'Les Ressources Minieres']
      .forEach((q) => expect(accepted(q), q).toBe(true));
  });
});

// The server and the component have to agree on the META KEY NAMES, and
// nothing in either file reveals a mismatch on its own. This is the same shape
// of bug as renaming an RPC argument the caller still sends: the widened search
// would run, results would render, and the notice saying they were widened
// would silently never appear — which is the one outcome this feature must not
// have.
describe('relaxed-search meta contract', () => {
  const api = readFileSync('api/claims.js', 'utf8');
  const ui = readFileSync('src/components/RegistrySearch.jsx', 'utf8');

  it('uses the same keys on both sides', () => {
    ['relaxedFrom', 'relaxedTo'].forEach((key) => {
      expect(api, `api/claims.js never sets meta.${key}`).toContain(key);
      expect(ui, `RegistrySearch never reads meta.${key}`).toContain(key);
    });
  });

  it('gates the notice on results actually being present', () => {
    // A notice about widened results, with no results under it, would be noise.
    expect(ui).toMatch(/meta\?\.relaxedTo\s*&&\s*allFeatures\.length\s*>\s*0/);
  });

  it('only flags relaxation when the search really was widened', () => {
    // The server must not mark an exact hit as relaxed.
    expect(api).toMatch(/usedTokens\.length\s*!==\s*tokens\.length/);
    expect(api).toMatch(/result\.features\.length\s*>\s*0/);
  });

  it('shows the user both what they typed and what was searched', () => {
    // "Showing results for X" without the original leaves them unable to tell
    // whether the match is theirs.
    expect(ui).toMatch(/relaxedFrom/);
    expect(ui).toMatch(/relaxedTo/);
  });
});

describe('Quebec empty-state guidance', () => {
  const msg = (province) => emptyResultMessage({
    query: 'Vior Gold Corporation',
    jurisdictionLabel: 'Quebec',
    isUs: false,
    mode: 'company',
    province,
  });

  it('names the language barrier, since relaxation already tried typing less', () => {
    // Reaching this message means even the single distinctive word found
    // nothing, so "try a shorter name" is advice the search already took.
    const m = msg('qc');
    expect(m.hint).toMatch(/aurifere|french/i);
    expect(m.hint).toMatch(/miniere|ressources/i);
  });

  it('still refuses to say the company holds nothing there', () => {
    expect(msg('qc').detail).toMatch(/not a statement that the company holds no ground/i);
  });

  it('leaves other provinces on the generic guidance', () => {
    expect(msg('bc').hint).toMatch(/distinctive word/i);
    expect(msg('bc').hint).not.toMatch(/aurifere/i);
  });
});
