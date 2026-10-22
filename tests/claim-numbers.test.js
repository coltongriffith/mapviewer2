import { describe, it, expect } from 'vitest';
import { parseClaimNumbers, cleanSingleNumber, MAX_CLAIM_NUMBERS } from '../shared/claimNumbers.js';
import {
  claimNumberRequest, prefixUpperBound, qcNumberForms, bcNumberListFilter, numberListMeta,
} from '../api/claims.js';

// What people put in the Claim # box on the Quebec guide (search_events,
// Oct 2026): "#4527312", a 239-character paste of thirty numbers, and company
// names typed into the wrong tab. Every one of them came back as an error.

describe('parseClaimNumbers', () => {
  it('reads one number, with or without a marker', () => {
    expect(parseClaimNumbers('4527312')).toMatchObject({ kind: 'numbers', numbers: ['4527312'], total: 1 });
    expect(parseClaimNumbers('#4527312').numbers).toEqual(['4527312']);
    expect(parseClaimNumbers('No. 627637').numbers).toEqual(['627637']);
    expect(parseClaimNumbers('N° 2654321').numbers).toEqual(['2654321']);
  });

  it('splits on spaces, commas, semicolons, tabs and newlines', () => {
    expect(parseClaimNumbers('2351771 2351772,2351773;2351774\n2351775\t2351776\r\n2351777').numbers)
      .toEqual(['2351771', '2351772', '2351773', '2351774', '2351775', '2351776', '2351777']);
  });

  it('reads the pasted list from the Quebec telemetry as thirty numbers', () => {
    const pasted = Array.from({ length: 30 }, (_, i) => String(2351771 + i)).join(' ');
    expect(pasted.length).toBe(239);
    const read = parseClaimNumbers(pasted);
    expect(read).toMatchObject({ kind: 'numbers', total: 30, truncated: false });
    expect(read.numbers[0]).toBe('2351771');
    expect(read.numbers[29]).toBe('2351800');
  });

  it('caps a long list and says how many there were', () => {
    const many = Array.from({ length: 130 }, (_, i) => String(1000000 + i)).join(', ');
    const read = parseClaimNumbers(many);
    expect(read.numbers).toHaveLength(MAX_CLAIM_NUMBERS);
    expect(read).toMatchObject({ total: 130, truncated: true });
  });

  it('drops duplicates, keeping the order typed', () => {
    expect(parseClaimNumbers('3, 1, 3, 2, 1').numbers).toEqual(['3', '1', '2']);
    expect(parseClaimNumbers('cb12345 CB12345').numbers).toEqual(['cb12345']);
  });

  it('keeps a letter prefix written apart from its digits as one number', () => {
    expect(parseClaimNumbers('CB 12345, CB 12346').numbers).toEqual(['CB12345', 'CB12346']);
    expect(parseClaimNumbers('nv 105331298').numbers).toEqual(['nv105331298']);
  });

  it('ignores the words that ride along with numbers', () => {
    expect(parseClaimNumbers('claims 2351771 and 2351772').numbers).toEqual(['2351771', '2351772']);
    expect(parseClaimNumbers('CDC 2654321').numbers).toEqual(['2654321']);
  });

  it('strips edge punctuation but keeps hyphenated tags', () => {
    expect(parseClaimNumbers('(627637). 627638,').numbers).toEqual(['627637', '627638']);
    expect(parseClaimNumbers('CB-12345').numbers).toEqual(['CB-12345']);
  });

  it('calls a company name text, not numbers', () => {
    expect(parseClaimNumbers('big ridge gold corp').kind).toBe('text');
    expect(parseClaimNumbers('destiny').kind).toBe('text');
    // A company with a number in its name is still a company.
    expect(parseClaimNumbers('1911 Gold').kind).toBe('text');
  });

  it('calls a box with nothing usable empty', () => {
    expect(parseClaimNumbers('  # , ; ').kind).toBe('empty');
    expect(parseClaimNumbers('').kind).toBe('empty');
  });
});

describe('cleanSingleNumber', () => {
  it('removes markers and keeps the spelling of the number', () => {
    expect(cleanSingleNumber('#4527312')).toBe('4527312');
    expect(cleanSingleNumber(' No. CB 12345 ')).toBe('CB 12345');
  });
});

describe('claimNumberRequest (what the proxy actually searches)', () => {
  it('searches "#4527312" as the number 4527312', () => {
    expect(claimNumberRequest('#4527312', 'qc')).toMatchObject({ type: 'number', term: '4527312', numberList: null });
  });

  it('turns a pasted list into a numberList', () => {
    const r = claimNumberRequest('2351771 2351772 2351773', 'qc');
    expect(r.type).toBe('number');
    expect(r.numberList.numbers).toEqual(['2351771', '2351772', '2351773']);
  });

  it('searches a company name typed into Claim # as a company, and says so', () => {
    expect(claimNumberRequest('big ridge gold corp', 'qc'))
      .toMatchObject({ type: 'company', term: 'big ridge gold corp', extraMeta: { searchedAs: 'company' } });
    expect(claimNumberRequest('destiny', 'on')).toMatchObject({ type: 'company' });
  });

  it('never makes a company search where the registry publishes no holder', () => {
    // Manitoba has no holder field; the US "company" tab is a claim-name match.
    expect(claimNumberRequest('destiny', 'mb').type).toBe('number');
    expect(claimNumberRequest('big ridge gold', 'us-nv').type).toBe('number');
  });

  it('leaves an ordinary single number exactly as typed', () => {
    expect(claimNumberRequest('CB12345', 'mb')).toMatchObject({ type: 'number', term: 'CB12345' });
    expect(claimNumberRequest('CB 12345', 'mb')).toMatchObject({ type: 'number', term: 'CB 12345' });
  });
});

describe('index-friendly Quebec filters', () => {
  it('bounds a prefix for a range scan, carrying past 9 and Z', () => {
    expect(prefixUpperBound('1212697')).toBe('1212698');
    expect(prefixUpperBound('23519')).toBe('2352');
    expect(prefixUpperBound('156PTZ')).toBe('156PU');
    expect(prefixUpperBound('999')).toBeNull();
  });

  it('spells each listed number the way the store keeps it', () => {
    expect(qcNumberForms(['2351771', '156pta', 'CB-1'])).toEqual(['2351771', '156PTA', 'CB-1', 'CB1']);
    // Nothing that could break out of a PostgREST in.() list survives.
    expect(qcNumberForms(['1,2', '3)'])).toEqual([]);
  });
});

describe('number lists elsewhere', () => {
  it('asks B.C. for tenure numbers unquoted and tags quoted, in one filter', () => {
    expect(bcNumberListFilter(['1136599', '1069939', "A'B1"]))
      .toBe("(TENURE_NUMBER_ID IN (1136599,1069939) OR TAG_NUMBER IN ('1136599','1069939','A''B1'))");
  });

  it('reports which numbers were found and which were not', () => {
    const list = parseClaimNumbers('627637 627638 cb-12');
    const meta = numberListMeta(list, [{ properties: { TAG_NUMBER: '627638' } }, { properties: { TAG_NUMBER: 'CB12' } }], (f) => [f.properties.TAG_NUMBER]);
    expect(meta).toMatchObject({ requested: 3, found: ['627638', 'cb-12'], missing: ['627637'], truncated: false });
  });
});
