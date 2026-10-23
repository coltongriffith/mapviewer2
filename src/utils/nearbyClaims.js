// Nearby claims (project.areaClaims) as an export draws them. The editor shows them as a Leaflet overlay of its
// own, outside project.layers, so every export path turns them into ordinary layers first: one polygon layer per
// owner (merged into one outline when dissolve is on) and, when they are in the legend, one row per owner under
// "Nearby Claims". The editor's export and share, and the dashboard's package export (through the read-only
// stage), all use these, so a figure shows the same nearby claims wherever it is made.
import dissolveGeo from '@turf/dissolve';

// Merge all polygons belonging to one owner into a single outline, removing
// the internal borders between adjacent claims. Returns a FeatureCollection.
export function dissolveOwnerFeatures(feats, ownerKey) {
  const polys = [];
  feats.forEach((f) => {
    const g = f.geometry;
    if (!g) return;
    if (g.type === 'Polygon') {
      polys.push({ type: 'Feature', properties: { __o: ownerKey }, geometry: g });
    } else if (g.type === 'MultiPolygon') {
      g.coordinates.forEach((coords) =>
        polys.push({ type: 'Feature', properties: { __o: ownerKey }, geometry: { type: 'Polygon', coordinates: coords } }));
    }
  });
  if (!polys.length) return { type: 'FeatureCollection', features: [] };
  try {
    const merged = dissolveGeo({ type: 'FeatureCollection', features: polys }, { propertyName: '__o' });
    if (merged?.features?.length) return merged;
  } catch (_) { /* dissolve failed — fall back to un-merged polygons */ }
  return { type: 'FeatureCollection', features: polys };
}

const style = (areaClaims, color) => ({ fill: color, fillOpacity: areaClaims.fillOpacity ?? 0.22, stroke: color, strokeWidth: areaClaims.dissolve ? 1.5 : 1 });

/** The project's layers with its visible nearby claims added, one layer per owner (the layers alone otherwise). */
export function layersWithNearbyClaims(project) {
  const areaClaims = project?.areaClaims;
  const layers = project?.layers || [];
  if (!areaClaims?.visible || !areaClaims.features?.length) return layers;
  const { features, ownerColors = {}, ownerLabels = {}, ownerField, hiddenOwners = [], showInLegend } = areaClaims;
  const ownerGroups = {};
  features.forEach((f) => {
    const owner = (ownerField ? f.properties?.[ownerField] : null) || 'Unknown';
    if (!(hiddenOwners || []).includes(owner)) {
      if (!ownerGroups[owner]) ownerGroups[owner] = [];
      ownerGroups[owner].push(f);
    }
  });
  const claimLayers = Object.entries(ownerGroups).map(([owner, feats]) => {
    const color = ownerColors[owner] || '#888888';
    const exportFeats = areaClaims.dissolve
      ? (dissolveOwnerFeatures(feats, owner)?.features || feats)
      : feats;
    return {
      id: `__ac_${owner}`,
      name: ownerLabels[owner] ?? owner,
      displayName: ownerLabels[owner] ?? owner,
      type: 'polygons',
      role: 'other',
      visible: true,
      geojson: { type: 'FeatureCollection', features: exportFeats },
      style: { ...style(areaClaims, color), layerOpacity: 1 },
      legend: { enabled: !!showInLegend, label: ownerLabels[owner] ?? owner },
      claimInfo: true,
    };
  });
  return [...layers, ...claimLayers];
}

/** The nearby claims' legend rows, one per owner shown, when they are in the legend. */
export function nearbyClaimsLegendItems(areaClaims) {
  if (!areaClaims?.showInLegend || !areaClaims.features?.length) return [];
  const { ownerColors = {}, ownerLabels = {}, hiddenOwners = [] } = areaClaims;
  return Object.entries(ownerColors)
    .filter(([owner]) => !hiddenOwners.includes(owner))
    .map(([owner, color]) => ({
      id: `__ac_${owner}`,
      role: 'other',
      group: 'Nearby Claims',
      label: ownerLabels[owner] ?? owner,
      type: 'polygons',
      style: style(areaClaims, color),
    }));
}
