import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { makeMarkerIcon } from '../utils/leaflet';
import { claimTooltipHtml, claimPopupRowsHtml } from '../utils/claimInfo';
import { POINT_ROLES } from '../projectState';
import { createLayerGeometryCache } from '../utils/layerGeometry';
import { reportError } from '../utils/errorReporter';
import { featureKey } from '../utils/featureIdentity.js';
import { REFERENCE_OVERLAY_CONFIG, overlayAttribution } from '../utils/referenceOverlayConfig.js';
import { basemapConfig } from '../utils/basemapConfig.js';
import { getTemplateStyle, getFeatureStyle } from '../utils/featureStyle.js';

// Leaflet path options for one feature: template role defaults, then the
// layer's style, then that feature's own override — the same resolution the
// exporters use, so what a shape looks like on screen is what it exports as.
function pathStyle(template, layer, feature, geomType) {
  const style = getFeatureStyle(template, layer, feature, featureKey(feature));
  const lo = style.layerOpacity ?? 1;
  return {
    color: style.stroke || '#54a6ff',
    weight: style.strokeWidth ?? 2,
    fillColor: style.fill || '#54a6ff',
    fillOpacity: geomType === 'line' ? 0 : (style.fillOpacity ?? 0.22) * lo,
    dashArray: style.dashArray || '',
    opacity: (style.opacity ?? 1) * lo,
  };
}

// Definitions live in utils/referenceOverlayConfig.js, shared with the
// exporter's credit block. Keeping a second copy here is what let the two
// disagree about who owns a tile: Leaflet credited CARTO, the export did not.
const REFERENCE_OVERLAYS = Object.fromEntries(
  Object.entries(REFERENCE_OVERLAY_CONFIG).map(([key, cfg]) => [
    key, { ...cfg, attribution: overlayAttribution(key) },
  ]),
);

function detectGeomType(geojson) {
  const features = geojson?.features || [];
  const type = features.find((f) => f?.geometry?.type)?.geometry?.type || 'Polygon';
  if (type.includes('Point')) return 'points';
  if (type.includes('Line')) return 'line';
  return 'polygon';
}

