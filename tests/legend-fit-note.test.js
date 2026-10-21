import { describe, it, expect } from 'vitest';
import { resolveTemplateZones } from '../src/templates/technicalResultsTemplate.js';
import { legendContentHeight, legendPanelHeight, legendNoteLines, noteInLegend, legendRowCount } from '../src/utils/legendCustomization.js';
import { exportFooterBox, creditLinesFor, renderLegendSvg } from '../src/export/renderScene.js';
import { createInitialProjectState } from '../shared/projectState.js';

// The 2D standard layout (logo and title top left, legend bottom left, locator top right, north arrow and
// scale bar): the footer note always exported, a standalone map's note in the legend, and the legend fitted
// to its entries for new maps while a saved map keeps its size.

const items = [
  { id: 'c', label: 'Claims', type: 'polygon', group: 'Property', style: { fill: '#f59e0b', stroke: '#b45309' } },
  { id: 'd', label: 'Drill collars', type: 'points', group: 'Drilling', style: { fill: '#111', stroke: '#fff' } },
  { id: 't', label: 'Drill traces', type: 'line', group: 'Drilling', style: { stroke: '#111' } },
];
const base = createInitialProjectState().layout;
const saved = (over = {}) => { const { legendFit, ...rest } = base; return { ...rest, legendItems: items, ...over }; }; // a map saved before legendFit
const zones = (layout) => resolveTemplateZones({ id: 'technical_results_v2' }, layout, { width: 1600, height: 1000 }, items);
const scene = (layout) => ({ width: 1600, height: 1000, template: { id: 'technical_results_v2' }, project: { layout, layers: [] } });
const hits = (a, b) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

describe('legend size', () => {
  it('a saved map keeps its legend height; a new map fits the legend to its entries', () => {
    const rows = legendRowCount(items, saved()); // entries, plus headings when grouped
    expect(zones(saved()).legend.height).toBe(Math.max(110, 58 + rows * 30));
    expect(base.legendFit).toBe(true);
    const fit = zones({ ...base, legendItems: items }).legend.height;
    expect(fit).toBe(legendContentHeight(items, base));
    expect(fit).toBeLessThan(zones(saved()).legend.height); // no empty band under the last row
    expect(zones(saved({ legendFit: true })).legend.height).toBe(fit); // a saved map that opts in
  });
  it('a dragged height still wins, never below the entries', () => {
    expect(zones(saved({ legendHeightPx: 400 })).legend.height).toBe(400);
    expect(zones(saved({ legendHeightPx: 20 })).legend.height).toBe(legendContentHeight(items, saved()));
    expect(legendPanelHeight([], base, 0)).toBe(0);
  });
});

describe('the footer note', () => {
  const note = 'Source: Tower Resources drilling database, 2026; claims from BC Mineral Titles Online.';
  it('finds room along the bottom edge in the standard layout, clear of the legend, scale bar and north arrow', () => {
    const z = zones(saved({ footerText: note })), box = exportFooterBox(scene(saved({ footerText: note })));
    expect(z.footer.width).toBe(0); // the template's strip collides (editor unchanged); the export finds another
    expect(box.width).toBeGreaterThanOrEqual(160);
    for (const k of ['legend', 'scaleBar', 'northArrow']) expect(hits(box, z[k]), k).toBe(false);
    expect(exportFooterBox(scene(saved({ footerText: note })))).toMatchObject({ text: note, lines: [note] }); // one line where it fits
    expect(creditLinesFor(scene(saved({ footerText: note })))).not.toContain(note); // drawn once, in the footer
  });
  it('is printed with the source credit where no footer strip fits', () => {
    const narrow = { ...scene(saved({ footerText: note })), width: 560 };
    expect(exportFooterBox(narrow)).toBeNull();
    expect(creditLinesFor(narrow)).toContain(note);
    expect(creditLinesFor(scene(saved({ footerText: note, footerEnabled: false })))).not.toContain(note); // hidden on purpose
  });
  it('goes in the legend of a standalone map, not the footer or the credit', () => {
    const L = saved({ footerText: note, mapUse: 'standalone' });
    expect(noteInLegend(L)).toBe(true);
    expect(noteInLegend({ ...L, mapUse: 'presentation' })).toBe(false);
    expect(noteInLegend({ ...L, templateId: 'side_panel' })).toBe(false);
    expect(exportFooterBox(scene(L))).toBeNull();
    expect(creditLinesFor(scene(L))).not.toContain(note);
    const lines = legendNoteLines(L);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(note);
    expect(legendContentHeight(items, L)).toBe(legendContentHeight(items, saved()) + 8 + lines.length * 14);
    expect(zones(L).legend.height).toBe(zones(saved()).legend.height + 8 + lines.length * 14);
    const svg = renderLegendSvg(scene({ ...L, legendItems: items }), 1, []);
    expect(svg.match(/class="em-legend-note"/g)).toHaveLength(lines.length);
    expect(svg).toContain('Tower Resources');
  });
  it('stays in the footer when a standalone map draws no legend (hidden, or no entries)', () => {
    for (const L of [saved({ footerText: note, mapUse: 'standalone', showLegend: false }), saved({ footerText: note, mapUse: 'standalone', legendItems: [] })]) {
      expect(noteInLegend(L)).toBe(false);
      expect(legendNoteLines(L)).toEqual([]);
      const s = scene(L), box = exportFooterBox(s);
      expect(box?.text === note || creditLinesFor(s).includes(note)).toBe(true); // exported, in the footer or with the credit
    }
    expect(exportFooterBox(scene(saved({ footerText: note, mapUse: 'standalone', showLegend: false })))).toMatchObject({ text: note });
  });
  it('wraps the note to a narrower strip (800 px standard map), else falls back to the source credit', () => {
    const s800 = { ...scene(saved({ footerText: note })), width: 800 };
    const box = exportFooterBox(s800);
    expect(box.lines.length).toBe(2);
    expect(box.lines.join(' ')).toBe(note);
    for (const t of box.lines) expect(t.length * 6).toBeLessThanOrEqual(box.width - 24); // fits the strip (estimated in jsdom)
    expect(box.left + box.width).toBeLessThanOrEqual(800 - 22);
    expect(creditLinesFor(s800)).not.toContain(note);
    const long = `${note} ${note} ${note}`, sl = { ...scene(saved({ footerText: long })), width: 800 };
    expect(exportFooterBox(sl)).toBeNull(); // three or more lines: not squeezed into the strip
    expect(creditLinesFor(sl)).toContain(long);
  });
});
