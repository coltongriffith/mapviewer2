import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const BASEMAPS = {
  light: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenTopoMap contributors",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri",
  },
};

function detectGeomType(geojson) {
  const features = geojson?.features || [];
  const type = features.find((f) => f?.geometry?.type)?.geometry?.type || "Polygon";
  if (type.includes("Point")) return "points";
  if (type.includes("Line")) return "line";
  return "polygon";
}

export default function MapCanvas({ onReady, project, template }) {
  const mapRef = useRef(null);
  const mapElRef = useRef(null);
  const baseLayerRef = useRef(null);
  const overlayGroupRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !mapElRef.current) return;

    const map = L.map(mapElRef.current, {
      center: [56, -123],
      zoom: 5,
      zoomControl: true,
      preferCanvas: false,
    });

    overlayGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    onReady?.(map);
  }, [onReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const key = project?.layout?.basemap || "light";
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
    }).addTo(map);
  }, [project?.layout?.basemap]);

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

      const geoLayer = L.geoJSON(layer.geojson, {
        style: () => ({
          color: style.stroke || "#54a6ff",
          weight: style.strokeWidth ?? 2,
          fillColor: style.fill || "#54a6ff",
          fillOpacity: geomType === "line" ? 0 : style.fillOpacity ?? 0.22,
          dashArray: style.dashArray || "",
        }),
        pointToLayer: (_feature, latlng) =>
          L.circleMarker(latlng, {
            radius: (style.markerSize ?? 10) / 2,
            color: style.markerColor || "#111111",
            fillColor: style.markerFill || style.markerColor || "#ffffff",
            fillOpacity: 1,
            weight: style.strokeWidth ?? 1.5,
          }),
      });

      geoLayer.addTo(group);
    });
  }, [project, template]);

  return <div ref={mapElRef} style={{ width: "100%", height: "100%" }} />;
}
