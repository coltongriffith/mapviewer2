import { hasVisibleFeatures, visibleGeojson, layerGeometryKind } from './featureIdentity.js';
import { isClassified } from './classification.js';

const HEX = /^#[0-9a-f]{6}$/i;
const LABEL_FIELDS = ['displaylabel', 'label', 'claimname', 'tenurename', 'name', 'tenureid', 'claimid', 'tenurenumberid', 'tagnumber'];
const normalKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const valueText = (v) => (typeof v === 'string' || typeof v === 'number') && String(v).trim() !== '';
const darken = (hex) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.48).toString(16).padStart(2, '0')).join('')}`;
const genericName = (s) => !s || /^(project claims|claims|layer)$/i.test(s.trim());
const sourceName = (layer) => String(layer?.sourceName || layer?.name || '').replace(/\.(geojson|json|zip|kml|kmz|shp)$/i, '').replace(/[_-]+/g, ' ').trim();

function claimLayers(project) {
  return (project.layers || []).filter((l) => l.role === 'claims' && l.visible !== false
    && layerGeometryKind(l) === 'polygon' && hasVisibleFeatures(l));
}

// Use the already selected framing layer, or the sole eligible project layer.
// File order, an owner name and a colour are not evidence of project ownership.
export function propertySubject(project) {
  const claims = claimLayers(project);
  return claims.find((l) => l.id === project.layout?.primaryLayerId && l.focus !== false)
    || (claims.filter((l) => l.focus !== false).length === 1 ? claims.find((l) => l.focus !== false) : null);
}

function labelField(layer) {
  const features = visibleGeojson(layer)?.features || [];
  // This is a first-result convenience, not an unbounded labelling job on a
  // registry-sized upload. Dense layers keep the existing expert label tools.
  if (!features.length || features.length > 80) return null;
  const keys = Object.keys(features[0].properties || {});
  // Only an unambiguous, supplied label/name/ID column covering every visible
  // feature. Never turn a numeric assay/area/interest into an invented label.
  for (const alias of LABEL_FIELDS) {
    const matches = keys.filter((k) => normalKey(k) === alias);
    if (matches.length === 1 && features.every((f) => valueText(f.properties?.[matches[0]]))) return matches[0];
  }
  return null;
}

function propertyTitle(subject, current) {
  if (current && !['Project Map', 'Untitled Map', 'Untitled map'].includes(current.trim())) return current;
  const features = visibleGeojson(subject)?.features || [];
  const keys = Object.keys(features[0]?.properties || {});
  for (const alias of ['projectname', 'propertyname']) {
    const matching = keys.filter((k) => normalKey(k) === alias);
    if (matching.length !== 1) continue;
    const values = features.map((f) => f.properties?.[matching[0]]);
    if (values.length && values.every((v) => valueText(v) && String(v).trim() === String(values[0]).trim())) return String(values[0]).trim();
  }
  return (genericName(subject?.displayName) ? sourceName(subject) : subject?.displayName) || current || 'Property & Neighbours';
}

/** Explicit template selection only; never run on import, restore or camera edits.
 * Uses branding already in the project (logo upload / owned-kit application).
 * Does not fetch kits or change scientific classes, feature overrides or inputs.
 */
export function applyPropertyNeighbours(project) {
  const original = project.layout || {};
  const subject = propertySubject(project);
  const accent = HEX.test(original.accentColor || '') ? original.accentColor
    : HEX.test(original.titleBgColor || '') ? original.titleBgColor : '#b58b29';
  const title = propertyTitle(subject, original.title);
  return {
    ...project,
    layers: (project.layers || []).map((layer) => {
      if (!claimLayers({ layers: [layer] }).length || layer.userStyled || isClassified(layer)) return layer;
      const primary = layer.id === subject?.id;
      // Only explicitly marked context or the other claim layers relative to
      // an explicit subject get the muted treatment. Ambiguity stays neutral.
      const context = layer.focus === false || (subject && !primary);
      const field = layer.fx?.label === undefined ? labelField(layer) : null;
      const source = sourceName(layer);
      const caption = genericName(layer.displayName) && genericName(layer.legend?.label) && source
        ? source[0].toUpperCase() + source.slice(1) : null;
      return {
        ...layer,
        ...(caption ? { displayName: caption, legend: { ...layer.legend, label: caption } } : {}),
        style: {
          ...layer.style,
          ...(primary ? { fill: accent, stroke: darken(accent), fillOpacity: 0.3, strokeWidth: 2.2 }
            : context ? { fill: '#9ca9ad', stroke: '#697b82', fillOpacity: 0.18, strokeWidth: 1 } : {}),
        },
        ...(field ? { fx: { ...layer.fx, label: { on: true, field, per: 'feature', size: 14, minSize: 10,
          weight: 600, caps: false, ls: 0, fit: 'hide', color: '#233b43', opacity: 1 } } } : {}),
      };
    }),
    layout: {
      ...original,
      propertyNeighboursVersion: 1,
      exportRatio: original.exportRatio || (original.exportSettings?.customWidth > 0 && original.exportSettings?.customHeight > 0 ? null : 'landscape'),
      title,
      subtitle: !original.subtitle || ['Technical Results', 'Claims Map', 'Investor Map'].includes(original.subtitle)
        ? 'Property & Neighbours' : original.subtitle,
      primaryLayerId: subject?.id || original.primaryLayerId,
      basemap: 'terrain',
      wash: { color: '#ffffff', amount: 0.38, vignette: 0 },
      compositionPreset: 'balanced', zoomPadFrac: 0.1,
      showTitle: true, showLegend: true,
      titleCorner: 'tl', logoCorner: 'tl', insetCorner: 'tr', legendCorner: 'bl', scaleBarCorner: 'bl', northArrowCorner: 'br',
      cornerLayout: { tl: original.logo ? [['logo', 'title']] : [['title']], tr: [['inset']], bl: [['scaleBar'], ['legend']], br: [['northArrow']] },
      titleWidthPx: null, titleHeightPx: title.length > 55 ? 108 : 82,
      logoWidthPx: 120, logoHeightPx: 74,
      insetWidthPx: 176, insetHeightPx: 145,
      legendWidthPx: 260, legendHeightPx: null, legendFit: true, legendMode: 'compact',
      northArrowHeightPx: 58, northArrowStyle: 'arrow',
      insetEnabled: original.insetEnabled !== false,
      // Preserve custom supplied inset and company colours/fonts/logo. A useful
      // automatic regional locator is the fallback, not a made-up location.
      insetMode: original.insetMode === 'custom_image' ? original.insetMode : 'province_state',
      referenceOverlays: { ...original.referenceOverlays, labels: false, rail: false },
    },
  };
}
