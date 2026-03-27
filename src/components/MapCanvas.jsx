diff --git a/src/components/MapCanvas.jsx b/src/components/MapCanvas.jsx
index 672ad1d4fcfc635c1256430e651f01c0d6f35fed..6d3227ce015c0c5ab61c4daa6264fe1e1e49a9ef 100644
--- a/src/components/MapCanvas.jsx
+++ b/src/components/MapCanvas.jsx
@@ -1,95 +1,109 @@
 import React, { useEffect, useRef } from "react";
 import L from "leaflet";
 import "leaflet/dist/leaflet.css";
 
 const BASEMAPS = {
   light: {
-    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
-    attribution: "&copy; OpenStreetMap contributors",
+    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
+    attribution: "&copy; OpenStreetMap &copy; CARTO",
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
 
-export default function MapCanvas({ onReady, project }) {
+function detectGeomType(geojson) {
+  const features = geojson?.features || [];
+  const t = features.find((f) => f?.geometry?.type)?.geometry?.type;
+  if (!t) return "polygon";
+  if (t.includes("Point")) return "points";
+  if (t.includes("Line")) return "line";
+  return "polygon";
+}
+
+export default function MapCanvas({ onReady, project, template, onDrillholeClick }) {
   const mapRef = useRef(null);
   const mapElRef = useRef(null);
   const baseLayerRef = useRef(null);
   const overlayGroupRef = useRef(null);
 
   useEffect(() => {
     if (mapRef.current || !mapElRef.current) return;
-
-    const map = L.map(mapElRef.current, {
-      center: [56, -123],
-      zoom: 5,
-      zoomControl: true,
-    });
-
-    overlayGroupRef.current = L.layerGroup().addTo(map);
+    const map = L.map(mapElRef.current, { center: [56, -123], zoom: 5, zoomControl: true });
     mapRef.current = map;
+    overlayGroupRef.current = L.layerGroup().addTo(map);
     onReady?.(map);
   }, [onReady]);
 
   useEffect(() => {
     const map = mapRef.current;
     if (!map) return;
-
-    const key = project?.layout?.basemap || "light";
-    const cfg = BASEMAPS[key] || BASEMAPS.light;
-
-    if (baseLayerRef.current) {
-      map.removeLayer(baseLayerRef.current);
-    }
-
-    baseLayerRef.current = L.tileLayer(cfg.url, {
-      attribution: cfg.attribution,
-      maxZoom: 20,
-    }).addTo(map);
-  }, [project?.layout?.basemap]);
+    const cfg = BASEMAPS[project.layout.basemap] || BASEMAPS.light;
+    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
+    baseLayerRef.current = L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: 20, crossOrigin: true }).addTo(map);
+  }, [project.layout.basemap]);
 
   useEffect(() => {
     const map = mapRef.current;
     const group = overlayGroupRef.current;
     if (!map || !group) return;
-
     group.clearLayers();
 
-    (project?.layers || []).forEach((layer) => {
+    project.layers.forEach((layer) => {
       if (layer.visible === false || !layer.geojson) return;
+      const geomType = detectGeomType(layer.geojson);
+      const roleStyle = template.roleStyles[layer.role] || template.roleStyles.other;
+      const style = { ...roleStyle, ...layer.style };
 
-      const style = layer.style || {};
       const geoLayer = L.geoJSON(layer.geojson, {
         style: () => ({
-          color: style.stroke || "#54a6ff",
+          color: style.stroke || "#336",
           weight: style.strokeWidth ?? 2,
-          fillColor: style.fill || "#54a6ff",
-          fillOpacity: style.fillOpacity ?? 0.22,
+          fillColor: style.fill || "#88a",
+          fillOpacity: style.fillOpacity ?? 0.2,
           dashArray: style.dashArray || "",
         }),
-        pointToLayer: (_feature, latlng) =>
-          L.circleMarker(latlng, {
-            radius: style.markerSize ?? 10,
-            color: style.markerColor || "#111111",
-            fillColor: style.markerColor || "#111111",
+        pointToLayer: (feature, latlng) => {
+          const marker = L.circleMarker(latlng, {
+            radius: style.markerSize ?? 6,
+            color: style.markerColor || "#111",
+            fillColor: style.markerFill || style.markerColor || "#fff",
             fillOpacity: 1,
-            weight: 1,
-          }),
+            weight: style.strokeWidth ?? 1.5,
+          });
+          if (layer.role === "drillholes") {
+            marker.on("click", () => {
+              const pt = map.latLngToContainerPoint(latlng);
+              onDrillholeClick?.({
+                layerId: layer.id,
+                feature,
+                anchor: {
+                  x: (pt.x / map.getSize().x) * 100,
+                  y: (pt.y / map.getSize().y) * 100,
+                },
+              });
+            });
+          }
+          return marker;
+        },
       });
 
+      if (geomType === "line") {
+        geoLayer.setStyle({ fillOpacity: 0, color: style.stroke || "#222" });
+      }
+
       geoLayer.addTo(group);
     });
-  }, [project]);
+  }, [project, template, onDrillholeClick]);
 
   return <div ref={mapElRef} style={{ width: "100%", height: "100%" }} />;
-}
\ No newline at end of file
+}
