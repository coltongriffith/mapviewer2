import { describe, it, expect } from 'vitest';
import { foldForSearch, ownerSearchTokens } from '../api/claims.js';

// Quebec holder search matched owner_name as ONE contiguous substring.
//
// GESTIM is francophone: it stores "Exploration Azimut inc." for the company
// the market calls Azimut Exploration, and "Corporation Aurifère Vior Inc."
// for Vior. A single %term% could match neither the reversed word order nor a
// missing accent, so the province's two largest holders returned nothing for
// their own names — measured against the live table, 0 rows where token
// matching returns 10,891 and 8,646.
//
// The fix has two halves that must agree: owner_name_norm is accent-stripped
// and lowercased in the database, and foldForSearch does the same to the
// needle. If the two ever disagree the search silently matches nothing, which
// is exactly the failure mode being fixed — so these test the agreement.

describe('foldForSearch', () => {
  it('strips the accents GESTIM actually uses', () => {
    expect(foldForSearch('Aurifère')).toBe('aurifere');
    expect(foldForSearch('Société Québec')).toBe('societe quebec');
    expect(foldForSearch('Ltée')).toBe('ltee');
    expect(foldForSearch('Métaux')).toBe('metaux');
  });

  it('lowercases, so the folded needle matches the folded column', () => {
    expect(foldForSearch('AZIMUT')).toBe('azimut');
    expect(foldForSearch('MiDlAnD')).toBe('midland');
  });

  it('leaves unaccented text alone', () => {
    expect(foldForSearch('Kenorland Minerals')).toBe('kenorland minerals');
  });

  it('preserves the characters inside a word', () => {
    // Apostrophes and hyphens sit inside a name rather than between two, and
    // the registry stores them.
    expect(foldForSearch("O'Brien")).toBe("o'brien");
    expect(foldForSearch('Li-Ft Power')).toBe('li-ft power');
  });

  it('survives empty and nullish input rather than throwing', () => {
    expect(foldForSearch('')).toBe('');
    expect(foldForSearch(null)).toBe('');
    expect(foldForSearch(undefined)).toBe('');
  });
});

describe('Quebec holder search terms', () => {
  // What the API builds its filter from: tokenise, then fold each token.
  const terms = (input) => ownerSearchTokens(input).map(foldForSearch).filter(Boolean);

  it('splits a market name so word order stops mattering', () => {
    // "Azimut Exploration" must reach "Exploration Azimut inc." — every token
    // present, in any order.
    expect(terms('Azimut Exploration')).toEqual(['azimut', 'exploration']);
    expect(terms('Midland Exploration')).toEqual(['midland', 'exploration']);
  });

  it('drops legal suffixes so a full legal name still matches', () => {
    // A pasted full name was the single biggest source of zero results: the
    // longer the query, the more likely one word differs from the registry.
    expect(terms('Azimut Exploration Inc.')).toEqual(['azimut', 'exploration']);
    expect(terms('Probe Gold Inc')).toEqual(['probe', 'gold']);
  });

  it('folds accents out of the tokens themselves', () => {
    expect(terms('Corporation Aurifère Vior')).toEqual(['aurifere', 'vior']);
    expect(terms('Ressources Québec')).toEqual(['ressources', 'quebec']);
  });

  it('matches an accented holder typed without accents', () => {
    // The point of folding both sides: a user on an English keyboard types
    // "Aurifere" and still reaches "Corporation Aurifère Inc."
    expect(terms('Aurifere Vior')).toEqual(terms('Aurifère Vior'));
  });

  it('keeps a single-word search as one token', () => {
    expect(terms('Kenorland')).toEqual(['kenorland']);
  });

  it('produces nothing for punctuation-only input', () => {
    // The caller must reject this rather than build an empty filter — an empty
    // PostgREST filter drops the WHERE clause and pages back the whole table.
    expect(terms('...')).toEqual([]);
    expect(terms('   ')).toEqual([]);
  });

  it('emits tokens safe to interpolate into a PostgREST filter', () => {
    // owner_name_norm=ilike.*token* — a token carrying '.' ',' '(' ')' or '"'
    // would be read as PostgREST syntax rather than as text.
    const samples = [
      'Corporation Aurifère Vior Inc.', '9414-5349 Québec inc.',
      'Explorations Carat inc. (Les)', 'O\'Brien Resources, Ltd.',
      'Li-Ft Power ltd.', 'SOQUEM inc.',
    ];
    samples.forEach((s) => {
      terms(s).forEach((t) => {
        expect(t, `token "${t}" from "${s}" carries PostgREST syntax`).not.toMatch(/[.,()"*%]/);
      });
    });
  });
});
