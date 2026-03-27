import React, { useEffect, useRef } from "react";
import L from "leaflet";

const BASEMAPS = {
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  topo: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
};

export default function InsetMap({ mainMap, basemap }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const rectRef = useRef(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: false, attributionControl: false, dragging: false });
    mapRef.current = map;
    L.tileLayer(BASEMAPS[basemap] || BASEMAPS.light, { crossOrigin: true }).addTo(map);
  }, [basemap]);

  useEffect(() => {
    const inset = mapRef.current;
    if (!inset || !mainMap) return;

    const sync = () => {
      const bounds = mainMap.getBounds();
      inset.fitBounds(bounds.pad(3), { animate: false });
      if (!rectRef.current) rectRef.current = L.rectangle(bounds, { color: "#cc2f2f", weight: 1.5, fillOpacity: 0 }).addTo(inset);
      rectRef.current.setBounds(bounds);
    };

    sync();
    mainMap.on("moveend zoomend", sync);
    return () => mainMap.off("moveend zoomend", sync);
  }, [mainMap]);

  return <div ref={elRef} style={{ width: "100%", height: "100%" }} />;
}
