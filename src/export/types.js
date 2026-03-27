diff --git a/src/export/types.js b/src/export/types.js
index e7634325c9f96de141cce99213b29f28d8e040d5..fef6670af908eecb895223c8bc120754b7e41795 100644
--- a/src/export/types.js
+++ b/src/export/types.js
@@ -1,9 +1,11 @@
-export function createScene({ width, height, layers, layout, map }) {
+export function createScene({ width, height, layers, layout, map, container, project }) {
   return {
     width,
     height,
     layers,
     layout,
     map,
+    container,
+    project,
   };
 }
