import { describe, it, expect } from 'vitest';
import { disclosureChecks, applyFix, withNote, standardOf, LABELS } from '../shared/disclosure.js';

// Disclosure defaults (shared/disclosure.js): what an NI 43-101 or S-K 1300 figure leaves out, and the fixes.
const FULL = { scaleBar: true, northArrow: true, crs: 'NAD83 / UTM Zone 10N', credits: [], texts: ['Source: BC MTO, 2026'] };
const codes = (list) => list.map((d) => d.code);

describe('disclosureChecks', () => {
  it('asks nothing of a figure without a standard, or of a complete one', () => {
    expect(disclosureChecks(null, {})).toEqual([]);
    expect(disclosureChecks('iso', {})).toEqual([]);
    expect(disclosureChecks('ni43101', FULL)).toEqual([]);
    expect(disclosureChecks('sk1300', { ...FULL, texts: [], credits: ['Claims: BC Mineral Titles Online'] })).toEqual([]);
  });

  it('warns on a missing scale bar, north arrow, coordinate system and sources, naming the standard', () => {
    const list = disclosureChecks('sk1300', { texts: ['Rails project'] });
    expect(codes(list)).toEqual(['disclosure-scale-bar', 'disclosure-north-arrow', 'disclosure-crs', 'disclosure-sources']);
    expect(list.every((d) => d.severity === 'warning' && d.message.startsWith('S-K 1300: '))).toBe(true);
    expect(list.map((d) => d.fix?.layout)).toEqual([{ showScaleBar: true }, { showNorthArrow: true }, { showScaleBar: true, showProjectionLabel: true }, undefined]);
    expect(disclosureChecks('ni43101', { ...FULL, crs: '  ' })[0].message).toBe('NI 43-101: the figure does not state its coordinate system or datum');
  });

  it('asks for pending, true-width and historical labels only where the figure shows them', () => {
    expect(disclosureChecks('ni43101', { ...FULL, pending: true, intercepts: true, historical: true }).map((d) => [d.code, d.fix.note])).toEqual([
      ['disclosure-pending', LABELS.pending], ['disclosure-true-width', LABELS.trueWidth], ['disclosure-historical', LABELS.historical]]);
    const said = { ...FULL, pending: true, intercepts: true, historical: true, texts: ['Source: company data', 'DDH-4 assays pending', 'True widths are estimated at 80%', 'Historical drilling (1987)'] };
    expect(disclosureChecks('ni43101', said)).toEqual([]);
  });
});

describe('fixes', () => {
  it('appends a label to the footer note and turns the footer on; layout fixes apply as they are', () => {
    expect(withNote('', 'Assays pending')).toBe('Assays pending');
    expect(withNote(' Source: MTO ', 'Assays pending')).toBe('Source: MTO | Assays pending');
    expect(applyFix({ footerText: 'Source: MTO', footerEnabled: false }, { label: 'x', note: LABELS.trueWidth }))
      .toEqual({ footerText: `Source: MTO | ${LABELS.trueWidth}`, footerEnabled: true });
    expect(applyFix({}, { label: 'Add scale bar', layout: { showScaleBar: true } })).toEqual({ showScaleBar: true });
  });

  it('reads the standard from the layout', () => {
    expect(standardOf({ disclosureStandard: 'ni43101' })).toBe('ni43101');
    expect(standardOf({ disclosureStandard: 'other' })).toBe(null);
    expect(standardOf(undefined)).toBe(null);
  });
});
