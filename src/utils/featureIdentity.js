// One definition of "which feature is this", and which features are hidden.
//
// WHY THIS FILE EXISTS
//   The key that identifies a feature inside `layer.featureOverrides` was
//   written out three separate times — in App.jsx, in MapCanvas.jsx's
//   pointToLayer, and in export/renderScene.js as featureKeyExport. All three
//   agreed, by luck rather than by construction.
//
//   That is a dangerous shape for this particular value. The on-screen map and
//   the exported PDF resolve overrides independently, so the moment two copies
//   disagree a feature is styled one way on screen and another in the export —
//   or, now that overrides can HIDE a feature, removed from the map and still
//   printed in the client's deck. A silent divergence in the paid path is the
//   worst failure this feature could have, so there is one function.
//
// CLAIM IDENTITY
//   The original chain was drill-hole shaped: id → hole_id → holeid →
//   properties.id → properties.name → the geometry as JSON. Mineral claims
//   carry none of the first five. `properties.name` in particular is lowercase
//   and claim records publish CLAIM_NAME, so claims fell all the way through to
//   the coordinate blob — a multi-kilobyte string used as an object key and
//   saved into the project.
//
//   Claim names are not identities anyway. Of 42,382 B.C. titles: 9,376 (22%)
//   have no name at all, and 1,719 names are shared by more than one title.
//   Keying on the name would hide every cell that shares it.
//
//   So the registry identifiers come first. TENURE_NUMBER_ID is B.C.'s primary
//   key and is present on every title; TAG_NUMBER is the cross-jurisdiction
//   identifier api/claims.js normalizes to (B.C. tag, BLM serial, Saskatchewan
//   disposition, and so on). Neither exists on a drill-hole record, so putting
//   them first cannot change how an existing point layer keys.
//
//   The geometry fallback is kept BYTE-FOR-BYTE as it was. It is wasteful, but
//   it is what already-saved projects used, and quietly changing it would
//   orphan every per-feature style a user has set.

import { geojsonBounds } from './geometry';

/** Property names that identify a claim, in order of trustworthiness. */
const CLAIM_ID_FIELDS = ['TENURE_NUMBER_ID', 'TAG_NUMBER'];

/**
 * Stable identity for a feature within its layer.
 *
 * Returns null only for a null feature. Every real feature gets a key, because
 * a feature with no key could not be hidden, styled or restored.
 */
export function featureKey(feature) {
  if (!feature) return null;
  if (feature.id != null) return String(feature.id);

  const p = feature.properties || {};

  for (const field of CLAIM_ID_FIELDS) {
    const value = p[field];
    if (value != null && value !== '') return `${field}:${value}`;
  }

  return p.hole_id || p.holeid || p.id || p.name
    || JSON.stringify(feature.geometry?.coordinates);
}

/**
 * How a feature should read in a list.
 *
 * Separate from getFeatureLabel() in App.jsx, which is drill-hole shaped — it
 * ends at the LAYER's name and then the literal string 'Drillhole', which is
 * the right answer for a callout on a collar and useless in a list of 200
 * claims where every row would then read the same.
 *
 * A row has to be identifiable at a glance, so the title is whatever a person
 * would call the shape and the subtitle is what distinguishes two shapes that
 * share that name — which, for B.C. claims, is 1,719 names' worth of rows.
 */
export function featureLabel(feature) {
  const p = feature?.properties || {};
  const number = p.TENURE_NUMBER_ID ?? p.TAG_NUMBER ?? null;
  const name = p.CLAIM_NAME || p.label || p.name || p.hole_id || p.holeid || null;
  const hectares = Number(p.AREA_IN_HECTARES);

  const parts = [];
  if (number != null && number !== '') parts.push(`#${number}`);
  if (Number.isFinite(hectares) && hectares > 0) parts.push(`${Math.round(hectares).toLocaleString()} ha`);

  return {
    // An unnamed title is common — 22% of B.C. claims — so the number carries
    // the row rather than a blank or a repeated layer name.
    title: name || (number != null && number !== '' ? `Claim ${number}` : 'Unnamed shape'),
    subtitle: parts.join(' · '),
    // What a search types against. Includes both, so a user can find a claim by
    // its number when they cannot remember the name and vice versa.
    search: `${name || ''} ${number ?? ''}`.toLowerCase().trim(),
  };
}

