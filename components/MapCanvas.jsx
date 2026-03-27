import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const BASEMAPS = {
  light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap &copy; CARTO",
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

export default function MapCanvas({ onReady, project, template, onDrillholeClick }) {
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

    mapRef.current = map;
    overlayGroupRef.current = L.layerGroup().addTo(map);
    onReady?.(map);
  }, [onReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const cfg = BASEMAPS[project?.layout?.basemap] || BASEMAPS.topo;
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
    }

    baseLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 20,
      crossOrigin: true,
    }).addTo(map);
  }, [project?.layout?.basemap]);

  useEffect(() => {
    const map = mapRef.current;
    const group = overlayGroupRef.current;
    if (!map || !group || !template) return;

    group.clearLayers();

    for (const layer of project.layers || []) {
      if (layer.visible === false || !layer.geojson) continue;

      const roleStyle = template.roleStyles?.[layer.role] || template.roleStyles?.other || {};
      const style = { ...roleStyle, ...(layer.style || {}) };
      const geomType = detectGeomType(layer.geojson);

      const geoLayer = L.geoJSON(layer.geojson, {
        style: () => ({
          color: style.stroke || "#333333",
          weight: style.strokeWidth ?? 2,
          fillColor: style.fill || "#88aaff",
          fillOpacity: geomType === "line" ? 0 : style.fillOpacity ?? 0.2,
          dashArray: style.dashArray || "",
        }),
        pointToLayer: (feature, latlng) => {
          const marker = L.circleMarker(latlng, {
            radius: style.markerSize ?? 6,
            color: style.markerColor || "#111111",
            fillColor: style.markerFill || style.markerColor || "#ffffff",
            fillOpacity: 1,
            weight: style.strokeWidth ?? 1.5,
          });

          if (layer.role === "drillholes") {
            marker.on("click", () => {
              const pt = map.latLngToContainerPoint(latlng);
              const size = map.getSize();
              onDrillholeClick?.({
                layerId: layer.id,
                feature,
                anchor: {
                  x: (pt.x / size.x) * 100,
                  y: (pt.y / size.y) * 100,
                },
              });
            });
          }

          return marker;
        },
      });

      geoLayer.addTo(group);
    }
  }, [project, template, onDrillholeClick]);

  return <div ref={mapElRef} style={{ width: "100%", height: "100%" }} />;
}
