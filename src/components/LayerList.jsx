diff --git a/src/components/LayerList.jsx b/src/components/LayerList.jsx
index 94ce051cc51a75dda23ebfe800ecfca2c5cab9ec..3efc24d20d0b9acb5ab36d9a272d684f899c909d 100644
--- a/src/components/LayerList.jsx
+++ b/src/components/LayerList.jsx
@@ -1,31 +1,19 @@
 import React from "react";
 
-export default function LayerList({
-  layers,
-  selectedLayerId,
-  onSelect,
-  onToggleVisible,
-}) {
+export default function LayerList({ layers, selectedLayerId, onSelect, onToggleVisible }) {
   return (
     <div className="layer-list">
       {layers.map((layer) => (
-        <div
-          key={layer.id}
-          className={`layer-item ${selectedLayerId === layer.id ? "active" : ""}`}
-          onClick={() => onSelect?.(layer.id)}
-        >
-          <div className="layer-name">{layer.name || "Layer"}</div>
-          <button
-            className="btn layer-toggle"
-            onClick={(e) => {
-              e.stopPropagation();
-              onToggleVisible?.(layer.id);
-            }}
-          >
+        <div key={layer.id} className={`layer-item ${selectedLayerId === layer.id ? "active" : ""}`} onClick={() => onSelect?.(layer.id)}>
+          <div className="layer-name">
+            <strong>{layer.name || "Layer"}</strong>
+            <div style={{ fontSize: 11, opacity: 0.7 }}>{layer.role || "other"}</div>
+          </div>
+          <button className="btn layer-toggle" onClick={(e) => { e.stopPropagation(); onToggleVisible?.(layer.id); }}>
             {layer.visible === false ? "Off" : "On"}
           </button>
         </div>
       ))}
     </div>
   );
 }
