import { describe, it, expect } from 'vitest';
import { ownerSearchTokens, bcCqlFilter } from '../api/claims.js';
import { emptyResultMessage } from '../src/utils/scopingNotice.js';

// Owner search matched one contiguous `ILIKE '%term%'`, so the entire typed
// string — spacing, punctuation, word order and legal suffix — had to appear
// verbatim in the registry's own rendering of the name. From search_events on
// the live site:
//
//   query length             searches   returned nothing
//   1-8 chars (one word)          35         26%
//   9-15 chars                    12         50%
//   16-24 chars                   10         10%
//   25+ chars (full legal name)   10        100%
//
// Every single search of a full legal company name failed. The product
// punished precision: type the company's real name, get nothing; type one
// word, it works. Nobody could guess that rule, and the drop-off report shows
// people leaving rather than retrying.

describe('ownerSearchTokens', () => {
  it('drops punctuation the registry does not share', () => {
    // The exact live failure: B.C. holds "XIMEN MINING CORP" with no full stop,
    // so 'ximen mining corp.' matched 0 of 42,704 owner rows while 'ximen'
    // matched 543.
    expect(ownerSearchTokens('Ximen Mining Corp.')).toEqual(['Ximen', 'Mining']);
  });

  it('drops legal suffixes, which name the wrapper and not the company', () => {
    expect(ownerSearchTokens('Teck Resources Limited')).toEqual(['Teck', 'Resources']);
    expect(ownerSearchTokens('Thompson Creek Metals Company Inc.')).toEqual(['Thompson', 'Creek', 'Metals']);
    expect(ownerSearchTokens('Northwest Copper Corporation')).toEqual(['Northwest', 'Copper']);
  });

  it('keeps words that distinguish real companies from each other', () => {
    // The failure mode of an over-eager stop list. GOLD, MINING, RESOURCES and
    // METALS are common but they are what separates one holder from another —
    // dropping them would make the search vaguer, not more forgiving.
    expect(ownerSearchTokens('Barkerville Gold Mines Ltd.')).toEqual(['Barkerville', 'Gold', 'Mines']);
    expect(ownerSearchTokens('Eagle Plains Resources Ltd.')).toEqual(['Eagle', 'Plains', 'Resources']);
  });

  it('handles a name recorded surname-first', () => {
    // B.C. records individuals as "SCOTT, STEVEN JEFFREY". Searching "Steven
    // Scott" matched nothing at all — 467 titles, invisible — because the comma
    // and the word order broke the contiguous match.
    expect(ownerSearchTokens('Steven Scott')).toEqual(['Steven', 'Scott']);
  });

  it('falls back to the raw words when the term is nothing but a suffix', () => {
    // Stripping everything would leave no clause at all, which is a
    // match-everything query against a public government endpoint.
    expect(ownerSearchTokens('Ltd')).toEqual(['Ltd']);
    expect(ownerSearchTokens('Inc.')).toEqual(['Inc']);
  });

  it('returns nothing for an empty term rather than a wildcard', () => {
    expect(ownerSearchTokens('')).toEqual([]);
    expect(ownerSearchTokens(null)).toEqual([]);
  });
});

describe('bcCqlFilter owner clauses', () => {
  it('requires every meaningful word, in any order', () => {
    expect(bcCqlFilter('Ximen Mining Corp.', 'company'))
      .toBe("(OWNER_NAME ILIKE '%Ximen%' AND OWNER_NAME ILIKE '%Mining%')");
  });

  it('emits a bare clause for a single word, unchanged from before', () => {
    expect(bcCqlFilter('Teck', 'company')).toBe("OWNER_NAME ILIKE '%Teck%'");
  });

  it('can only widen a search, never narrow it', () => {
    // Every AND-ed token is implied by the old contiguous match, so a query
    // that worked before still works. Verified against the mirror: of ten full
    // legal names, three went from 0 hits to hundreds and seven were unchanged.
    // None decreased.
    const filter = bcCqlFilter('Eagle Plains Resources Ltd.', 'company');
    for (const token of ['Eagle', 'Plains', 'Resources']) {
      expect(filter).toContain(`ILIKE '%${token}%'`);
    }
    expect(filter).not.toContain('Ltd');
  });

  it('still escapes a quote out of the token path', () => {
    // Tokenising must not open a hole the single-term path had closed. The
    // apostrophe stays inside the token — splitting on it would search for
    // `%obrien%`, which matches nothing, since the registry holds O'BRIEN.
    const filter = bcCqlFilter("O'Brien Mining Ltd", 'company');
    expect(filter).toBe("(OWNER_NAME ILIKE '%O''Brien%' AND OWNER_NAME ILIKE '%Mining%')");
  });

  it('keeps a hyphenated name whole', () => {
    expect(bcCqlFilter('Anglo-Canadian Mining Corp.', 'company'))
      .toBe("(OWNER_NAME ILIKE '%Anglo-Canadian%' AND OWNER_NAME ILIKE '%Mining%')");
  });

  it('escapes wildcards so a term cannot ask for the whole province', () => {
    const filter = bcCqlFilter('% Mining', 'company');
    expect(filter).toContain('\\%');
  });

  it('leaves number search alone', () => {
    expect(bcCqlFilter('1012345', 'number')).toContain('TENURE_NUMBER_ID = 1012345');
  });
});

describe('the empty state does not read as "this company owns nothing"', () => {
  const base = { resolution: { status: 'resolved' }, query: 'Taseko Mines', jurisdictionLabel: 'British Columbia' };

  it('explains that title is held by the legal entity, often a subsidiary', () => {
    // Taseko's B.C. ground stands in the name of GIBRALTAR MINES LTD., and
    // Artemis Gold's in that of BW GOLD LTD. A flat "no claims found" tells the
    // user something false about both.
    const msg = emptyResultMessage({ ...base, isUs: false });
    expect(msg.detail).toMatch(/subsidiary/i);
    expect(msg.detail).toMatch(/not a statement that the company holds no ground/i);
  });

  it('leads the hint with the move the telemetry says works', () => {
    // One-word searches returned something 74% of the time; full legal names
    // returned nothing 100% of the time.
    expect(emptyResultMessage({ ...base, isUs: false }).hint).toMatch(/one distinctive word/i);
  });

  it('leaves the US wording alone', () => {
    // The US branch already distinguished unresolved from empty and has its own
    // subsidiary guidance; this change must not disturb it.
    const msg = emptyResultMessage({ ...base, isUs: true });
    expect(msg.detail).toBeNull();
    expect(msg.hint).toBe('Try a shorter name or check spelling.');
  });

  it('still separates unresolved from genuinely empty', () => {
    const unresolved = emptyResultMessage({
      resolution: { status: 'unresolved', reason: 'no_claimant_field' },
      query: 'X', jurisdictionLabel: 'Nevada', isUs: true,
    });
    expect(unresolved.kind).toBe('unresolved');
    expect(emptyResultMessage({ ...base, isUs: false }).kind).toBe('empty');
  });
});
