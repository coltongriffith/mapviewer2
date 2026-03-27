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
  const leftSafe = Math.max((zones.title?.left || 18) + (zones.legend?.width || 290) + 46, 240);
  const rightSafe = Math.max((zones.inset?.width || 220) + 42, 160);
  const topSafe = Math.max((zones.title?.height || 88) + 52, 120);
  const bottomSafe = Math.max((zones.scaleBar?.height || 64) + 44, 110);

  const padVariants = {
    tight: { paddingTopLeft: [leftSafe - 70, topSafe - 30], paddingBottomRight: [rightSafe - 40, bottomSafe - 28] },
    balanced: { paddingTopLeft: [leftSafe, topSafe], paddingBottomRight: [rightSafe, bottomSafe] },
    regional: { paddingTopLeft: [leftSafe + 40, topSafe + 24], paddingBottomRight: [rightSafe + 24, bottomSafe + 18] },
  };

  map.fitBounds(bounds, padVariants[mode] || padVariants.balanced, { animate: false });
}
