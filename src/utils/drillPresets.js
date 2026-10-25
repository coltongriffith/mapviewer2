// Vendor import presets (shared/drillPresets.json): which one a file's header
// matches, and its mapping laid over the file's own. Offered, never applied
// unasked, so a saved template or a hand-made mapping is not replaced.
import data from '../../shared/drillPresets.json';
import { applyTemplate } from './drillDb.js';

export const PRESETS = data.presets;
const norm = (h) => String(h).toLowerCase().replace(/[\s\-.()/#]+/g, '_').replace(/^_+|_+$/g, '');

/** The one preset whose required headers are all in `header` and that names the most of its columns; null on a tie. */
export function detectPreset(header, presets = PRESETS) {
  const have = new Set(header.map(norm));
  const scored = presets.flatMap((p) => {
    if (!p.required?.length || !p.required.every((h) => have.has(norm(h)))) return [];
    const named = [...p.required, ...Object.values(p.columns || {}), ...(p.elements || []).map((e) => e.column)];
    return [{ p, score: new Set(named.map(norm).filter((h) => have.has(h))).size }];
  }).sort((a, b) => b.score - a.score);
  return scored.length && scored[0].score !== scored[1]?.score ? scored[0].p : null;
}

/** `base` (autoMapping for preset.kind) with the preset's columns, elements and missing codes taking precedence. */
export function presetMapping(preset, header, base) {
  const t = applyTemplate({ columns: preset.columns || {}, elements: preset.elements || [] }, header);
  const taken = new Set(Object.values(t.columns));
  const columns = { ...Object.fromEntries(Object.entries(base.columns || {}).filter(([, c]) => !taken.has(c))), ...t.columns };
  const out = { ...base, columns, preset: preset.id, ...(preset.missing ? { missing: preset.missing.map(String) } : {}) };
  if (base.elements) {
    const by = new Map(t.elements.map((e) => [e.column, e]));
    out.elements = base.elements.filter((e) => !taken.has(e.column))
      .map((e) => (by.has(e.column) ? { ...e, name: by.get(e.column).name || e.name, unit: by.get(e.column).unit ?? e.unit, skip: undefined } : e));
  }
  return out;
}
