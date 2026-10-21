// A thin client over supabase/migrations/20261028100000_drill_intercepts.sql (the property's results
// recipes) and the current assays the results are computed from (drill_assays, current rows only).
// Loaded with the Results section of the Drill data tab.

import { drillError } from './drillDb';

export const PAGE = 1000;
export const MAX_ASSAYS = 200000;

const MESSAGES = [
  [/RECIPE_CONFLICT/, 'Someone saved a newer version of this recipe while you were editing. Reload the results to see it, then make your change again.'],
  [/INVALID_RECIPE: (.*)/, (m) => `The recipe was not saved: ${m[1]}.`],
  [/TOO_MANY_RECIPES: (.*)/, (m) => `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)}.`],
];
function recipeError(err) {
  const msg = String(err?.message || err || '');
  for (const [re, out] of MESSAGES) { const m = msg.match(re); if (m) { const e = new Error(typeof out === 'function' ? out(m) : out); e.code = msg.match(/^[A-Z_]{4,}/)?.[0]; return e; } }
  return drillError(err);
}

export function drillResultsDb(sb) {
  if (!sb) throw new Error('Drill results need an Exploration Maps account, which is not available on this site right now.');
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw recipeError(error); return data; };
  return {
    /** Current recipes by name, each with recipe, version and versions. */
    recipes: (propertyId) => rpc('drill_property_recipes', { p_property: propertyId }),
    /** Saves a new version; baseVersion (0 for a new name) refuses it if someone saved meanwhile. */
    save: (propertyId, name, recipe, baseVersion = null) => rpc('drill_save_recipe', { p_property: propertyId, p_name: name, p_recipe: recipe, p_base_version: baseVersion }),
    /** The property's current assays, a page at a time: { rows, capped }. */
    async assays(propertyId, max = MAX_ASSAYS) {
      const rows = [];
      for (let at = 0; at < max; at += PAGE) {
        const { data, error } = await sb.from('drill_assays').select('hole_id,from_m,to_m,values,bdl,units')
          .eq('property_id', propertyId).is('superseded_by_batch', null)
          .order('hole_id').order('from_m').order('to_m').range(at, at + PAGE - 1);
        if (error) throw drillError(error);
        rows.push(...(data || []));
        if (!data || data.length < PAGE) return { rows, capped: false };
      }
      return { rows, capped: true };
    },
  };
}

/** The elements stored in the assays and each one's most common unit. */
export function storedElements(rows) {
  const count = new Map();
  for (const r of rows) {
    for (const el of new Set([...Object.keys(r.values || {}), ...Object.keys(r.bdl || {})])) {
      const u = r.units?.[el] || '', m = count.get(el) || new Map();
      m.set(u, (m.get(u) || 0) + 1); count.set(el, m);
    }
  }
  const units = {};
  count.forEach((m, el) => { const [u] = [...m.entries()].filter(([k]) => k).sort((a, b) => b[1] - a[1])[0] || []; if (u) units[el] = u; });
  return { elements: [...count.keys()].sort((a, b) => a.localeCompare(b)), units };
}
