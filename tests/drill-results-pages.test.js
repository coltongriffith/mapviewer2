// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { computeResults, defaultRecipe, tableRows, notes } from '../shared/drillResults.js';
import { resultsTableSnapshot } from '../shared/drillResultsTable.js';
import { layoutResultsPages, wrapResultsText, RESULTS_PAGE } from '../shared/drillResultsPages.js';

// Deterministic layout checks; real browser glyph metrics and PNG/PDF downloads in e2e.
const measure = (text, size) => Array.from(text).length * size * 0.6;
const recipe = { ...defaultRecipe(['Au'], { Au: 'g/t' }), minLength: 1, inclCutoff: 1, inclMinLength: 1, trueWidth: 'True widths are unknown.' };
const assay = (hole, i = 0, value = 0.4) => ({ hole_id: hole, from_m: i, to_m: i + 1, values: { Au: value }, units: { Au: 'g/t' }, bdl: {} });
const options = { propertyName: 'Synthetic - not Tower', recipeName: 'Release', recipeVersion: 7, unsaved: false };
const snapshot = () => resultsTableSnapshot(computeResults([assay('0001'), assay('0001', 1, 1.4), assay('0001', 2)], recipe), recipe, options);
const rows = pages => pages.flatMap(p => p.blocks.filter(b => b.kind === 'row' && !b.header));
const allText = pages => pages.flatMap(p => p.blocks.flatMap(b => b.kind === 'text' ? b.lines : b.cells.flat())).join('\n');

describe('results page layout', () => {
  it('preserves exact formatted numbers, leading zeros, inclusions and figure wording', () => {
    const snap = snapshot(), pages = layoutResultsPages(snap, measure);
    expect(rows(pages).map(r => r.cells.map(lines => lines.join('')))).toEqual(snap.rows);
    expect(rows(pages)[1].cells[1].join('')).toBe('incl.');
    expect(allText(pages)).toContain('Saved recipe: Release, version 7. Calculated from current assays.');
    for (const text of notes(recipe, null)) expect(allText(pages).replaceAll('\n', '')).toContain(text);
  });
  it('wraps long unbroken IDs, literal markup and Unicode without lost characters', () => {
    for (const text of ['a'.repeat(300), '=HYPERLINK("<>&")', 'µg/t × Au — 🪨 ']) {
      const lines = wrapResultsText(text, 80, measure);
      expect(lines.join('')).toBe(text);
      expect(lines.every(l => measure(l, 10) <= 80)).toBe(true);
    }
  });
  it('paginates 1,000 synthetic holes with repeated headers and no skipped rows', () => {
    const out = computeResults(Array.from({ length: 1000 }, (_, i) => assay(`S${i}`)), recipe);
    const pages = layoutResultsPages(resultsTableSnapshot(out, recipe, options), measure);
    expect(pages.length).toBeGreaterThan(20);
    expect(rows(pages).map(r => r.cells.map(lines => lines.join('')))).toEqual(tableRows(out.results, out.columns).slice(1));
    for (const p of pages) {
      if (p.blocks.some(b => b.rowIndex !== undefined)) expect(p.blocks.some(b => b.header)).toBe(true);
      for (const b of p.blocks) {
        const h = b.kind === 'row' ? b.height : b.lines.length * b.lineHeight;
        expect(b.y + h).toBeLessThanOrEqual(RESULTS_PAGE.height - RESULTS_PAGE.margin - 16);
      }
    }
  });
  it('groups wide tables while retaining every grade and repeating identity/depth/interval', () => {
    const snap = snapshot();
    snap.header.splice(5, 1, ...Array.from({ length: 13 }, (_, i) => `Element${i} (g/t)`));
    snap.rows = snap.rows.map(row => [...row.slice(0, 5), ...Array.from({ length: 13 }, (_, i) => `0.${i}0`), row.at(-1)]);
    const pages = layoutResultsPages(snap, measure), actual = rows(pages);
    expect(actual).toHaveLength(snap.rows.length * 4);
    for (let r = 0; r < snap.rows.length; r++) {
      const recovered = [];
      for (const b of actual.filter(b => b.rowIndex === r)) b.indices.forEach((index, i) => { recovered[index] = b.cells[i].join(''); });
      expect(recovered).toEqual(snap.rows[r]);
    }
  });
  it('includes unsaved provenance, long warnings and long true-width notes without clipping', () => {
    const snap = snapshot();
    snap.provenance = 'Unsaved recipe: Draft. Calculated from current assays.';
    snap.limitations = ['Incomplete assay load. '.repeat(1000)];
    snap.footnotes.push('True-width note. '.repeat(1000));
    const pages = layoutResultsPages(snap, measure);
    expect(allText(pages)).toContain(snap.provenance);
    // Remove the repeated page masthead before checking cross-page paragraphs.
    const text = pages.flatMap(p => p.blocks.slice(2).flatMap(b => b.kind === 'text' ? b.lines : b.cells.flat())).join('');
    expect(text).toContain(snap.limitations[0]);
    expect(text).toContain(snap.footnotes.at(-1));
  });
  it('refuses impossible rows/names/page counts instead of clipping or freezing', () => {
    const snap = snapshot();
    expect(() => layoutResultsPages({ ...snap, title: 'x'.repeat(10000) }, measure)).toThrow('Download HTML or Excel');
    expect(() => layoutResultsPages({ ...snap, rows: [snap.rows[0].map((x, i) => i ? x : 'x'.repeat(10000))] }, measure)).toThrow('too tall');
    expect(() => layoutResultsPages({ ...snap, rows: Array.from({ length: 10000 }, () => snap.rows[0]) }, measure)).toThrow('exceeds 100 pages');
  });
});
