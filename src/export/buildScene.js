import { createScene } from './types';
import { getTemplate } from '../templates';
import { resolveTemplateZones } from '../templates/technicalResultsTemplate';

export function buildScene(mapContainer, project, map) {
  // Logical (layout) size, not the on-screen box: the editor stage is
  // CSS-scaled to fit the window, and the composition must not follow it.
  const rect = mapContainer?.getBoundingClientRect?.();
  const width = Math.round(mapContainer?.offsetWidth || rect?.width || 1600);
  const height = Math.round(mapContainer?.offsetHeight || rect?.height || 1000);
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
