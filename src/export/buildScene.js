import { createScene } from "./types";

export function buildScene(mapContainer, project, map) {
  const rect = mapContainer?.getBoundingClientRect?.();
  const width = Math.round(rect?.width || mapContainer?.offsetWidth || 1600);
  const height = Math.round(rect?.height || mapContainer?.offsetHeight || 1000);

  return createScene({
    width,
    height,
    layers: project?.layers || [],
    layout: project?.layout || {},
    map,
    container: mapContainer,
    project,
  });
}
