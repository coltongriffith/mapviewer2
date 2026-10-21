import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { readResults, readFiles, readAll, lengthCheck, pubCallouts, pubLines, staleNotes, headline, pubCols, manualCallouts, tie, icAt, PUB_FIELDS, RECORD_VERSION } from '../src/three-d/published-results.js';
import { refineRole } from '../src/three-d/roles.js';
import { ribbonPieces } from '../src/three-d/intercepts.js';
import { createHistory } from '../src/three-d/history.js';

// A release table for the built-in Example Ridge sample (fictional): a parent and its "incl." on EX-021, two
// separate results on EX-014 (the second with a published length that disagrees with its depths), and a draft.
const TEXT = readFileSync('tests/fixtures/three-d/published-results.csv', 'utf8');
const parsed = Papa.parse(TEXT.trim(), { skipEmptyLines: true }).data, header = parsed[0], rows = parsed.slice(1);
const COLS = pubCols(header, { hole: 1, from: 2, to: 3 }); // hole, from, to: the page's core column matcher
const file = (text = TEXT) => ({ name: 'release.csv', text, role: 'published', header, rows: Papa.parse(text.trim(), { skipEmptyLines: true }).data.slice(1), cols: { ...COLS } });
const LONG = '508.00 m @ 0.5300000000000001% Cu, 0.1234567890123 g/t Au from 8.000 m';
// Holes as the page has them (id, drawn length).
const holes = ['EX-014', 'EX-021', 'EX-022'].map((id) => ({ id, len: 560 }));
const read = () => readResults(header, rows, COLS, 'release.csv');

describe('published result records', () => {
  it('guesses every column of a release table once it is one', () => {
    expect(Object.keys(PUB_FIELDS)).toEqual(['resultId', 'hole', 'from', 'to', 'length', 'grade', 'analyte', 'unit', 'parent', 'approved', 'date', 'source', 'status']);
    expect(COLS).toEqual({ hole: 1, from: 2, to: 3, resultId: 0, length: 4, grade: 5, unit: 6, analyte: 7, parent: 8, approved: 9, date: 10, source: 11, status: 12 });
  });

  it('reads each row into a version 1 record, strings as published and depths as numbers', () => {
    const { results } = read();
    expect(results.map((r) => r.resultId)).toEqual(['EX21-01', 'EX21-01a', 'EX14-01', 'EX14-02', 'EX22-01']);
    expect(results[1]).toEqual({ version: RECORD_VERSION, resultId: 'EX21-01a', holeId: 'EX-021', fromM: 120, toM: 180, publishedLengthText: '60.0', gradeText: '0.81', analyte: 'Cu', unit: '%',
      parentResultId: 'EX21-01', approvedText: null, releaseDate: '2026-09-29', sourceRef: 'Example Ridge release 2026-09-29 Table 1', approvalStatus: 'Approved' });
    expect(RECORD_VERSION).toBe(1);
    expect(results[0].approvedText).toBe(LONG); // long decimals and a comma, verbatim
    expect(headline(results[0])).toEqual({ l1: LONG, l1b: '' });
    expect(headline(results[1])).toEqual({ l1: '60.0 m @ 0.81% Cu', l1b: ' from 120 m' }); // the published precision, not 60
  });

  it('flags a published length that disagrees with To − From, keeping both', () => {
    const { results, problems } = read(), r = results.find((x) => x.resultId === 'EX14-02');
    expect(r).toMatchObject({ publishedLengthText: '40', fromM: 300, toM: 342 });
    expect(problems.filter((p) => p.kind === 'length-discrepancy')).toEqual([expect.objectContaining({ resultId: 'EX14-02', message: expect.stringContaining('(40) is not To − From (342 − 300 = 42 m). Both are kept') })]);
    expect(headline(r).l1).toBe('40 m @ 0.48% Cu'); // the text as published; the depths still place it
    expect(pubCallouts(results, holes).find((c) => c.key === 'EX14-02').ic.broad).toMatchObject({ from: 300, len: 42, mid: 321 });
  });

  it('compares a length to the precision it was written to', () => {
    expect(lengthCheck('122', 294, 415.6)).toBeNull();
    expect(lengthCheck('122.0', 294, 415.6)).toEqual({ published: 122, depths: 121.6 });
    expect(lengthCheck('60.0 m', 120, 180)).toBeNull();
    expect(lengthCheck('about 60', 120, 150)).toBeNull(); // not a length to compare
  });

  it('leaves out rows it cannot place and keeps unapproved ones off the figure', () => {
    const bad = [['', 'EX-1', '1', '2'], ['R1', '', '1', '2'], ['R2', 'EX-1', '5', '5'], ['R3', 'EX-1', 'x', '9'], ['R4', 'EX-1', '1', '2'], ['R4', 'EX-1', '3', '4'], ['R5', 'EX-1', '1', '2', '', '0.5']];
    const { results, problems } = readResults(['id', 'hole', 'from', 'to', 'approved', 'grade'], bad, { resultId: 0, hole: 1, from: 2, to: 3, approved: 4, grade: 5 });
    expect(results.map((r) => r.resultId)).toEqual(['R5']);
    expect(problems.map((p) => p.kind)).toEqual(['no-result-id', 'no-hole', 'bad-depths', 'bad-depths', 'no-text', 'duplicate-result-id', 'no-status-column']);
    expect(results[0].approvalStatus).toBe('approved'); // no status column: every row is taken as approved, and the panel says so
    const all = readAll([file()], holes.slice(0, 2));
    expect(all.problems).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'not-approved', resultId: 'EX22-01' }), expect.objectContaining({ kind: 'no-collar', resultId: 'EX22-01' })]));
    expect(pubCallouts(read().results, holes).map((c) => c.key)).not.toContain('EX22-01');
  });
});

