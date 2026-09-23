// How a feature's drawn style is resolved, in one place.
//
// Three layers of precedence, lowest first: the template's per-role defaults,
// the layer's own style, then anything the user set on that one feature. The
// editor map and both exporters must agree on this, and they did not: export
// merged the per-feature override for every geometry while the editor only
// read it for points, so a polygon given its own outline looked unchanged on
// screen and changed in the PNG. Both now call these.

import { POINT_ROLES } from '../projectState.js';
import { isClassified, classStyle, geometryKind } from './classification.js';

export function getTemplateStyle(template, layer) {
  const base = template?.roleStyles?.[layer?.role] || template?.roleStyles?.other || {};
  return { ...base, ...(layer?.style || {}) };
}

export function getFeatureOverride(layer, key) {
  return key ? (layer?.featureOverrides?.[key] || {}) : {};
}

export function getFeatureStyle(template, layer, feature, key) {
  const base = getTemplateStyle(template, layer);
  // A classification (colour by attribute) sits between the layer's style and
  // the one-off override a user gave a single feature.
  const cls = isClassified(layer)
    ? classStyle(layer.classification, feature, (layer.type === 'points' || POINT_ROLES.has(layer.role)) && geometryKind(feature, layer) === 'points' ? 'points' : geometryKind(feature, layer))
    : null;
  return { ...base, ...(cls || {}), ...getFeatureOverride(layer, key) };
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

/**
 * Whether "dissolve inner borders" can be honoured. Dissolving merges every
 * polygon into one outline with no properties, so a layer coloured by
 * attribute or with individually styled shapes would lose exactly what the
 * user set; the outlines stay separate until those are cleared.
 */
export function canDissolve(layer) {
  return !!layer?.style?.dissolve && !isClassified(layer) && styledFeatureCount(layer) === 0;
}

/** Number of features in a layer carrying their own style. */
export function styledFeatureCount(layer) {
  return Object.values(layer?.featureOverrides || {}).filter(hasFeatureStyle).length;
}

/** Features in a layer carrying their own point size. */
export function sizedFeatureCount(layer) {
  return Object.values(layer?.featureOverrides || {}).filter((o) => Number.isFinite(o?.markerSize)).length;
}

/**
 * "Scale all points": multiply the layer size, every explicit class size and
 * every per-feature size by `factor`, so relative differences survive. Nothing
 * is dropped — overrides stay overrides, just scaled. Sizes are the symbol
 * diameter in CSS px (utils/pointSymbol.js).
 * → { style, classification, featureOverrides } patch for updateLayer.
 */
export function scalePointSizes(layer, factor, { base = 8, min = 1, max = 64 } = {}) {
  const k = Number(factor);
  if (!layer || !Number.isFinite(k) || k <= 0) return {};
  const scale = (v) => Math.max(min, Math.min(max, Math.round(v * k * 10) / 10));
  const patch = { style: { markerSize: scale(Number(layer.style?.markerSize) || base) } };
  if (layer.classification?.classes?.some((c) => Number.isFinite(c?.size))) {
    patch.classification = {
      ...layer.classification,
      classes: layer.classification.classes.map((c) => (Number.isFinite(c?.size) ? { ...c, size: scale(c.size) } : c)),
    };
  }
  if (sizedFeatureCount(layer)) {
    patch.featureOverrides = Object.fromEntries(Object.entries(layer.featureOverrides).map(([key, o]) => [
      key, Number.isFinite(o?.markerSize) ? { ...o, markerSize: scale(o.markerSize) } : o,
    ]));
  }
  return patch;
}

/** Every per-feature point size removed; other per-feature styling kept. */
export function withoutFeatureSizes(featureOverrides) {
  return Object.fromEntries(Object.entries(featureOverrides || {}).map(([key, o]) => {
    const { markerSize: _size, ...rest } = o || {};
    return [key, rest];
  }));
}
