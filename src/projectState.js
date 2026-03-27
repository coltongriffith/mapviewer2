diff --git a/src/projectState.js b/src/projectState.js
index 1ece83ff32c111f1e43989c4a694ddc076dea886..780146a24bb27f49b1bae3a1c49aea98187429c2 100644
--- a/src/projectState.js
+++ b/src/projectState.js
@@ -1,31 +1,41 @@
+export const LAYER_ROLES = [
+  "claims",
+  "anomaly",
+  "drillholes",
+  "drill_traces",
+  "geophysics",
+  "highlight_zone",
+  "other",
+];
+
+export const ROLE_LABELS = {
+  claims: "Claims",
+  anomaly: "Anomaly",
+  drillholes: "Drillholes",
+  drill_traces: "Drill traces",
+  geophysics: "Geophysics",
+  highlight_zone: "Highlight zone",
+  other: "Other",
+};
+
 export function createInitialProjectState() {
   return {
+    template: "technical_results_v1",
     layers: [],
     layout: {
-      title: "Project Map",
-      subtitle: "Editable composition",
-      basemap: "light",
+      title: "Technical Results Map",
+      subtitle: "Exploration Figure",
       logo: null,
+      insetEnabled: true,
+      basemap: "topo",
       legendItems: [],
-      exportSettings: {
-        pixelRatio: 2,
-        filename: "mapviewer-export",
-      },
-      legendStyle: {
-        background: "#ffffff",
-        border: "#d9d9d9",
-        text: "#1f1f1f",
-        borderRadius: 10,
-        padding: 12,
-        width: 220,
-      },
-      overlays: {
-        title: { visible: true, x: 24, y: 20 },
-        legend: { visible: true, x: 24, y: 96 },
-        northArrow: { visible: true, x: 24, y: 340 },
-        scaleBar: { visible: true, x: 24, y: 410 },
-        logo: { visible: true, x: 24, y: 470, width: 140 },
-      },
+    },
+    annotations: {
+      callouts: [],
+    },
+    exportSettings: {
+      filename: "map-export",
+      pixelRatio: 3,
     },
   };
-}
\ No newline at end of file
+}
