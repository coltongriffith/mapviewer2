import { createScene } from './types';
import { getTemplate } from '../templates';
import { resolveTemplateZones } from '../templates/technicalResultsTemplate';

export function buildScene(mapContainer, project, map) {
  const rect = mapContainer?.getBoundingClientRect?.();
  const width = Math.round(rect?.width || mapContainer?.offsetWidth || 1600);
  const height = Math.round(rect?.height || mapContainer?.offsetHeight || 1000);
  const template = getTemplate(project?.layout?.templateId || 'technical_results_v2');

  const resolvedTemplate = {
    ...template,
    zones: resolveTemplateZones(template, project?.layout || {}, { width, height }),
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
