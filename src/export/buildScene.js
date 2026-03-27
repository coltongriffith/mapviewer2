import { createScene } from "./types";

function getContainerSize(mapContainer) {
  const rect = mapContainer?.getBoundingClientRect?.();

  return {
    width:
      Math.round(rect?.width || 0) ||
      mapContainer?.offsetWidth ||
      1600,