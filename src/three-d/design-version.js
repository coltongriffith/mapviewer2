// Figure design versions for Exploration Maps 3D. A figure keeps the look it was made with: S.designVersion
// is saved with it (getProject), new figures take DESIGN_VERSION, and a saved figure without one is version 1
// (made before the October 2026 design rounds). A later round that changes a default or a drawing rule bumps
// DESIGN_VERSION, puts the earlier values in a LEGACY_V<n> table and lists its new behaviours in FEATURES.

export const DESIGN_VERSION = 2;

// Version 1 settings: what a figure saved before version 2 had when a setting did not exist yet. Applied
// only to settings the saved figure lacks (nested objects key by key), before today's defaults fill the rest.
export const LEGACY_V1 = {
  imagery: { saturation: 1.15, contrast: 1, warmth: 0, relief: 0 }, // the fixed satellite tone, no relief blend
  legend: { merge: 'separate', pos: { main: 'br' } }, // the assay card bottom right, layer cards beside it
  shell: { color: '#1f9e96', throughTerrain: false },
  geology: { strength: 1, hidden: 'clear' }, // legend colours as picked; hidden codes left unpainted
  tags: { emphasis: 'none', highlightNew: false, idMode: 'all' }, // every hole the same, every ID shown
};

// Drawing rules that arrived with a version: on for figures of that version or later, or taken early by a
// figure (S.designOptIn, an undoable setting, such as the callouts' "Recalculate").
export const FEATURES = {
  imageryRelief: 2, // satellite imagery always shaded by the tone settings (else by the earlier fixed hillshade at relief 0)
  footerBand: 2, // a white footer band, notes on one wrapped line
  brandHeadings: 2, // legend headings in the brand colour
  greyFade: 2, // faded holes grey rather than washed out
  clearNearWalls: 2, // near faces drop their veil while a face is painted
  holeTags: 2, // collar pills for the holes with a status, pending tags grouped by distance and labelled by year
  sampledIntercepts: 2, // callout intervals never span an unsampled gap or count an overlap twice
};
export const uses = (S, f) => (S.designVersion || 1) >= FEATURES[f] || !!S.designOptIn?.includes(f);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// Saved settings to the full settings loadProject puts into S.
export function withDefaults(saved, defaults) {
  const v = Number.isInteger(saved.designVersion) && saved.designVersion > 0 ? saved.designVersion : 1, out = { ...defaults, ...saved, designVersion: v };
  if (v < 2) Object.entries(LEGACY_V1).forEach(([k, L]) => { const s = saved[k]; if (s === undefined || isObj(s)) out[k] = { ...defaults[k], ...structuredClone(L), ...s }; });
  return out;
}
