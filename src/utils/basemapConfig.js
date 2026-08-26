// The basemaps, in one place: what each one is, where its tiles come from, who
// is owed credit, and how far the tile cache actually goes.
//
// No React and no Leaflet imports on purpose. The map editor, the locator
// inset, the portfolio map and the basemap picker all need to know what
// "light" means, and none of them should have to import another component to
// find out.
//
// It exists because they each kept their own copy, and that is precisely what
// made the CARTO outage expensive. CARTO retired anonymous access to
// basemaps.cartocdn.com, so every tile it served came back with "API KEY
// REQUIRED" stamped across it — the default basemap of a mapping product,
// watermarked. Fixing it meant finding five separate hard-coded copies of the
// same URL, one of which (the picker thumbnails) fails silently: a stale
// thumbnail still looks like a map, so the picker would have gone on showing
// watermarked previews of basemaps that had already been fixed.
//
// So: one entry per basemap, and the picker thumbnail is DERIVED from the same
// template the map layer uses. A basemap cannot be half-migrated any more.

// Esri's ArcGIS Online basemaps: no API key, CORS-enabled (which the exporter
// needs to draw tiles into a canvas), and already the source of Terrain,
// Satellite and NatGeo — so this is one tile dependency, not a new one.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

// Esri's canvas and street basemaps are compiled from these sources, and their
// licence requires the credit travel with the map.
const ESRI_COMMUNITY = '&copy; Esri, HERE, Garmin &copy; OpenStreetMap contributors';

export const BASEMAPS = {
  light: {
    label: 'Light',
    // Light Gray Canvas: muted land, restrained roads, and no place labels —
    // the map draws its own, and a basemap that argues with them is why the
    // label-free variant was chosen in the first place.
    url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_COMMUNITY,
    // This service's cache stops at 16. Without saying so, Leaflet asks for
    // tiles that were never published and the basemap goes BLANK at exactly
    // the zoom a claim block is read at; with it, Leaflet upscales level 16
    // instead — soft, but the ground is still there under the claims.
    maxNativeZoom: 16,
  },
  dark: {
    label: 'Dark',
    url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_COMMUNITY,
    maxNativeZoom: 16,
  },
  terrain: {
    label: 'Terrain',
    url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`,
    attribution: '&copy; Esri',
    maxNativeZoom: 19,
  },
  satellite: {
    label: 'Satellite',
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    attribution: '&copy; Esri',
    // Deliberately uncapped: imagery is published past 19 in many places, and
    // capping it would trade real detail for the blank tiles it avoids.
  },
  natgeo: {
    label: 'NatGeo',
    url: `${ESRI}/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}`,
    attribution: '&copy; Esri, National Geographic Society',
    maxNativeZoom: 16,
  },
  blank: {
    label: 'Blank',
    // No tiles at all — the map paints layout.blankBg behind the layers.
    url: '',
    attribution: '',
  },
};

export const BASEMAP_KEYS = Object.keys(BASEMAPS);

export function basemapConfig(key) {
  return BASEMAPS[key] || BASEMAPS.light;
}

/**
 * A single tile from a basemap, for the picker's preview swatch.
 *
 * Derived from the layer's own URL template rather than pasted beside it: a
 * thumbnail that has drifted from the basemap it previews looks like a working
 * thumbnail, so nothing reports it.
 */
export function basemapThumb(key) {
  const url = BASEMAPS[key]?.url;
  if (!url) return null;
  // North America at continental scale — recognisable at 44px, and inside
  // every one of these caches.
  return url
    .replace('{s}', 'a')
    .replace('{z}', '4')
    .replace('{x}', '2')
    .replace('{y}', '5')
    .replace('{r}', '');
}
