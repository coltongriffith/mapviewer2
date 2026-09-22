import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { visibleGeojson } from '../utils/featureIdentity.js';
import { geojsonBounds, unionBounds } from '../utils/geometry';
import { detectRegion } from '../utils/detectRegion';
import { reportError } from '../utils/errorReporter';
import { basemapConfig } from '../utils/basemapConfig';
import { REFERENCE_OVERLAY_CONFIG } from '../utils/referenceOverlayConfig';

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


// Room around the jurisdiction, in PIXELS rather than as a fraction of the
// bounds.
//
// A fractional pad was what broke the framing. The inset is small — around
// 220x132 — so one Leaflet zoom level is an enormous step: at the fitted zoom
// British Columbia filled the box, one level down it covered a third of it,
// with Alaska and the Caribbean either side. fitBounds floors to an integer
// zoom, the ideal fit here is about 3.2, and padding the bounds by 12% pushed
// that to 2.9 — so a pad meant to keep the outline off the frame cost a factor
// of two instead. In pixels the pad costs what it says it costs.
const REGION_PAD_PX = 6;

// Fallback when no province or state can be identified — offshore claims, or a
// jurisdiction outside North America. Show the ground around the project rather
// than nothing.
const CLAIM_PAD = 4;

export default function SatelliteInset({ layers, markerColor, region, basemap = 'satellite' }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const regionRef = useRef(null);
  const markerRef = useRef(null);
  const reportedRef = useRef(false);
  const tileRefs = useRef([]);
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
      // Fractional zoom. In a panel this small an integer zoom step is the
      // difference between "a province" and "a continent", and fitBounds can
      // only round down. Nothing here zooms interactively, so there is no
      // snapping behaviour to preserve — only a fit to get right.
      zoomSnap: 0,
      zoomAnimation: false,
    });

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      regionRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileRefs.current.forEach((layer) => layer.remove());
    tileRefs.current = [];
    const cfg = basemapConfig(basemap);
    map.getContainer().style.backgroundColor = cfg.url ? '' : '#ffffff';
    const add = (layer) => {
      layer.on('tileerror', () => {
        if (reportedRef.current) return;
        reportedRef.current = true;
        reportError('Locator inset failed to load tiles', { kind: 'tile_error', context: { overlay: 'locator_inset', basemap } });
      });
      layer.addTo(map);
      tileRefs.current.push(layer);
    };
    if (cfg.url) add(L.tileLayer(cfg.url, { crossOrigin: true, maxZoom: 19, maxNativeZoom: cfg.maxNativeZoom, updateWhenIdle: true }));
    if (cfg.reliefUrl) add(L.tileLayer(cfg.reliefUrl, { crossOrigin: true, maxZoom: 19, maxNativeZoom: 16, opacity: cfg.reliefOpacity }));
    const overlayKey = basemap === 'geology' ? 'geology' : basemap === 'satellite_hybrid' ? 'labels' : null;
    if (overlayKey) {
      const overlay = REFERENCE_OVERLAY_CONFIG[overlayKey];
      add(overlay.wms
        ? L.tileLayer.wms(overlay.url, { ...overlay.wms, crossOrigin: true, opacity: 0.55 })
        : L.tileLayer(overlay.url, { crossOrigin: true, maxZoom: 19 }));
    }
    return () => { tileRefs.current.forEach((layer) => layer.remove()); tileRefs.current = []; };
  }, [basemap]);

  // The view, reapplied whenever anything it depends on changes — including the
  // container's size, since Leaflet derives zoom from pixels and nothing else
  // here recomputes a fit.
  const applyView = React.useCallback(() => {
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
      const [w, s2, e, n] = activeRegion.bbox;
      const rb = L.latLngBounds([s2, w], [n, e]);
      if (rb.isValid()) {
        map.fitBounds(rb, { animate: false, padding: [REGION_PAD_PX, REGION_PAD_PX] });
      }
    } else if (claim && claim.isValid()) {
      // No jurisdiction to frame, so there is no fixed shape to fill — show
      // the ground around the project. A fractional pad is the right tool
      // here, because the claim block itself is the thing being padded.
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
  }, [activeRegion, bounds?.minLat, bounds?.minLng, bounds?.maxLat, bounds?.maxLng, markerColor]);

  useEffect(() => { applyView(); }, [applyView]);

  // Refit on resize. The panel lays out after mount and changes size with the
  // template, and a fit computed against one size stays put at another — the
  // dependency list above has no way to notice.
  useEffect(() => {
    const el = elRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => applyView());
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyView]);

  return <div ref={elRef} className={SATELLITE_INSET_CLASS} style={{ width: '100%', height: '100%' }} />;
}
