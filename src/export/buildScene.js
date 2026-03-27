import { createScene } from "./types";
import { getTemplate } from "../templates";

function resolveZone(zone, width, height) {
  if (!zone) return null;
  const next = { ...zone };
  if (next.right != null && next.left == null && next.width != null) {
    next.left = width - next.right - next.width;
  }
  if (next.bottom != null && next.top == null && next.height != null) {
    next.top = height - next.bottom - next.height;
  }
  return next;
}

export function buildScene(mapContainer, project, map) {
  const rect = mapContainer?.getBoundingClientRect?.();
  const width = Math.round(rect?.width || mapContainer?.offsetWidth || 1600);
  const height = Math.round(rect?.height || mapContainer?.offsetHeight || 1000);
  const template = getTemplate(project?.layout?.templateId || "technical_results_v1");

  const resolvedTemplate = {
    ...template,
    zones: Object.fromEntries(
      Object.entries(template.zones || {}).map(([key, zone]) => [key, resolveZone(zone, width, height)])
    ),
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
