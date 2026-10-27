// Disclosure defaults for a figure filed under NI 43-101 (Canada) or S-K 1300 (US): pure checks the 2D export
// preflight runs (src/export/preflight.js gathers the facts) when a figure names its standard
// (layout.disclosureStandard).
//
// A checklist, not regulatory text. Both rules expect a report's maps and figures to be legible and to show a
// scale, a north arrow and the coordinate system, and to name their sources (NI 43-101: Form 43-101F1, its
// items on figures and drawings; S-K 1300: Items 1302 and 1304, the maps of the property), and their
// disclosure of drilling results and historical work to say when results are pending, whether lengths are true
// widths, and what is historical. The labels the fixes add are short and neutral; they go into the footer note
// (Footer / Disclaimer), where the user can edit or remove them like any other text.

import { diagnostic } from './figureDiagnostics.js';

export const STANDARDS = { ni43101: 'NI 43-101', sk1300: 'S-K 1300' };
export const LABELS = { pending: 'Assays pending', historical: 'Historical data', trueWidth: 'Lengths are core lengths; true widths are not known' };
const SOURCE = /\b(sources?|credits?|courtesy|after|data (from|by))\b|©/i;

export const standardOf = (layout) => (STANDARDS[layout?.disclosureStandard] ? layout.disclosureStandard : null);

// The footer note with one more label, " | " between (as the editor's footer notes are written).
export const withNote = (text, note) => [String(text || '').trim(), note].filter(Boolean).join(' | ');

/** A diagnostic's fix as a layout patch: { layout } as it is, { note } appended to the footer. */
export function applyFix(layout = {}, fix = {}) {
  return { ...(fix.layout || {}), ...(fix.note ? { footerText: withNote(layout.footerText, fix.note), footerEnabled: true } : {}) };
}

/**
 * Warnings for what a figure filed under `standard` leaves out. facts:
 *   scaleBar, northArrow  shown on the figure
 *   crs                   the coordinate system / datum text the figure states, or ''
 *   credits               source lines the export adds by itself (registry, overlays)
 *   texts                 the figure's own words: title, footer note, legend labels, callouts, map labels
 *   intercepts            drill intercepts (published results) are shown
 *   pending, historical   the figure shows holes with results pending / historical data
 */
export function disclosureChecks(standard, facts = {}) {
  const std = STANDARDS[standard];
  if (!std) return [];
  const texts = (facts.texts || []).filter(Boolean).map(String), says = (re) => texts.some((t) => re.test(t));
  const out = [];
  const warn = (code, message, action, fix) => out.push(diagnostic({ code, message: `${std}: ${message}`, action, fix }));
  if (!facts.scaleBar) warn('disclosure-scale-bar', 'the figure has no scale bar', 'add one', { label: 'Add scale bar', layout: { showScaleBar: true } });
  if (!facts.northArrow) warn('disclosure-north-arrow', 'the figure has no north arrow', 'add one', { label: 'Add north arrow', layout: { showNorthArrow: true } });
  if (!String(facts.crs || '').trim()) {
    warn('disclosure-crs', 'the figure does not state its coordinate system or datum', 'show the projection under the scale bar (Coordinate Frame & Datum)',
      { label: 'Add coordinate system note', layout: { showScaleBar: true, showProjectionLabel: true } });
  }
  if (!(facts.credits || []).length && !says(SOURCE)) warn('disclosure-sources', 'the figure does not name its data sources', 'name them in the footer note, such as “Source: …”');
  if (facts.pending && !says(/pending/i)) warn('disclosure-pending', 'holes with results pending are not labelled as such', `label them, or add “${LABELS.pending}” to the footer note`, { label: `Add “${LABELS.pending}”`, note: LABELS.pending });
  if (facts.intercepts && !says(/true\s+widths?/i)) {
    warn('disclosure-true-width', 'drill intercepts are shown without a note on true widths', 'say whether the lengths are true widths', { label: `Add “${LABELS.trueWidth}”`, note: LABELS.trueWidth });
  }
  if (facts.historical && !says(/histor/i)) warn('disclosure-historical', 'historical data is not labelled as historical', `label it, or add “${LABELS.historical}” to the footer note`, { label: `Add “${LABELS.historical}”`, note: LABELS.historical });
  return out;
}