describe('callouts from published results', () => {
  const { results } = read();

  it('keeps two separate releases on one hole as two callouts, each on its own depths', () => {
    const cs = pubCallouts(results, holes).filter((c) => c.h.id === 'EX-014');
    expect(cs.map((c) => c.key)).toEqual(['EX14-01', 'EX14-02']);
    expect(cs.map((c) => [c.ic.broad.from, c.ic.broad.from + c.ic.broad.len, c.ic.broad.mid])).toEqual([[40, 70, 55], [300, 342, 321]]);
    expect(cs.every((c) => c.ic.incl === null && c.kids.length === 0)).toBe(true);
  });

  it('draws an "incl." result on its parent\'s callout, never as a second callout or a second reported interval', () => {
    const cs = pubCallouts(results, holes), ex21 = cs.filter((c) => c.h.id === 'EX-021');
    expect(ex21).toHaveLength(1);
    expect(ex21[0]).toMatchObject({ key: 'EX21-01', ic: { broad: { from: 8, len: 508, mid: 262 }, incl: { from: 120, len: 60 }, incls: [{ from: 120, len: 60, mid: 150 }] } });
    expect(ex21[0].kids.map((r) => r.resultId)).toEqual(['EX21-01a']);
    // Every result is in exactly one place: a reported interval or an "incl." line.
    const placed = cs.flatMap((c) => [c.key, ...c.kids.map((r) => r.resultId)]);
    expect(placed.sort()).toEqual(['EX14-01', 'EX14-02', 'EX21-01', 'EX21-01a']);
    expect(cs.reduce((s, c) => s + c.ic.broad.len, 0)).toBe(508 + 30 + 42); // the nested 60 m is not added again
    expect(pubLines(ex21[0])).toEqual({ l1: LONG, l1b: '', l2: 'incl. 60.0 m @ 0.81% Cu from 120 m' });
  });

  it('shows an "incl." result on its own when its parent is unticked, and drops it when it is', () => {
    const own = pubCallouts(results, holes, { 'EX21-01': { show: false } }).filter((c) => c.h.id === 'EX-021');
    expect(own.map((c) => [c.key, c.ic.broad.from, c.ic.broad.len])).toEqual([['EX21-01a', 120, 60]]);
    const none = pubCallouts(results, holes, { 'EX21-01a': { show: false } }).find((c) => c.key === 'EX21-01');
    expect(none.kids).toEqual([]); expect(none.ic.incl).toBeNull();
    expect(pubLines(none).l2).toBeNull();
  });

  it('a child outside its parent, or on another hole, is its own callout and is flagged', () => {
    const odd = results.map((r) => (r.resultId === 'EX21-01a' ? { ...r, fromM: 500, toM: 530 } : r));
    expect(pubCallouts(odd, holes).filter((c) => c.h.id === 'EX-021').map((c) => c.key)).toEqual(['EX21-01', 'EX21-01a']);
    const rows2 = rows.map((r) => (r[0] === 'EX21-01a' ? [r[0], r[1], '500', '530', ...r.slice(4)] : r));
    expect(readResults(header, rows2, COLS).problems.map((p) => p.kind)).toContain('outside-parent');
  });

  it('rejects depths above the collar instead of pinning the interval to it', () => {
    const { results, problems } = readResults(['id', 'hole', 'from', 'to', 'approved'], [['N1', 'EX-1', '-10', '5', 'x'], ['N2', 'EX-1', '0', '5', 'y']], { resultId: 0, hole: 1, from: 2, to: 3, approved: 4 });
    expect(results.map((r) => r.resultId)).toEqual(['N2']);
    expect(problems[0]).toMatchObject({ kind: 'bad-depths', resultId: 'N1', message: 'N1: From and To must be depths down the hole in metres (0 or more), with To below From, so it is left out.' });
  });

  it('ignores parent links that lead back round (A in B, B in A): each is drawn once, as its own callout', () => {
    const cyc = [['A', 'EX-014', '40', '70', 'B', 'Text A'], ['B', 'EX-014', '40', '70', 'A', 'Text B'], ['C', 'EX-014', '50', '60', 'C', 'Text C'], ['D', 'EX-014', '45', '55', 'B', 'Text D']];
    const { results, problems } = readResults(['id', 'hole', 'from', 'to', 'parent', 'approved'], cyc, { resultId: 0, hole: 1, from: 2, to: 3, parent: 4, approved: 5 });
    expect(problems.filter((p) => p.kind === 'parent-cycle').map((p) => p.message)).toEqual([
      'A: its parent results lead back to itself (A → B → A), so it is drawn on its own.', 'B: its parent results lead back to itself (B → A → B), so it is drawn on its own.', 'C: its parent results lead back to itself (C → C), so it is drawn on its own.']);
    const cs = pubCallouts(results, holes);
    expect(cs.map((c) => [c.key, c.kids.map((r) => r.resultId)])).toEqual([['A', []], ['B', ['D']], ['C', []]]); // D's link to B still holds
    expect(cs.flatMap((c) => [c.key, ...c.kids.map((r) => r.resultId)]).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('sizes the ribbons for every published interval, beyond one per 8 m of hole', () => {
    const many = ['R1', 'R2', 'R3'].map((id) => ({ ...read().results[2], resultId: id, fromM: 0, toM: 100 }));
    const cs = pubCallouts(many.concat(read().results.slice(0, 2)), holes);
    expect(ribbonPieces(cs)).toBe(3 * (13 + 1) + (64 + 1) + (8 + 1)); // three overlapping 100 m results on EX-014; EX-021's 508 m and its 60 m "incl."
    expect(ribbonPieces(cs.filter((c) => c.h.id === 'EX-014'))).toBeGreaterThan(Math.ceil(100 / 8) + 1); // more than the hole alone was given
  });

  it('rewords two results on one hole independently', () => {
    const ov = { 'EX14-01': { line1: '30 m of 0.61% Cu near surface', at: [40, 70] } }, cs = pubCallouts(results, holes, ov);
    expect(pubLines(cs.find((c) => c.key === 'EX14-01'), ov)).toEqual({ l1: '30 m of 0.61% Cu near surface', l1b: '', l2: null });
    expect(pubLines(cs.find((c) => c.key === 'EX14-02'), ov)).toEqual({ l1: '40 m @ 0.48% Cu', l1b: ' from 300 m', l2: null });
    // The "incl." line is the child's own wording.
    const ov2 = { 'EX21-01a': { line1: 'incl. 60 m of higher grade', at: [120, 180] } };
    expect(pubLines(pubCallouts(results, holes, ov2).find((c) => c.key === 'EX21-01'), ov2)).toEqual({ l1: LONG, l1b: '', l2: 'incl. 60 m of higher grade' });
  });

  it('never moves edited wording to other depths: it shows the approved text and says why', () => {
    const ov = { 'EX14-01': { line1: 'Reworded', at: [40, 70] }, 'EX99-01': { line1: 'Orphan', at: [1, 2] } };
    const moved = results.map((r) => (r.resultId === 'EX14-01' ? { ...r, toM: 75 } : r)), c = pubCallouts(moved, holes, ov).find((x) => x.key === 'EX14-01');
    expect(c.ic.broad).toMatchObject({ from: 40, len: 35 });
    expect(pubLines(c, ov).l1).toBe('30 m @ 0.61% Cu'); // the result's own text, not the wording written for 40–70 m
    expect(staleNotes(moved, ov)).toEqual(['EX14-01: your wording was written for 40–70 m; the result is now 40–75 m, so its approved text is shown. Retype it to keep yours.', 'Your wording for EX99-01 is kept, but no result EX99-01 is in the tables.']);
    expect(pubLines(c, { 'EX14-01': { line1: 'No depths recorded' } }).l1).toBe('30 m @ 0.61% Cu');
    // setCallout ties new wording to the depths it has now.
    const cur = {}; tie(cur, { line1: 'x' }, 'published', [40, 75]); expect(cur.at).toEqual([40, 75]);
  });
});

describe('release tables and the assays', () => {
  it('a release table is never read as assays (no colours, histogram or shell) nor taken for one on its own', () => {
    const e = { header, rows, cols: { hole: 1, from: 2, to: 3 } };
    expect(refineRole(e, 'assay', 'release.csv')).toBe('unknown');
    expect(e.hint).toBe('published');
    // An ordinary assay file is untouched.
    const a = { header: ['HoleID', 'From', 'To', 'Cu_pct'], rows: [['EX-1', '0', '2', '0.4']], cols: { hole: 0, from: 1, to: 2 } };
    expect(refineRole(a, 'assay', 'assays.csv')).toBe('assay'); expect(a.hint).toBeUndefined();
    // Only files the user marked as published results are read.
    expect(readFiles([{ ...file(), role: 'unknown' }, { ...file(), role: 'assay' }]).results).toEqual([]);
  });
});

describe('published results through save, share and history', () => {
  it('keep approved text verbatim through JSON (account save, share snapshot, sign-in stash)', () => {
    const project = { v: 1, settings: { calloutMode: 'published', pubOverrides: { 'EX14-01': { line1: '30.000 m @ 0.6100000000000001% Cu', at: [40, 70] } } }, files: [{ name: 'release.csv', text: TEXT, role: 'published', cols: COLS }] };
    const back = JSON.parse(JSON.stringify(project));
    expect(back.files[0].text).toBe(TEXT);
    const f = { ...back.files[0], header, rows: Papa.parse(back.files[0].text.trim(), { skipEmptyLines: true }).data.slice(1) };
    expect(readFiles([f]).results[0].approvedText).toBe(LONG);
    expect(back.settings.pubOverrides['EX14-01'].line1).toBe('30.000 m @ 0.6100000000000001% Cu');
    // The settings history compares and restores snapshots as they are.
    const H = createHistory({ a: 1 }); H.note(back.settings);
    expect(H.states[1].snap.pubOverrides['EX14-01'].line1).toBe('30.000 m @ 0.6100000000000001% Cu');
  });
});

describe('manual callouts', () => {
  const h = { id: 'EX-1', ints: [{ from: 0, to: 10, vals: { Cu: 1 } }, { from: 10, to: 20, vals: { Cu: 0.2 } }] };
  const avg = (hole, a, b) => { let m = 0, l = 0; hole.ints.forEach((it) => { const x = Math.max(a, it.from), y = Math.min(b, it.to); if (y > x) { m += it.vals.Cu * (y - x); l += y - x; } }); return l ? m / l : null; };
  it('shows only ticked holes, at the depths fixed when ticked, whatever the calculation does since', () => {
    const calc = [{ key: 'EX-1', h, ic: { broad: { from: 0, len: 20, mid: 10, avg: 0.6 }, incl: { from: 0, len: 10, avg: 1 } } }];
    const cur = { show: true }; tie(cur, { show: true }, 'manual', icAt(calc[0].ic));
    expect(cur.at).toEqual([0, 20, 0, 10]);
    tie(cur, { line1: 'Typed' }, 'manual', [0, 6]); expect(cur.at).toEqual([0, 20, 0, 10]); // rewording keeps the depths
    const out = manualCallouts([], [h], { 'EX-1': cur, 'EX-2': { show: true } }, avg); // the cut-offs no longer give EX-1 an interval
    expect(out).toHaveLength(1);
    expect(out[0].ic).toEqual({ broad: { from: 0, len: 20, mid: 10, avg: 0.6 }, incl: { from: 0, len: 10, mid: 5, avg: 1 } });
    expect(manualCallouts(calc, [h], { 'EX-1': { line1: 'not ticked' } }, avg)).toEqual([]);
    tie(cur, { show: false }, 'manual'); expect(cur.at).toBeUndefined();
  });
});
