// The reference overlays, in one place: what each one is, who publishes it, and
// where its tiles come from.
//
// This file has no React and no Leaflet imports on purpose. The map component
// needs it to build layers, and the exporter needs it to credit them — and the
// exporter must not drag Leaflet into its chunk to find out who owns a tile.
//
// `parties` is the single source of truth for attribution. The Leaflet control
// and the exported margin note are both DERIVED from it, because the two had
// already drifted: the export credited "OpenStreetMap" for two layers that
// Leaflet correctly credited to "OpenStreetMap © CARTO", leaving CARTO
// uncredited in the one artifact a reader actually receives. A second hand-kept
// list would just reintroduce that.
export const REFERENCE_OVERLAY_CONFIG = {
  // Order matters: it fixes the sequence of the exported credit block, so the
  // note does not reshuffle between exports of the same map depending on which
  // toggle was flipped last.
  geology: {
    // USGS MRData "worldgeol" WMS — world geologic map compiled by the
    // Geological Survey of Canada. Global coverage; layers verified from
    // GetCapabilities: `geology` (bedrock units) + `contacts` (unit borders).
    //
    // Global coverage, so it works over Canadian claims, at compilation scale:
    // unit colours read well zoomed out but stay coarse at property scale.
    url: 'https://mrdata.usgs.gov/services/worldgeol',
    wms: { layers: 'geology,contacts', format: 'image/png', transparent: true },
    parties: ['USGS', 'Geological Survey of Canada'],
    creditLabel: 'Bedrock geology (coloured units)',
    creditDetail: 'world geologic map',
    opacityFactor: 0.85,
    zIndex: 345,
  },
  context: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    parties: ['OpenStreetMap contributors', 'CARTO'],
    creditLabel: 'Roads and settlements',
    opacityFactor: 0.95,
    zIndex: 350,
  },
  labels: {
    url: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
    parties: ['OpenStreetMap contributors', 'CARTO'],
    creditLabel: 'Place labels',
    opacityFactor: 0.95,
    zIndex: 360,
  },
  rail: {
    url: 'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
    // OpenRailwayMap renders OSM data, so both are owed credit.
    parties: ['OpenRailwayMap', 'OpenStreetMap contributors'],
    creditLabel: 'Railways',
    opacityFactor: 0.9,
    zIndex: 365,
  },
};

export const REFERENCE_OVERLAY_KEYS = Object.keys(REFERENCE_OVERLAY_CONFIG);

// What Leaflet's attribution control shows.
export function overlayAttribution(key) {
  const cfg = REFERENCE_OVERLAY_CONFIG[key];
  if (!cfg) return '';
  return cfg.parties.map((p) => `&copy; ${p}`).join(' ');
}