export default function MapCanvas({ onReady, project, template, onFeatureClick, onMapClick, annotationToolRef, trimLayerId = null, onOverlayError }) {
  const mapRef = useRef(null);
  const geometryCache = useRef(null);
  if (!geometryCache.current) geometryCache.current = createLayerGeometryCache();
  const onMapClickRef = useRef(onMapClick);
  const onFeatureClickRef = useRef(onFeatureClick);
  const prevTrimLayerIdRef = useRef(null);
  const mapElRef = useRef(null);
  const baseLayerRef = useRef(null);
  const overlayGroupRef = useRef(null);
  const regionHighlightGroupRef = useRef(null);
  const referenceRefs = useRef({});
  const reportedTileErrors = useRef(new Set());
  const onOverlayErrorRef = useRef(onOverlayError);
  const svgRendererRefs = useRef([]);
  const prevLayersRef = useRef([]);
  const leafletLayerRefsMap = useRef(new Map());

  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onFeatureClickRef.current = onFeatureClick; }, [onFeatureClick]);
  useEffect(() => { onOverlayErrorRef.current = onOverlayError; }, [onOverlayError]);

  useEffect(() => {
    if (mapRef.current || !mapElRef.current) return;

    const map = L.map(mapElRef.current, {
      center: [56, -123],
      zoom: 5,
      zoomControl: false,
      preferCanvas: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
    });

    map.dragging.enable();
    map.scrollWheelZoom.enable();
    map.doubleClickZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();

    map.on('click', (event) => onMapClickRef.current?.(event.latlng));

    const regionHighlightPane = map.createPane('regionHighlightPane');
    regionHighlightPane.style.zIndex = 355;

    overlayGroupRef.current = L.layerGroup().addTo(map);
    regionHighlightGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    onReady?.(map);
  }, [onReady]);

  useEffect(() => () => {
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      overlayGroupRef.current = null;
      regionHighlightGroupRef.current = null;
      baseLayerRef.current = null;
      referenceRefs.current = {};
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const key = project?.layout?.basemap || 'light';
    const cfg = basemapConfig(key);

    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }

    // Apply background color to the map container (only meaningful for blank basemap)
    map.getContainer().style.backgroundColor = cfg.url ? '' : (project?.layout?.blankBg || '#ffffff');

    if (!cfg.url) return; // blank basemap — no tile layer

    baseLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 21,
      // Every tile service stops publishing somewhere. Past that level Leaflet
      // upscales the deepest tile it can actually get instead of requesting
      // one that does not exist and leaving the basemap blank underneath the
      // claims — which is indistinguishable from the Blank basemap.
      maxNativeZoom: cfg.maxNativeZoom,
      crossOrigin: true,
      updateWhenIdle: true,
      keepBuffer: 4,
      zIndex: 200,
    }).addTo(map);
  }, [project?.layout?.basemap, project?.layout?.blankBg]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const enabled = project?.layout?.referenceOverlays || {};
    const baseOpacity = Number(project?.layout?.referenceOpacity || 0.65);

    Object.entries(REFERENCE_OVERLAYS).forEach(([key, cfg]) => {
      const active = Boolean(enabled[key]);
      const existing = referenceRefs.current[key];

      if (!active && existing) {
        map.removeLayer(existing);
        delete referenceRefs.current[key];
        return;
      }

      if (active && !existing) {
        const opts = {
          attribution: cfg.attribution,
          maxZoom: cfg.maxZoom || 20,
          // Same reason as the basemap: past a service's deepest published
          // level, upscale rather than ask for tiles that do not exist.
          maxNativeZoom: cfg.maxNativeZoom,
          crossOrigin: true,
          updateWhenIdle: true,
          keepBuffer: 3,
          opacity: Math.max(0.2, Math.min(1, baseOpacity * cfg.opacityFactor)),
          zIndex: cfg.zIndex,
        };
        // WMS overlays (e.g. USGS geology) still render as <img> tiles, so
        // export capture treats them identically to XYZ layers.
        const tiles = cfg.wms
          ? L.tileLayer.wms(cfg.url, { ...opts, ...cfg.wms })
          : L.tileLayer(cfg.url, opts);

        // Say so when a tile service stops answering.
        //
        // Nothing listened for this, and the cost was concrete. The bedrock
        // geology overlay stopped rendering and the ONLY symptom was a toggle
        // that appeared to do nothing — which is indistinguishable from a
        // subtle layer that is working correctly. Users do not report that, so
        // it went unnoticed, and when it was finally investigated the absence
        // of any signal led to the wrong conclusion (that the upstream service
        // was dead) and very nearly to deleting a working feature.
        //
        // Every one of these is a third-party service outside our control.
        // Reported once per overlay per session — a broken source emits an
        // error for every tile in view, and the guard is what keeps Admin →
        // Health readable rather than flooded.
        tiles.on('tileerror', () => {
          if (reportedTileErrors.current.has(key)) return;
          reportedTileErrors.current.add(key);
          reportError(`Reference overlay "${key}" failed to load tiles`, {
            kind: 'tile_error',
            context: { overlay: key, url: cfg.url },
          });
          onOverlayErrorRef.current?.(key);
        });

        referenceRefs.current[key] = tiles;
        tiles.addTo(map);
        return;
      }

      if (active && existing) {
        existing.setOpacity(Math.max(0.2, Math.min(1, baseOpacity * cfg.opacityFactor)));
      }
    });
  }, [project?.layout?.referenceOverlays, project?.layout?.referenceOpacity]);

  useEffect(() => {
    const group = regionHighlightGroupRef.current;
    if (!group) return;
    group.clearLayers();
    const highlights = project?.layout?.regionHighlights || [];
    if (!highlights.length) return;
    let cancelled = false;
    import('../assets/regionsNA.json').then(({ default: regions }) => {
      if (cancelled) return;
      highlights.forEach(({ regionId, color, opacity }) => {
        const region = regions.find(r => r.id === regionId);
        if (!region) return;
        L.geoJSON({ type: 'Feature', geometry: { type: 'Polygon', coordinates: region.coordinates } }, {
          pane: 'regionHighlightPane', style: () => ({ fillColor: color || '#ef4444', fillOpacity: opacity ?? 0.45, stroke: false, weight: 0 }),
        }).addTo(group);
      });
    }).catch(() => { if (!cancelled) reportError('Region highlight geometry could not load', { kind: 'asset_load' }); });
    return () => { cancelled = true; };
  }, [project?.layout?.regionHighlights]);

  useEffect(() => {
    const map = mapRef.current;
    const group = overlayGroupRef.current;
    if (!map || !group) return;

    const newLayers = project?.layers || [];
    const oldLayers = prevLayersRef.current;

    // Style-only fast path: if no layer was added/removed, no GeoJSON changed, no visibility
    // changed, and no fill pattern changed, skip the full rebuild and just update styles.
    // Entering or leaving trim mode changes whether a layer is dissolved, which
    // is a geometry change, not a style one. Rebuild.
    const trimChanged = prevTrimLayerIdRef.current !== trimLayerId;
    prevTrimLayerIdRef.current = trimLayerId;

    const isStyleOnly =
      !trimChanged &&
      newLayers.length === oldLayers.length &&
      leafletLayerRefsMap.current.size > 0 &&
      newLayers.every((nl, i) => {
        const ol = oldLayers[i];
        return ol && nl.id === ol.id && nl.geojson === ol.geojson &&
               nl.visible === ol.visible && nl.type !== 'points' &&
               // Removing a feature changes featureOverrides, NOT geojson and
               // NOT style — so without this the fast path would swallow it and
               // the removed claim would stay on screen until some unrelated
               // edit forced a rebuild. setFeatureOverride replaces the object,
               // so reference equality is the right test.
               nl.featureOverrides === ol.featureOverrides &&
               nl.style?.markerShape === ol.style?.markerShape &&
               nl.style?.markerSize === ol.style?.markerSize &&
               nl.style?.customMarkerDataUri === ol.style?.customMarkerDataUri &&
               (nl.style?.fillPattern || 'none') === (ol.style?.fillPattern || 'none') &&
               !!nl.style?.dissolve === !!ol.style?.dissolve;
      });

    if (isStyleOnly) {
      newLayers.forEach((layer) => {
        if (layer.visible === false || !layer.geojson) return;
        const geoLayer = leafletLayerRefsMap.current.get(layer.id);
        if (!geoLayer) return;
        const geomType = detectGeomType(layer.geojson);
        // A function, not an object: an object would restyle every shape
        // alike and wipe the outline a user gave one polygon.
        geoLayer.setStyle((feature) => pathStyle(template, layer, feature, geomType));
      });
      prevLayersRef.current = newLayers;
      return;
    }

    group.clearLayers();
    // Remove stale SVG renderers from previous render to prevent pattern ID conflicts
    svgRendererRefs.current.forEach((r) => { try { r.remove(); } catch (_) {} });
    svgRendererRefs.current = [];
    leafletLayerRefsMap.current.clear();

    newLayers.forEach((layer) => {
      if (layer.visible === false || !layer.geojson) return;

      const style = getTemplateStyle(template, layer);
      const geomType = detectGeomType(layer.geojson);
      const isDrillholes = POINT_ROLES.has(layer.role) || layer.type === 'points';

      const lo = style.layerOpacity ?? 1;
      const hasPattern = style.fillPattern && style.fillPattern !== 'none' && geomType !== 'line';
      const svgRenderer = hasPattern ? L.svg({ padding: 0.1 }) : undefined;
      if (svgRenderer) svgRendererRefs.current.push(svgRenderer);

      // Use SVG renderer (overlayPane) for drillholes so they stack above canvas polygon fills.
      // overlayPane SVG has pointer-events:auto from Leaflet CSS; custom panes do not.
      const drillholeRenderer = isDrillholes ? L.svg({ padding: 0 }) : undefined;
      if (drillholeRenderer) svgRendererRefs.current.push(drillholeRenderer);

      // Hiding a feature invalidates the geometry cache. Styling a marker or
      // another layer does not repeat an expensive polygon dissolve.
      // Trim mode always exposes individual claim identities for hit testing.
      const trimming = trimLayerId === layer.id;
      const geojsonData = geometryCache.current(layer, {
        dissolve: !!style.dissolve && !trimming && geomType !== 'line' && !isDrillholes,
      });

      const geoLayer = L.geoJSON(geojsonData, {
        renderer: svgRenderer,
        style: (feature) => pathStyle(template, layer, feature, geomType),
        pointToLayer: (feature, latlng) => {
          const fKey = featureKey(feature);
          const featureOverride = layer.featureOverrides?.[fKey] || {};
          const markerShape = featureOverride.markerShape ?? style.markerShape;
          const markerColor = featureOverride.markerColor ?? style.markerColor ?? style.stroke ?? '#111111';
          const markerSize = style.markerSize ?? 10;

          let marker;
          const customUri = style.customMarkerDataUri;
          if (customUri) {
            const s = Math.max(8, markerSize);
            const icon = L.icon({ iconUrl: customUri, iconSize: [s, s], iconAnchor: [s / 2, s / 2], popupAnchor: [0, -s / 2 - 2] });
            marker = L.marker(latlng, { icon, opacity: lo });
          } else if (markerShape && markerShape !== 'circle') {
            const markerFill = featureOverride.markerFill ?? style.markerFill ?? style.fill ?? '#ffffff';
            const icon = makeMarkerIcon(markerShape, markerColor, Math.max(8, markerSize), markerFill);
            marker = L.marker(latlng, { icon, opacity: lo });
          } else {
            marker = L.circleMarker(latlng, {
              renderer: drillholeRenderer,
              radius: Math.max(4, markerSize / 2),
              color: markerColor,
              fillColor: style.markerFill || style.fill || markerColor || '#ffffff',
              fillOpacity: lo,
              weight: style.strokeWidth ?? 1.5,
              opacity: lo,
            });
          }

          if (isDrillholes) {
            marker.on('click', (e) => {
              if (annotationToolRef?.current) return;
              L.DomEvent.stopPropagation(e);
              onFeatureClickRef.current?.({ layerId: layer.id, feature, latlng });
            });
            marker.bindTooltip('Click to edit callout', { direction: 'top', offset: [0, -10], opacity: 0.9, sticky: true });
          } else {
            marker.on('click', (e) => {
              if (annotationToolRef?.current) return;
              L.DomEvent.stopPropagation(e);
              onFeatureClickRef.current?.({ layerId: layer.id, feature: null, latlng: null, isLayerSelect: true });
            });
          }

          return marker;
        },
        onEachFeature: isDrillholes ? undefined : (feature, featureLayer) => {
          if (layer.claimInfo) {
            const props = feature.properties || {};
            const ownerName = layer.displayName || layer.name || null;
            featureLayer.bindTooltip(claimTooltipHtml(props, ownerName), { sticky: true, className: 'area-claims-tooltip' });
            featureLayer.bindPopup(`<div class="area-claims-popup">${claimPopupRowsHtml(props, ownerName)}</div>`);
          }
          featureLayer.on('click', (e) => {
            if (annotationToolRef?.current) return;
            L.DomEvent.stopPropagation(e);
            // `isLayerSelect` still means what it always did — a polygon click
            // selects its layer, not the individual shape. But the feature and
            // the click point ride along now, so trim mode can act on the one
            // polygon that was actually clicked. Handlers that only read
            // isLayerSelect are unaffected.
            onFeatureClickRef.current?.({
              layerId: layer.id,
              feature,
              latlng: e.latlng || null,
              isLayerSelect: true,
            });
          });
        },
      });

      geoLayer.addTo(group);
      leafletLayerRefsMap.current.set(layer.id, geoLayer);

      if (hasPattern && svgRenderer) {
        const fillColor = style.fill || '#54a6ff';
        const fillOpacity = style.fillOpacity ?? 0.6;
        const spacing = style.fillPatternSpacing || 6;
        // Include pattern type in ID so switching patterns doesn't reuse stale definitions
        const patternId = `lf-pat-${layer.id}-${style.fillPattern}`;
        const svgEl = svgRenderer._container;
        if (svgEl) {
          let defs = svgEl.querySelector('defs');
          if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); svgEl.insertBefore(defs, svgEl.firstChild); }
          defs.innerHTML = '';
          const patEl = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
          patEl.setAttribute('id', patternId);
          patEl.setAttribute('patternUnits', 'userSpaceOnUse');
          patEl.setAttribute('width', spacing * 2);
          patEl.setAttribute('height', spacing * 2);
          if (style.fillPattern === 'hatch') {
            const makeL = (x1, y1, x2, y2) => { const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); l.setAttribute('stroke', fillColor); l.setAttribute('stroke-width', 1.5); l.setAttribute('stroke-opacity', fillOpacity); patEl.appendChild(l); };
            makeL(0, spacing * 2, spacing * 2, 0); makeL(-spacing, spacing, spacing, -spacing); makeL(spacing, spacing * 3, spacing * 3, spacing);
          } else if (style.fillPattern === 'cross') {
            const makeL = (x1, y1, x2, y2) => { const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); l.setAttribute('stroke', fillColor); l.setAttribute('stroke-width', 1.5); l.setAttribute('stroke-opacity', fillOpacity); patEl.appendChild(l); };
            makeL(0, spacing, spacing * 2, spacing); makeL(spacing, 0, spacing, spacing * 2);
          } else if (style.fillPattern === 'dots') {
            const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('cx', spacing); c.setAttribute('cy', spacing); c.setAttribute('r', 2); c.setAttribute('fill', fillColor); c.setAttribute('fill-opacity', fillOpacity); patEl.appendChild(c);
          }
          defs.appendChild(patEl);
          const applyPattern = (l) => {
            if (!l._path) return;
            l._path.style.fill = `url(#${patternId})`;
            l._path.style.fillOpacity = '1';
            const orig = l._updateStyle?.bind(l);
            l._updateStyle = function () {
              if (orig) orig();
              if (this._path) { this._path.style.fill = `url(#${patternId})`; this._path.style.fillOpacity = '1'; }
            };
          };
          geoLayer.eachLayer(applyPattern);
        }
      }

      if (isDrillholes && typeof geoLayer.bringToFront === 'function') {
        geoLayer.bringToFront();
      }
    });
    prevLayersRef.current = newLayers;
  }, [project?.layers, template, trimLayerId, annotationToolRef]);

  return <div ref={mapElRef} className="leaflet-map-canvas" />;
}
