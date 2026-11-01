import { propertySubject, propertyTitle } from './propertyNeighbours.js';
import { DEFAULT_SIDE_PANEL_GRID } from '../templates/sidePanelTemplate.js';
import { featureKey, layerFeatures, isFeatureHidden } from './featureIdentity.js';

const genericSubtitle = (s) => !s || ['Technical Results', 'Claims, drillholes, and targets',
  'Claims Map', 'Investor Map', 'Property & Neighbours', 'Infrastructure Map', 'Location & Access'].includes(s);

function suppliedCollarLabels(project) {
  const existing = project.callouts || [];
  if (project.layout?.explorationDrillVersion === 1) return existing;
  const collars = (project.layers || []).filter((l) => l.role === 'drillholes' && l.visible !== false
    && !l.userStyled && l.fx?.label?.on !== false).flatMap((layer) => layerFeatures(layer)
    .filter((f) => f.geometry?.type === 'Point' && !isFeatureHidden(layer, f)).map((f) => ({ layer, f })));
  // A convenience for small supplied collar tables, never an arbitrary subset
  // of a dense project. Use the importer's established ID/label contract only.
  if (collars.length > 80) return existing;
  const identity = ({ layer, f }) => `${layer.id}:${featureKey(f)}`;
  const counts = new Map();
  for (const c of collars) counts.set(identity(c), (counts.get(identity(c)) || 0) + 1);
  const additions = collars.flatMap(({ layer, f }) => {
    const raw = f.properties?._holeid ?? f.properties?.label;
    if (!['string', 'number'].includes(typeof raw)) return [];
    const text = String(raw).trim(), key = String(featureKey(f)), [lng, lat] = f.geometry.coordinates || [];
    if (!text || text.length > 24 || !Number.isFinite(lng) || !Number.isFinite(lat) || counts.get(identity({ layer, f })) !== 1) return [];
    if (existing.some((c) => String(c.featureId) === key && (!c.layerId || c.layerId === layer.id))) return [];
    return [{ id: `drill-id:${encodeURIComponent(layer.id)}:${encodeURIComponent(key)}`, text, subtext: '', type: 'plain',
      layerId: layer.id, featureId: key, anchor: { lng, lat }, offset: { x: 14, y: -16 }, priority: 2,
      fit: true, style: { textColor: '#192635', background: '#ffffff', fontSize: 12, paddingX: 4, paddingY: 3 } }];
  });
  return additions.length ? [...existing, ...additions] : existing;
}

// Explicit card application only. Presentation does not establish that collar
// data contains results, or that any supplied interpretation is approved.
export function applyExplorationDrill(project, referenceOverlays = project.layout?.referenceOverlays || {}) {
  const original = project.layout || {};
  const suppliedTitle = propertyTitle(propertySubject(project), original.title);
  const title = ['Property & Neighbours', 'Project Map', 'Untitled Map', 'Untitled map'].includes(suppliedTitle)
    ? 'Exploration & Drill' : suppliedTitle;
  return {
    ...project,
    // Every geometry, source value, result, class, cutoff, label and override
    // stays on the existing rendering/import path. No guessed assay mapping.
    layers: project.layers,
    callouts: suppliedCollarLabels(project),
    layout: {
      ...original,
      propertyNeighboursVersion: undefined,
      locationAccessVersion: undefined,
      explorationDrillVersion: 1,
      title,
      subtitle: genericSubtitle(original.subtitle) ? (title === 'Exploration & Drill' ? '' : 'Exploration & Drill') : original.subtitle,
      exportRatio: original.exportRatio || (original.exportSettings?.customWidth > 0 && original.exportSettings?.customHeight > 0 ? null : 'landscape'),
      compositionPreset: 'tight', zoomPadFrac: 0.08,
      layoutAlgorithm: 3, // Existing scored placement; explicitly pinned cards stay pinned.
      sidePanelGrid: original.sidePanelGrid || original.sidePanelOrder || [...DEFAULT_SIDE_PANEL_GRID],
      titleHeightPx: title.length > 55 ? 130 : 100,
      legendGrouped: original.legendGrouped ?? true,
      legendFit: true, legendHeightPx: null,
      showTitle: true, showLegend: true,
      referenceOverlays: { ...referenceOverlays },
      insetMode: original.insetMode === 'custom_image' ? original.insetMode : 'secondary_zoom',
      wash: { color: '#ffffff', amount: 0.18, vignette: 0 },
    },
  };
}
