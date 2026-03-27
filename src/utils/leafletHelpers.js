import L from "leaflet";

export function createBasicMap(containerId, center = [49.2827, -123.1207], zoom = 8) {
  const map = L.map(containerId, {
    center,
    zoom,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "",
  }).addTo(map);

  return map;
}
