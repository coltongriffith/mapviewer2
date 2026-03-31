import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const BASEMAPS = {
  light: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap contributors',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
};

const REFERENCE_OVERLAYS = {
  context: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    opacityFactor: 1,
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
};

function detectGeomType(geojson) {
  const features = geojson?.features || [];
  const type = features.find((f) => f?.geometry?.type)?.geometry?.type || 'Polygon';
  if (type.includes('Point')) return 'points';
  if (type.includes('Line')) return 'line';
  return 'polygon';
}

export default function MapCanvas({ onReady, project, template, onFeatureClick, onMapClick }) {
  const mapRef = useRef(null);
  const onMapClickRef = useRef(onMapClick);
  const mapElRef = useRef(null);
  const baseLayerRef = useRef(null);
  const overlayGroupRef = useRef(null);
  const referenceRefs = useRef({});

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    if (mapRef.current || !mapElRef.current) return;

    const map = L.map(mapElRef.current, {
      center: [56, -123],
      zoom: 5,
      zoomControl: true,
      preferCanvas: false,
      zoomSnap: 0.01,
      zoomDelta: 0.25,
    });

    map.on('click', (event) => onMapClickRef.current?.(event.latlng));

    overlayGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    onReady?.(map);
  }, [onReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const key = project?.layout?.basemap || 'light';
    const cfg = BASEMAPS[key] || BASEMAPS.light;

    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
    }

    baseLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 20,
      crossOrigin: true,
      updateWhenIdle: true,
      keepBuffer: 4,
      zIndex: 200,
    }).addTo(map);
  }, [project?.layout?.basemap]);

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
        referenceRefs.current[key] = L.tileLayer(cfg.url, {
          attribution: cfg.attribution,
          maxZoom: 20,
          crossOrigin: true,
          updateWhenIdle: true,
          keepBuffer: 3,
          opacity: Math.max(0.2, Math.min(1, baseOpacity * cfg.opacityFactor)),
          zIndex: cfg.zIndex,
        }).addTo(map);
        return;
      }

      if (active && existing) {
        existing.setOpacity(Math.max(0.2, Math.min(1, baseOpacity * cfg.opacityFactor)));
      }
    });
  }, [project?.layout?.referenceOverlays, project?.layout?.referenceOpacity]);

  useEffect(() => {
    const map = mapRef.current;
    const group = overlayGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    (project?.layers || []).forEach((layer) => {
      if (layer.visible === false || !layer.geojson) return;

      const baseStyle = template?.roleStyles?.[layer.role] || template?.roleStyles?.other || {};
      const style = { ...baseStyle, ...(layer.style || {}) };
      const geomType = detectGeomType(layer.geojson);
      const isDrillholes = layer.role === 'drillholes' || layer.type === 'points';

      const geoLayer = L.geoJSON(layer.geojson, {
        pane: 'overlayPane',
        style: () => ({
          color: style.stroke || '#54a6ff',
          weight: style.strokeWidth ?? 2,
          fillColor: style.fill || '#54a6ff',
          fillOpacity: geomType === 'line' ? 0 : style.fillOpacity ?? 0.22,
          dashArray: style.dashArray || '',
          opacity: style.opacity ?? 1,
        }),
        pointToLayer: (feature, latlng) => {
          const marker = L.circleMarker(latlng, {
            radius: Math.max(4, (style.markerSize ?? 10) / 2),
            color: style.markerColor || style.stroke || '#111111',
            fillColor: style.markerFill || style.fill || style.markerColor || '#ffffff',
            fillOpacity: 1,
            weight: style.strokeWidth ?? 1.5,
            opacity: 1,
          });

          if (isDrillholes) {
            marker.on('click', () => onFeatureClick?.({ layerId: layer.id, feature, latlng }));
            marker.bindTooltip('Click to label', { direction: 'top', offset: [0, -10], opacity: 0.9, sticky: true });
          }

          return marker;
        },
        onEachFeature: (feature, featureLayer) => {
          if (isDrillholes && typeof featureLayer.getLatLng === 'function') {
            featureLayer.on('click', () => onFeatureClick?.({ layerId: layer.id, feature, latlng: featureLayer.getLatLng() }));
          }
        },
      });

      geoLayer.addTo(group);
      if (isDrillholes && typeof geoLayer.bringToFront === 'function') {
        geoLayer.bringToFront();
      }
    });
  }, [project?.layers, template, onFeatureClick]);

  return <div ref={mapElRef} className="leaflet-map-canvas" />;
}
