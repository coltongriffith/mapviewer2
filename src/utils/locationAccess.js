import { applyPropertyNeighbours, propertySubject, propertyTitle } from './propertyNeighbours.js';
import { visibleGeojson, layerGeometryKind } from './featureIdentity.js';
import { isClassified } from './classification.js';

const keyOf = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const genericSubtitle = (s) => !s || ['Technical Results', 'Claims, drillholes, and targets', 'Claims Map', 'Investor Map', 'Property & Neighbours', 'Infrastructure Map'].includes(s);

function roadLabelField(layer) {
  const features = visibleGeojson(layer)?.features || [];
  if (!features.length || features.length > 80) return null;
  const keys = Object.keys(features[0].properties || {});
  for (const alias of ['displaylabel', 'routename', 'roadname', 'roadnamefull', 'name', 'routenumber', 'highwayroutenumber']) {
    const matches = keys.filter((k) => keyOf(k) === alias);
    if (matches.length === 1 && features.every((f) => ['string', 'number'].includes(typeof f.properties?.[matches[0]]) && String(f.properties[matches[0]]).trim())) return matches[0];
  }
  return null;
}

// Explicit template selection, not a new import workflow. Reuse the released
// title/brand/caption setup, then compose an access map rather than a tenure plan.
// A mapped road never implies access rights, seasonality or available capacity.
export function applyLocationAccess(project, referenceOverlays = project.layout?.referenceOverlays || {}) {
  const base = applyPropertyNeighbours(project);
  const subject = propertySubject(project);
  const layers = base.layers.map((layer, i) => {
    const original = project.layers[i];
    if (original.userStyled || isClassified(original)) return original;
    if (layer.role === 'claims') {
      // No automatically generated tenure-ID carpet at regional scale. Keep
      // every user-supplied label decision, including an explicit off setting.
      const fx = original.fx;
      const projectLabel = propertyTitle(layer, 'Project Map');
      const label = layer.id === subject?.id && fx?.label === undefined && (visibleGeojson(layer)?.features?.length || 0) <= 80 && projectLabel !== 'Project Map'
        ? { on: true, text: projectLabel, per: 'layer', size: 18, minSize: 12, caps: false,
          weight: 700, ls: 0, fit: 'hide', color: '#233b43' } : null;
      return { ...layer, fx: label ? { ...fx, label } : fx };
    }
    if (layer.role !== 'roads_access' || layerGeometryKind(layer) !== 'line' || original.fx?.label !== undefined) return layer;
    const field = roadLabelField(layer);
    return field ? { ...layer, fx: { ...original.fx, label: { on: true, field, per: 'feature',
      size: 12, minSize: 10, weight: 600, caps: false, ls: 0, side: 'left', offset: 5 } } } : layer;
  });
  return {
    ...base,
    layers,
    layout: {
      ...base.layout,
      propertyNeighboursVersion: undefined,
      locationAccessVersion: 1,
      mapUse: project.layout?.mapUse || 'standalone',
      subtitle: genericSubtitle(project.layout?.subtitle) ? 'Location & Access' : project.layout.subtitle,
      zoomPadFrac: 0.8,
      compositionPreset: 'access',
      referenceOverlays: { ...referenceOverlays },
      wash: { color: '#ffffff', amount: 0.32, vignette: 0 },
      legendCorner: 'br', scaleBarCorner: 'bl', northArrowCorner: 'bl',
      cornerLayout: { tl: [['logo', 'title']], tr: [['inset']], bl: [['scaleBar', 'northArrow']], br: [['legend']] },
      insetWidthPx: 176, insetHeightPx: 145,
      legendWidthPx: 280,
    },
  };
}
