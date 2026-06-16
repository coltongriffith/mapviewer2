// Self-contained dotted world map for the admin "live visitors" view.
// Continents are approximated as a union of ellipses (no external map data /
// dependencies). A coarse grid is tested against the ellipses to produce land
// dots. Live-visitor pings are projected with the same equirectangular mapping.
//
// Projection (equirectangular), viewBox 0 0 360 180:
//   x = lon + 180     (lon -180..180 -> 0..360)
//   y = 90 - lat      (lat  90..-90 -> 0..180)

export const MAP_W = 360;
export const MAP_H = 180;

export function project(lon, lat) {
  return { x: lon + 180, y: 90 - lat };
}

// [centerLon, centerLat, radiusLon, radiusLat]
const CONTINENTS = [
  // North America
  [-100, 45, 32, 20], [-95, 65, 33, 10], [-152, 64, 11, 6], [-92, 19, 11, 9],
  // Greenland
  [-42, 73, 11, 7],
  // South America
  [-60, -20, 16, 25], [-65, 1, 13, 9],
  // Europe
  [18, 50, 18, 10], [18, 62, 7, 8],
  // Africa
  [16, 22, 24, 14], [22, -8, 18, 20],
  // Asia
  [95, 58, 55, 16], [75, 42, 30, 14], [47, 30, 13, 11],
  [78, 22, 12, 12], [105, 12, 13, 10], [110, 35, 18, 12],
  // Oceania / islands
  [134, -25, 17, 11], [120, -2, 14, 5], [138, 38, 4, 7], [172, -42, 4, 5],
];

function isLand(lon, lat) {
  for (const [cx, cy, rx, ry] of CONTINENTS) {
    const dx = (lon - cx) / rx;
    const dy = (lat - cy) / ry;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

// Precompute land dots once (cheap).
export const LAND_DOTS = (() => {
  const dots = [];
  const step = 3.4;
  for (let lat = 78; lat >= -56; lat -= step) {
    for (let lon = -180; lon <= 180; lon += step) {
      if (isLand(lon, lat)) {
        const { x, y } = project(lon, lat);
        dots.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
      }
    }
  }
  return dots;
})();
