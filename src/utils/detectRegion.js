// Point-in-polygon detection for Canadian provinces and US states.
// Used to auto-identify the region where uploaded claims are located.

import regionsData from '../assets/regionsNA.json';

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInRegion(pt, region) {
  return region.coordinates.some(ring => pointInRing(pt, ring));
}

export async function detectRegion(bounds) {
  if (!bounds) return null;
  const cx = (bounds.minLng + bounds.maxLng) / 2;
  const cy = (bounds.minLat + bounds.maxLat) / 2;

  const regions = regionsData;
  if (!regions.length) return null;

  // Bbox pre-filter
  const candidates = regions.filter(
    r => cx >= r.bbox[0] && cx <= r.bbox[2] && cy >= r.bbox[1] && cy <= r.bbox[3]
  );

  // PIP test on candidates
  for (const r of candidates) {
    if (pointInRegion([cx, cy], r)) return r;
  }

  // Fallback: nearest bbox centroid among candidates
  if (candidates.length > 0) {
    let best = candidates[0];
    let bestDist = Infinity;
    for (const r of candidates) {
      const rcx = (r.bbox[0] + r.bbox[2]) / 2;
      const rcy = (r.bbox[1] + r.bbox[3]) / 2;
      const d = (cx - rcx) ** 2 + (cy - rcy) ** 2;
      if (d < bestDist) { bestDist = d; best = r; }
    }
    return best;
  }

  return null;
}
