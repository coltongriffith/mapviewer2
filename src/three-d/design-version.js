// Figure design versions for Exploration Maps 3D. A figure keeps the look it was made with: S.designVersion
// is saved with it (getProject), new figures take DESIGN_VERSION, and a saved figure without one is version 1
// (made before the October 2026 design rounds). A later round that changes a default or a drawing rule bumps
// DESIGN_VERSION, puts the earlier values in a LEGACY_V<n> table and lists its new behaviours in FEATURES.

export const DESIGN_VERSION = 3;

// Version 1 settings: what a figure saved before version 2 had when a setting did not exist yet. Applied
// only to settings the saved figure lacks (nested objects key by key), before today's defaults fill the rest.
export const LEGACY_V1 = {
  imagery: { saturation: 1.15, contrast: 1, warmth: 0, relief: 0 }, // the fixed satellite tone, no relief blend
  legend: { merge: 'separate', pos: { main: 'br' } }, // the assay card bottom right, layer cards beside it
  shell: { color: '#1f9e96', throughTerrain: false },
  geology: { strength: 1, hidden: 'clear' }, // legend colours as picked; hidden codes left unpainted
  tags: { emphasis: 'none', highlightNew: false, idMode: 'all' }, // every hole the same, every ID shown
};

// Version 2 settings (and version 1's, after LEGACY_V1): what a figure saved before version 3 (round 5) had.
// Glass shells, no terrain shadows, hollows or haze under the old hillshade sun, the grey block outline, plain
// geology faces without contact lines, names or cleaning, and labels kept where they were placed.
export const LEGACY_V2 = {
  shell: { shading: 'glass' },
  scene: { sunAz: 315, sunAlt: 45, shadow: 0, ao: 0, haze: 0, theme: 'light', edge: '#8f9a9f' },
  geology: { contacts: false, labels: false, clean: false },
  autoLabels: false,
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
  clearLeaders: 3, // arrows routed around cards; pills, brackets and boxes beside a hole keep off leaders and markers
};
export const uses = (S, f) => (S.designVersion || 1) >= FEATURES[f] || !!S.designOptIn?.includes(f);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// Saved settings to the full settings loadProject puts into S.
// Each legacy table older than the figure's version applies, oldest first; settings the figure saved win.
export function withDefaults(saved, defaults) {
  const v = Number.isInteger(saved.designVersion) && saved.designVersion > 0 ? saved.designVersion : 1, out = { ...defaults, ...saved, designVersion: v }, was = {};
  [[2, LEGACY_V1], [3, LEGACY_V2]].forEach(([n, T]) => { if (v < n) Object.entries(T).forEach(([k, L]) => { was[k] = isObj(L) ? { ...was[k], ...structuredClone(L) } : L; }); });
  Object.entries(was).forEach(([k, L]) => { const s = saved[k]; if (!isObj(L)) { if (s === undefined) out[k] = L; } else if (s === undefined || isObj(s)) out[k] = { ...defaults[k], ...L, ...s }; });
  return out;
}
