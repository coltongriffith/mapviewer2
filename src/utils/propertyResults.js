// Opt-in property recipe loader shared by the 2D and 3D source pickers. Existing
// figures keep their stored files; neither importing this module nor reading a
// newer recipe changes a figure. The caller applies the returned snapshot.
import { computeResults, notes, toPublishedFile } from '../../shared/drillResults.js';
import { pull } from '../three-d/property-data.js';
import { drillResultsDb } from './drillResultsDb.js';

export const RESULTS_FILE = 'property-recipe-results.csv';

/** undefined: Default or sole recipe; null: raw data only; string: exact saved name. */
export function selectRecipe(recipes, name) {
  if (name === null) return null;
  if (name !== undefined) {
    const found = recipes.find((r) => r.name === name);
    if (!found) throw new Error(`The saved recipe "${name}" is no longer available. Choose a recipe again.`);
    return found;
  }
  const preferred = recipes.find((r) => r.name === 'Default');
  if (preferred) return preferred;
  if (recipes.length <= 1) return recipes[0] || null;
  const error = new Error('This property has several saved recipes. Choose one, or load raw drill data only.');
  error.code = 'RECIPE_SELECTION_REQUIRED';
  error.recipes = recipes.map(({ name, version }) => ({ name, version }));
  throw error;
}

const identity = (r) => r ? JSON.stringify([r.id, r.name, r.version, r.recipe]) : null;

/** Only figures with a saved recipe snapshot participate in recipe update notices. */
export function recipeChange(ref, recipes) {
  const previous = ref?.resultsRecipe;
  if (!previous) return null;
  const current = recipes.find((r) => r.name === previous.name);
  if (identity(current) === identity(previous)) return null;
  return { name: previous.name, fromVersion: previous.version, toVersion: current?.version ?? null, missing: !current };
}

/**
 * Read current drill rows and a stable saved recipe, then freeze the exact table
 * wording/IDs into the existing figure interchange format. Its internal
 * "approved" flag is a parser convention, not publication or QP approval.
 * No recipe is created, saved or silently substituted for an explicit choice.
 */
export async function pullPropertyResults(sb, prop, { recipeName, onProgress = () => {}, tries = 2 } = {}) {
  if (recipeName === null) return pull(sb, prop, onProgress, tries);
  const db = drillResultsDb(sb);
  for (let attempt = 0; attempt < tries; attempt++) {
    const selected = selectRecipe(await db.recipes(prop.id), recipeName);
    const loaded = await pull(sb, prop, onProgress, tries);
    const after = selectRecipe(await db.recipes(prop.id), recipeName);
    // Recipes are versioned by name. Re-read rows as well if the chosen version
    // changed while pages were loading; never attach new metadata to old results.
    if (identity(selected) !== identity(after)) continue;
    if (!selected) return loaded;
    const { results, columns, problems } = computeResults(loaded.rows.assays, selected.recipe);
    if (problems.length) throw new Error(`Could not use the saved recipe "${selected.name}": ${problems.join(' ')}`);
    const source = `Calculated property results: ${prop.name || prop.id}; ${selected.name} v${selected.version}`;
    const file = toPublishedFile(results, columns, source, RESULTS_FILE);
    const resultsRecipe = structuredClone({ id: selected.id, name: selected.name, version: selected.version, recipe: selected.recipe, fileName: RESULTS_FILE });
    return { ...loaded, files: [...loaded.files, file], ref: { ...loaded.ref, resultsRecipe }, resultNotes: notes(selected.recipe), resultCount: results.length };
  }
  throw new Error('The saved recipe changed while the drill data was loading. Try again in a moment.');
}
