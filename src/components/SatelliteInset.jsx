import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { visibleGeojson } from '../utils/featureIdentity.js';
import { geojsonBounds, unionBounds } from '../utils/geometry';
import { detectRegion } from '../utils/detectRegion';
import { reportError } from '../utils/errorReporter';

// A satellite locator: imagery, the province or state outlined on top of it, and
// a marker on the project.
//
// The point of a locator is the ANSWER "which part of B.C. is this?", and
// imagery alone cannot give it — one patch of forest looks like any other, and
// a satellite inset floating on a satellite main map reads as a smudge. So the
// jurisdiction boundary is drawn over the imagery and the view is framed to the
// jurisdiction, not to the claims. The imagery supplies the terrain; the outline
// supplies the place.
//
// EXPORT IS THE POINT, so the class name below is load-bearing. renderScene
// finds this container by class and captures the tiles the browser has already
// rendered, the same way it captures the main map. An inset that looks right in
// the editor and comes out blank in the client's PDF would be worse than not
// having it, so the two share one mechanism rather than two that can drift.
export const SATELLITE_INSET_CLASS = 'satellite-inset-map';

const IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// How much room to leave around the jurisdiction. Just enough that the outline
// does not touch the frame.
const REGION_PAD = 0.12;

// Fallback when no province or state can be identified — offshore claims, or a
// jurisdiction outside North America. Show the ground around the project rather
// than nothing.
const CLAIM_PAD = 4;

export default function SatelliteInset({ layers, markerColor, region }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const regionRef = useRef(null);
  const markerRef = useRef(null);
  const reportedRef = useRef(false);
  const [detected, setDetected] = React.useState(null);

  // What is actually on the map — visibleGeojson, so a trimmed block does not
  // drag the locator over ground the user removed.
  const bounds = unionBounds(
    (layers || [])
      .filter((l) => l.visible !== false && l.geojson)
      .map((l) => geojsonBounds(visibleGeojson(l)))
      .filter(Boolean),
  );

  // The caller usually knows the region already (layout.autoInsetRegion). Detect
  // only when it does not, so the common path costs nothing.
  useEffect(() => {
    if (region || !bounds) { setDetected(null); return; }
    let cancelled = false;
    detectRegion(bounds).then((r) => { if (!cancelled) setDetected(r || null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [region, bounds?.minLat, bounds?.minLng, bounds?.maxLat, bounds?.maxLng]);

  const activeRegion = region || detected;

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

    const tiles = L.tileLayer(IMAGERY_URL, {
      // Required for the export canvas to read the pixels without tainting it.
      // Esri sends the header, and the main map already relies on it.
      crossOrigin: true,
      maxZoom: 19,
      updateWhenIdle: true,
    });
    tiles.on('tileerror', () => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      reportError('Satellite inset failed to load tiles', {
        kind: 'tile_error', context: { overlay: 'satellite_inset' },
      });
    });
    tiles.addTo(mapRef.current);

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      regionRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize({ animate: false });

    const claim = bounds && L.latLngBounds(
      [bounds.minLat, bounds.minLng],
      [bounds.maxLat, bounds.maxLng],
    );

    // ── The jurisdiction outline ─────────────────────────────────────────────
    if (regionRef.current) { regionRef.current.remove(); regionRef.current = null; }
    if (activeRegion?.coordinates?.length) {
      // A bright halo under a dark line: imagery is busy and high-contrast in
      // places, and a single-colour stroke disappears over snow or over water
      // depending which colour it is. Two strokes survive both.
      const rings = activeRegion.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng]));
      regionRef.current = L.layerGroup([
        L.polyline(rings, { color: '#000000', weight: 4, opacity: 0.45, interactive: false }),
        L.polyline(rings, { color: '#ffffff', weight: 1.8, opacity: 0.95, interactive: false }),
      ]).addTo(map);
    }

    // ── Framing ──────────────────────────────────────────────────────────────
    // The jurisdiction, when we know it. That is what makes this a locator
    // rather than an aerial photograph.
    if (activeRegion?.bbox) {
      const [w, s, e, n] = activeRegion.bbox;
      const rb = L.latLngBounds([s, w], [n, e]);
      if (rb.isValid()) map.fitBounds(rb.pad(REGION_PAD), { animate: false });
    } else if (claim && claim.isValid()) {
      map.fitBounds(claim.pad(CLAIM_PAD), { animate: false });
    } else if (!map._loaded) {
      // A Leaflet map with no view is not empty, it is unusable, and later
      // calls against it throw.
      map.setView([54, -123], 4, { animate: false });
    }

    // ── The project marker ───────────────────────────────────────────────────
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    if (claim && claim.isValid()) {
      const colour = markerColor || '#ff3b30';
      const centre = claim.getCenter();
      // At province scale a claim block is smaller than a pixel, so a rectangle
      // of its true extent would be invisible. A fixed-size ring reads at any
      // zoom, and does not overstate the property's size — which a scaled-up
      // box would.
      markerRef.current = L.layerGroup([
        L.circleMarker(centre, {
          radius: 7, color: '#ffffff', weight: 3, fillColor: colour, fillOpacity: 1, interactive: false,
        }),
        L.circleMarker(centre, {
          radius: 7, color: colour, weight: 1.5, fill: false, interactive: false,
        }),
      ]).addTo(map);
    }
  }, [
    activeRegion,
    bounds?.minLat, bounds?.minLng, bounds?.maxLat, bounds?.maxLng,
    markerColor,
  ]);

  return <div ref={elRef} className={SATELLITE_INSET_CLASS} style={{ width: '100%', height: '100%' }} />;
}
