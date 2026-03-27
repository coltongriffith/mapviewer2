import L from 'leaflet';

function getVisibleLayers(project) {
  return (project?.layers || []).filter((layer) => layer.visible !== false && layer.geojson);
}

function buildBounds(layers) {
  const collection = L.featureGroup(layers.map((layer) => L.geoJSON(layer.geojson)));
  const bounds = collection.getBounds();
  return bounds?.isValid?.() ? bounds : null;
}

export function fitProjectToTemplate(project, map, template, mode = 'balanced') {
  if (!map) return;
  const visibleLayers = getVisibleLayers(project);
  if (!visibleLayers.length) return;

  const targetLayers = project?.layout?.primaryLayerId
    ? visibleLayers.filter((layer) => layer.id === project.layout.primaryLayerId)
    : visibleLayers;

  const bounds = buildBounds(targetLayers.length ? targetLayers : visibleLayers);
  if (!bounds) return;

  const zones = template?.zones || {};
  const leftSafe = Math.max((zones.legend?.width || 0) + 54, (zones.title?.width || 0) * 0.48, 180);
  const rightSafe = Math.max((zones.inset?.width || 0) + 42, (zones.northArrow?.width || 0) + 22, 90);
  const topSafe = Math.max((zones.title?.height || 0) + 50, 90);
  const bottomSafe = Math.max((zones.scaleBar?.height || 0) + 42, (zones.logo?.height || 0) * 0.45, 90);

  const padVariants = {
    tight: { paddingTopLeft: [Math.max(120, leftSafe - 80), Math.max(60, topSafe - 26)], paddingBottomRight: [Math.max(80, rightSafe - 26), Math.max(60, bottomSafe - 24)] },
    balanced: { paddingTopLeft: [leftSafe, topSafe], paddingBottomRight: [rightSafe, bottomSafe] },
    regional: { paddingTopLeft: [leftSafe + 44, topSafe + 24], paddingBottomRight: [rightSafe + 26, bottomSafe + 20] },
    access: { paddingTopLeft: [leftSafe + 68, topSafe + 24], paddingBottomRight: [rightSafe + 60, bottomSafe + 24] },
  };

  map.fitBounds(bounds, { ...(padVariants[mode] || padVariants.balanced), animate: false });
}
