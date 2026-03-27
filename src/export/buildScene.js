diff --git a/src/export/buildScene.js b/src/export/buildScene.js
index 43857d6cb81c845e920ffc9e3836b9f161500ff8..2e44d08f40205c91d493e2ce4fa887e354665353 100644
--- a/src/export/buildScene.js
+++ b/src/export/buildScene.js
@@ -1,10 +1,17 @@
 import { createScene } from "./types";
 
-function getContainerSize(mapContainer) {
+export function buildScene(mapContainer, project, map) {
   const rect = mapContainer?.getBoundingClientRect?.();
+  const width = Math.round(rect?.width || mapContainer?.offsetWidth || 1600);
+  const height = Math.round(rect?.height || mapContainer?.offsetHeight || 1000);
 
-  return {
-    width:
-      Math.round(rect?.width || 0) ||
-      mapContainer?.offsetWidth ||
-      1600,
\ No newline at end of file
+  return createScene({
+    width,
+    height,
+    layers: project.layers,
+    layout: project.layout,
+    map,
+    container: mapContainer,
+    project,
+  });
+}
