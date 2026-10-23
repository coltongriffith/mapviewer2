import { notes, tableRows } from './drillResults.js';

// One publication snapshot for each table format. Values and wording come from
// the figure calculator; exports must not recalculate or add an approval status.
export function resultsTableSnapshot(out, recipe, { propertyName, recipeName, recipeVersion, unsaved = true, warnings = [] } = {}) {
  const rows = tableRows(out.results, out.columns);
  return {
    title: `${propertyName || 'Property'} — drill results`,
    provenance: unsaved
      ? `Unsaved recipe: ${recipeName || 'Default'}. Calculated from current assays.`
      : `Saved recipe: ${recipeName || 'Default'}, version ${recipeVersion}. Calculated from current assays.`,
    header: rows[0].map((c, i) => i === 1 ? 'Type' : c),
    rows: rows.slice(1),
    limitations: [...new Set([...(out.problems || []), ...warnings])],
    footnotes: notes(recipe, out.eq),
  };
}
