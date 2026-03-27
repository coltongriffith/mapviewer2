diff --git a/src/export/exportSVG.js b/src/export/exportSVG.js
index 698b60c7088741de132dd34ba93223721de95762..7e7ce3e13a158c13a5bd2c0748047c6cf775f64a 100644
--- a/src/export/exportSVG.js
+++ b/src/export/exportSVG.js
@@ -1,15 +1,33 @@
-export function exportSVG(scene) {
+import { loadHtml2Canvas } from "./exportPNG";
+
+export async function exportSVG(scene, options = {}) {
+  const el = scene?.container || document.querySelector(".map-container");
+  if (!el) throw new Error("Map container not found.");
+
+  const html2canvas = await loadHtml2Canvas();
+  const filename = options.filename || "map-export";
+
+  const canvas = await html2canvas(el, {
+    useCORS: true,
+    allowTaint: false,
+    backgroundColor: "#ffffff",
+    scale: 2,
+  });
+
+  const imageData = canvas.toDataURL("image/png");
+  const width = scene?.width || el.clientWidth;
+  const height = scene?.height || el.clientHeight;
+
   const svg = `<?xml version="1.0" encoding="UTF-8"?>
-<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">
-  <rect width="100%" height="100%" fill="#e5e5e5"/>
-  <text x="20" y="40" font-size="20" font-family="Arial">SVG Export Ready</text>
+<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
+  <image href="${imageData}" width="${width}" height="${height}"/>
 </svg>`;
 
   const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
   const url = URL.createObjectURL(blob);
   const a = document.createElement("a");
   a.href = url;
-  a.download = "map.svg";
+  a.download = `${filename}.svg`;
   a.click();
   URL.revokeObjectURL(url);
 }
