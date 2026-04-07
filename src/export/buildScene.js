import { createScene } from './types';
import { getTemplate } from '../templates';
import { resolveTemplateZones } from '../templates/technicalResultsTemplate';
import { resolveAnchoredLayout } from '../utils/anchoredLayout';

export function buildScene(mapContainer, project, map) {
  const rect = mapContainer?.getBoundingClientRect?.();
  const width = Math.round(rect?.width || mapContainer?.offsetWidth || 1600);
  const height = Math.round(rect?.height || mapContainer?.offsetHeight || 1000);
  const template = getTemplate(project?.layout?.templateId || 'technical_results_v2');
  const mapSize = { width, height };
  const layout = project?.layout || {};

  // Use corner-anchor layout if layoutItems are configured; otherwise fall back to template zones
  const templateZones = resolveTemplateZones(template, layout, mapSize);
  const anchoredZones = layout.layoutItems
    ? resolveAnchoredLayout(
        layout.layoutItems.map((item) => item.id === 'legend' ? { ...item, width: layout.legendWidth || item.width } : item),
        mapSize,
        layout.safeMargins
      )
    : null;
  const zones = anchoredZones ? { ...templateZones, ...anchoredZones } : templateZones;

  const resolvedTemplate = {
    ...template,
    zones,
  };

  return createScene({
    width,
    height,
    layers: project?.layers || [],
    layout: project?.layout || {},
    map,
    container: mapContainer,
    project,
    template: resolvedTemplate,
  });
}
