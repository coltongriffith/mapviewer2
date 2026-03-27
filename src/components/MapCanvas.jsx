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

export default function MapCanvas({ onReady, project }) {
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
    }).addTo(map);
  }, [project?.layout?.basemap]);

  useEffect(() => {
    const map = mapRef.current;
    const group = overlayGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    (project?.layers || []).forEach((layer) => {
      if (layer.visible === false || !layer.geojson) return;

      const style = layer.style || {};
      const geoLayer = L.geoJSON(layer.geojson, {
        style: () => ({
          color: style.stroke || "#54a6ff",
          weight: style.strokeWidth ?? 2,
          fillColor: style.fill || "#54a6ff",
          fillOpacity: style.fillOpacity ?? 0.22,
          dashArray: style.dashArray || "",
        }),
        pointToLayer: (_feature, latlng) =>
          L.circleMarker(latlng, {
            radius: style.markerSize ?? 10,
            color: style.markerColor || "#111111",
            fillColor: style.markerColor || "#111111",
            fillOpacity: 1,
            weight: 1,
          }),
      });

      geoLayer.addTo(group);
    });
  }, [project]);

  return <div ref={mapElRef} style={{ width: "100%", height: "100%" }} />;
}