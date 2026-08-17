import { describe, it, expect } from 'vitest';
import { relaxedTokenSets, ownerSearchTokens, foldForSearch } from '../api/claims.js';
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
