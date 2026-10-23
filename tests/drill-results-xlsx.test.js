// @vitest-environment node
import { describe, it, expect } from 'vitest';
import readExcelFile from 'read-excel-file/node';
import { unzipSync, strFromU8 } from 'fflate';
import { resultsTableXlsx } from '../src/utils/drillResultsXlsx.js';
import { computeResults, defaultRecipe, tableRows, notes, toPublishedRecords } from '../shared/drillResults.js';

// Entirely synthetic. These are not Tower positions or grades.
const recipe = { ...defaultRecipe(['Au'], { Au: 'g/t' }), minLength: 1, inclCutoff: 1, inclMinLength: 1, trueWidth: 'True widths are unknown.' };
const assays = (hole = '0001') => [0.4, 1.4, 0.4].map((v, i) => ({ hole_id: hole, from_m: i, to_m: i + 1, values: { Au: v }, units: { Au: 'g/t' }, bdl: {} }));
const options = { propertyName: 'Synthetic test property', recipeName: 'Release', recipeVersion: 7, unsaved: false };
const read = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sheets = await readExcelFile(Buffer.from(bytes), { trim: false });
  return { data: sheets[0].data, files: unzipSync(bytes), sheets };
};

describe('Excel results publication snapshot', () => {
  it('round-trips the exact formatted cells, inclusion IDs and figure wording', async () => {
    const out = computeResults(assays(), recipe);
    const blob = await resultsTableXlsx(out, recipe, options);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const { data, files, sheets } = await read(blob);
    expect(sheets.map(s => s.sheet)).toEqual(['Drill results']);
    const canonical = tableRows(out.results, out.columns);
    expect(data[2]).toEqual(canonical[0].map((v, i) => i === 1 ? 'Type' : v));
    const actual = data.slice(3, 3 + canonical.length - 1).map(row => row.map(v => v ?? ''));
    expect(actual).toEqual(canonical.slice(1));
    expect(actual[0][0]).toBe('0001');
    expect(actual[1][0]).toBe('0001');
    expect(actual[1][1]).toBe('incl.');
    expect(actual.map(row => row.at(-1))).toEqual(toPublishedRecords(out.results, out.columns).map((r, i) => `${i ? 'incl. ' : ''}${r.approvedText}`));
    expect(data.flat()).toEqual(expect.arrayContaining(notes(recipe, out.eq)));
    const xml = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(xml).toContain('state="frozen"');
    expect(xml).toContain('ySplit="3"');
    expect(xml).not.toMatch(/<f[ >]/);
  });

  it.each([false, true])('retains provenance and capped/invalid-data warnings (unsaved=%s)', async (unsaved) => {
    const out = { ...computeResults(assays(), recipe), problems: ['An interval was skipped.'] };
    const warning = 'Incomplete assay load: only the first 200,000 assays are included.';
    const { data } = await read(await resultsTableXlsx(out, recipe, { ...options, unsaved, warnings: [warning] }));
    expect(data[1][0]).toBe(unsaved ? 'Unsaved recipe: Release. Calculated from current assays.' : 'Saved recipe: Release, version 7. Calculated from current assays.');
    expect(data[2][0]).toBe('Data limitation: An interval was skipped.');
    expect(data[3][0]).toBe(`Data limitation: ${warning}`);
    expect(data[4][0]).toBe('Hole ID');
  });

  it('keeps formula-like user text literal and escapes markup without external links', async () => {
    const attack = '=HYPERLINK("https://invalid.example","<tag>&")';
    const out = computeResults(assays(attack), { ...recipe, trueWidth: attack });
    const { data, files } = await read(await resultsTableXlsx(out, { ...recipe, trueWidth: attack }, { ...options, propertyName: attack, recipeName: attack }));
    expect(data[0][0]).toBe(`${attack} — drill results`);
    expect(data[3][0]).toBe(attack);
    expect(data.flat()).toContain(attack);
    expect(Object.keys(files).some(name => /externalLinks/.test(name))).toBe(false);
    expect(strFromU8(files['xl/worksheets/sheet1.xml'])).not.toMatch(/<f[ >]|<hyperlink[ >]/);
  });

  it('refuses cells beyond Excel capacity rather than silently truncating them', async () => {
    await expect(resultsTableXlsx(computeResults(assays(), recipe), recipe, { propertyName: 'x'.repeat(32768) })).rejects.toThrow('too long for Excel');
  });

  it('writes and reads a larger synthetic table without dropping rows', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ ...assays()[0], hole_id: `S${String(i).padStart(4, '0')}` }));
    const out = computeResults(rows, recipe);
    expect(out.results).toHaveLength(2000);
    const { data } = await read(await resultsTableXlsx(out, recipe, options));
    const actual = data.slice(3, 2003).map(row => row.map(v => v ?? ''));
    expect(actual).toEqual(tableRows(out.results, out.columns).slice(1));
    expect(data[2004][0]).toBe('Recipe notes');
  });
});
