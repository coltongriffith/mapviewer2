import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { makeMarkerIcon } from '../utils/leaflet';
import { claimTooltipHtml, claimPopupRowsHtml } from '../utils/claimInfo';
import { POINT_ROLES } from '../projectState';
import regionsNA from '../assets/regionsNA.json';
import dissolveGeo from '@turf/dissolve';

const BASEMAPS = {
  light: {
    // Voyager variant: blue water, readable roads, no labels — cleaner for mining maps
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
  terrain: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
  natgeo: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, National Geographic Society',
  },
  blank: {
    url: '',
    attribution: '',
  },
};

const REFERENCE_OVERLAYS = {
  context: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    opacityFactor: 0.95,
    zIndex: 350,
  },
  labels: {
    url: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    opacityFactor: 0.95,
    zIndex: 360,
  },
  rail: {
    url: 'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
    attribution: '&copy; OpenRailwayMap',
    opacityFactor: 0.9,
    zIndex: 365,
  },
  // Bedrock geology — USGS MRData world geologic map compilation (WMS, not
  // XYZ). Global coverage, so it works over Canadian claims, at compilation
  // scale: unit colors read well zoomed out but stay coarse at property scale.
  geology: {
    url: 'https://mrdata.usgs.gov/services/geology',
    wms: { layers: 'geology', format: 'image/png', transparent: true },
    attribution: '&copy; USGS',
    opacityFactor: 0.85,
    zIndex: 345,
  },
};

function detectGeomType(geojson) {
  const features = geojson?.features || [];
  const type = features.find((f) => f?.geometry?.type)?.geometry?.type || 'Polygon';
  if (type.includes('Point')) return 'points';
  if (type.includes('Line')) return 'line';
  return 'polygon';
}

export default function MapCanvas({ onReady, project, template, onFeatureClick, onMapClick, annotationToolRef }) {
  const mapRef = useRef(null);
  const onMapClickRef = useRef(onMapClick);
  const onFeatureClickRef = useRef(onFeatureClick);
  const mapElRef = useRef(null);
  const baseLayerRef = useRef(null);
  const overlayGroupRef = useRef(null);
  const regionHighlightGroupRef = useRef(null);
  const referenceRefs = useRef({});
  const svgRendererRefs = useRef([]);
  const prevLayersRef = useRef([]);
  const leafletLayerRefsMap = useRef(new Map());

  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onFeatureClickRef.current = onFeatureClick; }, [onFeatureClick]);

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
    const cfg = BASEMAPS[key] || BASEMAPS.light;

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
          crossOrigin: true,
          updateWhenIdle: true,
          keepBuffer: 3,
          opacity: Math.max(0.2, Math.min(1, baseOpacity * cfg.opacityFactor)),
          zIndex: cfg.zIndex,
        };
        // WMS overlays (e.g. USGS geology) still render as <img> tiles, so
        // export capture treats them identically to XYZ layers.
        referenceRefs.current[key] = cfg.wms
          ? L.tileLayer.wms(cfg.url, { ...opts, ...cfg.wms })
          : L.tileLayer(cfg.url, opts);
        referenceRefs.current[key].addTo(map);
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
    highlights.forEach(({ regionId, color, opacity }) => {
      const region = regionsNA.find((r) => r.id === regionId);
      if (!region) return;
      L.geoJSON(
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: region.coordinates } },
        { pane: 'regionHighlightPane', style: () => ({ fillColor: color || '#ef4444', fillOpacity: opacity ?? 0.45, stroke: false, weight: 0 }) }
      ).addTo(group);
    });
  }, [project?.layout?.regionHighlights]);

  useEffect(() => {
    const map = mapRef.current;
    const group = overlayGroupRef.current;
    if (!map || !group) return;

    const newLayers = project?.layers || [];
    const oldLayers = prevLayersRef.current;

    // Style-only fast path: if no layer was added/removed, no GeoJSON changed, no visibility
    // changed, and no fill pattern changed, skip the full rebuild and just update styles.
    const isStyleOnly =
      newLayers.length === oldLayers.length &&
      leafletLayerRefsMap.current.size > 0 &&
      newLayers.every((nl, i) => {
        const ol = oldLayers[i];
        return ol && nl.id === ol.id && nl.geojson === ol.geojson &&
               nl.visible === ol.visible && nl.type !== 'points' &&
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
        const baseStyle = template?.roleStyles?.[layer.role] || template?.roleStyles?.other || {};
        const style = { ...baseStyle, ...(layer.style || {}) };
        const lo = style.layerOpacity ?? 1;
        geoLayer.setStyle({
          color: style.stroke || '#54a6ff',
          weight: style.strokeWidth ?? 2,
          fillColor: style.fill || '#54a6ff',
          fillOpacity: (style.fillOpacity ?? 0.22) * lo,
          dashArray: style.dashArray || '',
          opacity: (style.opacity ?? 1) * lo,
        });
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

      const baseStyle = template?.roleStyles?.[layer.role] || template?.roleStyles?.other || {};
      const style = { ...baseStyle, ...(layer.style || {}) };
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

      // Dissolve adjacent polygons to remove internal shared borders
      let geojsonData = layer.geojson;
      if (style.dissolve && geomType !== 'line' && !isDrillholes) {
        try {
          const fc = geojsonData.type === 'FeatureCollection'
            ? geojsonData
            : { type: 'FeatureCollection', features: geojsonData.type === 'Feature' ? [geojsonData] : [{ type: 'Feature', geometry: geojsonData, properties: {} }] };
          const dissolved = dissolveGeo(fc);
          if (dissolved?.features?.length) geojsonData = dissolved;
        } catch (_) { /* dissolve failed — use original */ }
      }

      const geoLayer = L.geoJSON(geojsonData, {
        renderer: svgRenderer,
        style: () => ({
          color: style.stroke || '#54a6ff',
          weight: style.strokeWidth ?? 2,
          fillColor: style.fill || '#54a6ff',
          fillOpacity: geomType === 'line' ? 0 : (style.fillOpacity ?? 0.22) * lo,
          dashArray: style.dashArray || '',
          opacity: (style.opacity ?? 1) * lo,
        }),
        pointToLayer: (feature, latlng) => {
          const fKey = feature?.id != null ? String(feature.id)
            : feature?.properties?.hole_id || feature?.properties?.holeid
            || feature?.properties?.id || feature?.properties?.name
            || JSON.stringify(feature?.geometry?.coordinates);
          const featureOverride = layer.featureOverrides?.[fKey] || {};
          const markerShape = featureOverride.markerShape ?? style.markerShape;
          const markerColor = featureOverride.markerColor ?? style.markerColor ?? style.stroke ?? '#111111';
          const markerSize = style.markerSize ?? 10;

          let marker;
          const customUri = style.customMarkerDataUri;
          if (customUri) {
            const s = Math.max(8, markerSize);
            const icon = L.icon({ iconUrl: customUri, iconSize: [s, s], iconAnchor: [s / 2, s / 2], popupAnchor: [0, -s / 2 - 2] });
            marker = L.marker(latlng, { icon });
          } else if (markerShape && markerShape !== 'circle') {
            const markerFill = featureOverride.markerFill ?? style.markerFill ?? style.fill ?? '#ffffff';
            const icon = makeMarkerIcon(markerShape, markerColor, Math.max(8, markerSize), markerFill);
            marker = L.marker(latlng, { icon });
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
            onFeatureClickRef.current?.({ layerId: layer.id, feature: null, latlng: null, isLayerSelect: true });
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
  }, [project?.layers, template]);

  return <div ref={mapElRef} className="leaflet-map-canvas" />;
}
