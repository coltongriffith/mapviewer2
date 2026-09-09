// How a feature's drawn style is resolved, in one place.
//
// Three layers of precedence, lowest first: the template's per-role defaults,
// the layer's own style, then anything the user set on that one feature. The
// editor map and both exporters must agree on this, and they did not: export
// merged the per-feature override for every geometry while the editor only
// read it for points, so a polygon given its own outline looked unchanged on
// screen and changed in the PNG. Both now call these.

export function getTemplateStyle(template, layer) {
  const base = template?.roleStyles?.[layer?.role] || template?.roleStyles?.other || {};
  return { ...base, ...(layer?.style || {}) };
}

export function getFeatureOverride(layer, key) {
  return key ? (layer?.featureOverrides?.[key] || {}) : {};
}

export function getFeatureStyle(template, layer, feature, key) {
  return { ...getTemplateStyle(template, layer), ...getFeatureOverride(layer, key) };
}

// The keys the per-shape styling panel writes. `hidden` and `markerShape`
// live beside them in the same override object and are owned by trim mode and
// the marker picker, so "reset this shape's style" must leave them alone.
export const FEATURE_STYLE_KEYS = ['stroke', 'fill', 'strokeWidth', 'dashArray', 'fillOpacity'];

export function hasFeatureStyle(override) {
  return !!override && FEATURE_STYLE_KEYS.some((k) => override[k] !== undefined);
}

export function stripFeatureStyle(override) {
  const out = { ...(override || {}) };
  for (const k of FEATURE_STYLE_KEYS) delete out[k];
  return out;
}

/** Number of features in a layer carrying their own style. */
export function styledFeatureCount(layer) {
  return Object.values(layer?.featureOverrides || {}).filter(hasFeatureStyle).length;
}
