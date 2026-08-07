import { describe, it, expect } from 'vitest';
import { bcCqlFilter } from '../api/claims.js';

// B.C. claim-number search.
//
// THE BUG THIS EXISTS FOR, and why it survived for months:
//
// The filter was `TAG_NUMBER = '<term>'`. TAG_NUMBER is the staking tag, and
// it is NULL on 36,925 of the 42,332 B.C. titles in the mirror — cell claims
// do not have one. TENURE_NUMBER_ID, the number MTO shows and the number our
// own placeholder told the user to type ("e.g. 1012345"), was never consulted.
//
// So somebody doing exactly what the UI instructed got nothing across 87% of
// the province. And it was invisible: the request succeeded, the WFS server
// answered, the UI said "no claims found". Telemetry recorded `empty`, which
// is the same thing it records for ground nobody has staked. A real miss and
// an unanswerable query looked identical in the data.
//
// It was found by reading one dropped session — an anonymous visitor who
// searched three times in 85 seconds and left — not by any alarm.

describe('B.C. claim-number search reaches both numbers', () => {
  it('matches the tenure number, which every title has', () => {
    // The regression. TENURE_NUMBER_ID is present on all 42,332 titles.
    const f = bcCqlFilter('1012345', 'number');
    expect(f).toContain('TENURE_NUMBER_ID = 1012345');
  });

  it('still matches the staking tag, which some titles have', () => {
    const f = bcCqlFilter('1012345', 'number');
    expect(f).toContain("TAG_NUMBER = '1012345'");
  });

  it('ORs them rather than picking one', () => {
    // A user holds one number or the other and does not necessarily know
    // which kind theirs is. Requiring them to know is the bug restated.
    const f = bcCqlFilter('1012345', 'number');
    expect(f).toBe("(TENURE_NUMBER_ID = 1012345 OR TAG_NUMBER = '1012345')");
  });

  it('leaves the numeric comparison UNQUOTED', () => {
    // TENURE_NUMBER_ID is a number in the source. Quoting a numeric field makes
    // the WFS server reject the entire filter, which would turn a search that
    // returns too little into one that returns an error — worse, not better.
    const f = bcCqlFilter('1012345', 'number');
    expect(f).not.toContain("TENURE_NUMBER_ID = '");
  });

  it('accepts the 6-digit numbers that 15,645 titles carry', () => {
    // The dropped session searched 6 characters twice. Six digits is a
    // perfectly ordinary B.C. tenure number, which is what makes "user error"
    // the wrong reading of that session.
    expect(bcCqlFilter('102030', 'number')).toContain('TENURE_NUMBER_ID = 102030');
  });

  it('does not build a numeric comparison from a non-numeric term', () => {
    // A claim name or a tag with letters must not become
    // `TENURE_NUMBER_ID = ABC123`, which the server would reject outright.
    const f = bcCqlFilter('ABC123', 'number');
    expect(f).toBe("TAG_NUMBER = 'ABC123'");
    expect(f).not.toContain('TENURE_NUMBER_ID');
  });
});

describe('the other B.C. search modes are unchanged', () => {
  it('searches owner name as a contains match', () => {
    expect(bcCqlFilter('Teck', 'company')).toBe("OWNER_NAME ILIKE '%Teck%'");
  });

  it('searches map sheet as a prefix match', () => {
    expect(bcCqlFilter('082F', 'map')).toBe("MAP_UNIT_NO ILIKE '082F%'");
  });
});

describe('injection and LIKE metacharacters stay escaped', () => {
  // The escaping predates this change and must survive it — the filter is
  // interpolated into a CQL string that reaches a government endpoint.
  it("doubles a single quote so it cannot close the literal", () => {
    expect(bcCqlFilter("O'Brien", 'company')).toBe("OWNER_NAME ILIKE '%O''Brien%'");
  });

  it('escapes LIKE wildcards so they match literally', () => {
    expect(bcCqlFilter('100%', 'company')).toContain('100\\%');
    expect(bcCqlFilter('a_b', 'company')).toContain('a\\_b');
  });

  it('never lets a quote reach the numeric branch unescaped', () => {
    // The numeric branch interpolates `term` rather than `safeTerm`, which is
    // only safe because it is gated on /^\d+$/. This pins that gate: anything
    // carrying a quote must not take the numeric path.
    const f = bcCqlFilter("1' OR '1'='1", 'number');
    expect(f).not.toContain('TENURE_NUMBER_ID');
    expect(f).toBe("TAG_NUMBER = '1'' OR ''1''=''1'");
  });
});