/** Features of a layer, whatever shape its geojson takes. */
export function layerFeatures(layer) {
  const geojson = layer?.geojson;
  if (!geojson) return [];
  if (geojson.type === 'FeatureCollection') return geojson.features || [];
  if (geojson.type === 'Feature') return [geojson];
  return [];
}

/**
 * Has this feature been removed from the map by the user?
 *
 * Removal is a flag, not a deletion. The feature stays in `layer.geojson`, so
 * it can be restored without re-importing, a saved project keeps a complete
 * record of what was fetched, and a layer handed over from Tenure Monitor still
 * matches the portfolio it came from.
 */
export function isFeatureHidden(layer, feature) {
  const key = featureKey(feature);
  if (!key) return false;
  return layer?.featureOverrides?.[key]?.hidden === true;
}

/** How many features the user has removed from this layer. */
export function hiddenCount(layer) {
  const overrides = layer?.featureOverrides;
  if (!overrides) return 0;
  // Counted against the features actually present, so an override left behind
  // by a since-removed feature cannot inflate the number the UI shows.
  return layerFeatures(layer).filter((f) => isFeatureHidden(layer, f)).length;
}

/**
 * Does this layer still put anything on the map?
 *
 * A layer whose every feature has been removed is not "a layer with no style" —
 * it is absent. It must not claim a legend entry, because a legend is a promise
 * that what it names is somewhere on the page.
 *
 * A layer with no features at all is treated as absent too: an empty upload has
 * nothing to label either.
 */
export function hasVisibleFeatures(layer) {
  const features = layerFeatures(layer);
  if (!features.length) return false;
  if (!layer?.featureOverrides) return true;
  return features.some((f) => !isFeatureHidden(layer, f));
}

/**
 * Which features of a layer fall inside a dragged box.
 *
 * The test is the CENTRE of each feature, not any overlap with it. For the job
 * this exists to do — "drop the southern block, keep the northern one" — centre
 * containment is the predictable rule: a box drawn loosely around the south
 * group takes exactly the claims that sit in it, and a claim in the north whose
 * edge happens to clip the box is left alone. Overlap-based selection surprises
 * people in exactly that case, and mineral claims are laid out as a grid of
 * cells, so their centres are well separated.
 *
 * Already-hidden features are skipped, so dragging a box over a mixed area
 * reports only what it is about to change.
 *
 * @param bounds {minLng, minLat, maxLng, maxLat}
 */
export function featuresInBounds(layer, bounds) {
  if (!bounds) return [];
  return layerFeatures(layer).filter((feature) => {
    if (isFeatureHidden(layer, feature)) return false;
    const fb = geojsonBounds(feature);
    if (!fb) return false;
    const lng = (fb.minLng + fb.maxLng) / 2;
    const lat = (fb.minLat + fb.maxLat) / 2;
    return lng >= bounds.minLng && lng <= bounds.maxLng
      && lat >= bounds.minLat && lat <= bounds.maxLat;
  });
}

/**
 * The layer's geojson with removed features taken out.
 *
 * Returns the original object unchanged when nothing is hidden — both renderers
 * lean on that, and so does Leaflet's own layer diffing.
 */
export function visibleGeojson(layer) {
  if (!layer?.geojson || !layer.featureOverrides) return layer?.geojson;
  const features = layerFeatures(layer);
  const visible = features.filter((f) => !isFeatureHidden(layer, f));
  if (visible.length === features.length) return layer.geojson;
  return { ...layer.geojson, type: 'FeatureCollection', features: visible };
}
