import { propertySubject, propertyTitle } from './propertyNeighbours.js';
import { DEFAULT_SIDE_PANEL_GRID } from '../templates/sidePanelTemplate.js';

const genericSubtitle = (s) => !s || ['Technical Results', 'Claims, drillholes, and targets',
  'Claims Map', 'Investor Map', 'Property & Neighbours', 'Infrastructure Map', 'Location & Access'].includes(s);

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
    layout: {
      ...original,
      propertyNeighboursVersion: undefined,
      locationAccessVersion: undefined,
      explorationDrillVersion: 1,
      title,
      subtitle: genericSubtitle(original.subtitle) ? 'Exploration & Drill' : original.subtitle,
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
