import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { visibleGeojson } from '../utils/featureIdentity.js';
import { geojsonBounds, unionBounds } from '../utils/geometry';
import { reportError } from '../utils/errorReporter';

// An imagery locator: satellite (or any basemap) with a box around the area the
// main map is showing.
//
// The other inset modes draw vector outlines — a province shape, a country. That
// answers "where in B.C. is this?". This one answers "what does the ground
// around it look like?", which is the question an investor deck usually wants:
// valley, coastline, existing workings, road access.
//
// EXPORT IS THE POINT, so the class name below is load-bearing. renderScene
// finds this container by class and captures the tiles the browser has already
// rendered, the same way it captures the main map. An inset that looks right in
// the editor and comes out blank in the client's PDF would be worse than not
// having it at all, so the two share one mechanism rather than two pipelines
// that can drift.
export const SATELLITE_INSET_CLASS = 'satellite-inset-map';

const BASEMAPS = {
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  terrain: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  natgeo: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

// How much ground to show around the project. 4x the extent puts the property
// in a recognisable setting without shrinking it to a dot.
const CONTEXT_PAD = 4;

export default function SatelliteInset({ layers, basemap = 'satellite', markerColor }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const tileRef = useRef(null);
  const rectRef = useRef(null);
  const reportedRef = useRef(false);

  // Bounds of what is actually on the map — visibleGeojson, so a trimmed block
  // does not stretch the locator over ground the user removed.
  const bounds = unionBounds(
    (layers || [])
      .filter((l) => l.visible !== false && l.geojson)
      .map((l) => geojsonBounds(visibleGeojson(l)))
      .filter(Boolean),
  );

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    mapRef.current = L.map(elRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      // Tiles must be <img> elements for the export capture to find them, which
      // canvas rendering would not produce.
      preferCanvas: false,
    });
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      tileRef.current = null;
      rectRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) { map.removeLayer(tileRef.current); tileRef.current = null; }

    const tiles = L.tileLayer(BASEMAPS[basemap] || BASEMAPS.satellite, {
      // Required for the export canvas to read the pixels without tainting it.
      // Esri's imagery sends the header, and the main map already relies on it.
      crossOrigin: true,
      maxZoom: 19,
      updateWhenIdle: true,
    });
    tiles.on('tileerror', () => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      reportError('Satellite inset failed to load tiles', {
        kind: 'tile_error', context: { overlay: 'satellite_inset', basemap },
      });
    });
    tiles.addTo(map);
    tileRef.current = tiles;
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize({ animate: false });

    const ll = bounds && L.latLngBounds(
      [bounds.minLat, bounds.minLng],
      [bounds.maxLat, bounds.maxLng],
    );

    // A Leaflet map with no view set is not merely empty — it is unusable, and
    // later calls against it throw. An empty project, or one whose only layer
    // has been trimmed away, has no bounds to fit, so give it a view anyway and
    // let the imagery stand on its own until there is something to box.
    if (!ll || !ll.isValid()) {
      if (rectRef.current) { rectRef.current.remove(); rectRef.current = null; }
      if (!map._loaded) map.setView([54, -123], 4, { animate: false });
      return;
    }

    map.fitBounds(ll.pad(CONTEXT_PAD), { animate: false });

    if (!rectRef.current) {
      rectRef.current = L.rectangle(ll, {
        color: markerColor || '#cc2f2f', weight: 2, fillOpacity: 0.08,
      }).addTo(map);
    } else {
      rectRef.current.setBounds(ll);
      rectRef.current.setStyle({ color: markerColor || '#cc2f2f' });
    }
  }, [bounds?.minLat, bounds?.minLng, bounds?.maxLat, bounds?.maxLng, markerColor]);

  return <div ref={elRef} className={SATELLITE_INSET_CLASS} style={{ width: '100%', height: '100%' }} />;
}
