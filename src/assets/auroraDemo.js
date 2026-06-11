/**
 * Aurora Ridge Minerals — Cedar Ridge Project demo data.
 * Mirrors the landing-page "investor map" example: a blocky staked-claims
 * package (dissolved to one outline), drill collars, and three gold dashed
 * target areas with intercept callouts. Located in northwestern BC.
 */

const CENTER_LAT = 55.45;
const CENTER_LNG = -127.2;
const KM_PER_DEG_LAT = 111.32;
const KM_PER_DEG_LNG = KM_PER_DEG_LAT * Math.cos((CENTER_LAT * Math.PI) / 180);

const toLngLat = (xKm, yKm) => [
  +(CENTER_LNG + xKm / KM_PER_DEG_LNG).toFixed(6),
  +(CENTER_LAT + yKm / KM_PER_DEG_LAT).toFixed(6),
];

// ── Claims: a grid of 500 m staked cells forming an irregular blob.
// The app's "Dissolve inner borders" feature merges them into one outline.
const CELL_KM = 0.5;
const claimCells = [];
for (let iy = -8; iy <= 8; iy += 1) {
  for (let ix = -8; ix <= 8; ix += 1) {
    const x = ix * CELL_KM;
    const y = iy * CELL_KM;
    // superellipse mask with deterministic edge jitter for a staked look
    const jitter = Math.sin(ix * 12.9898 + iy * 78.233) * 0.14;
    const d = Math.pow(Math.abs(x) / 3.9, 1.7) + Math.pow(Math.abs(y) / 3.6, 1.7);
    if (d > 1 + jitter) continue;
    const x0 = x - CELL_KM / 2; const x1 = x + CELL_KM / 2;
    const y0 = y - CELL_KM / 2; const y1 = y + CELL_KM / 2;
    claimCells.push({
      type: 'Feature',
      properties: { TenureID: `AR-${1041 + claimCells.length}`, Owner: 'Aurora Ridge Minerals Corp.' },
      geometry: {
        type: 'Polygon',
        coordinates: [[toLngLat(x0, y0), toLngLat(x1, y0), toLngLat(x1, y1), toLngLat(x0, y1), toLngLat(x0, y0)]],
      },
    });
  }
}

export const auroraClaims = { type: 'FeatureCollection', features: claimCells };

// ── Drill collars (positions in km offsets east/north of center)
const COLLARS = [
  { x: -2.6, y: 1.6,  id: 'CR-24-01', result: '1.4 g/t Au over 2.36 m' },
  { x: -2.2, y: 1.1,  id: 'CR-24-02', result: '0.9 g/t Au over 4.1 m' },
  { x: -3.0, y: 0.9,  id: 'CR-24-03', result: '0.3 g/t Au over 1.8 m' },
  { x: 0.2,  y: 1.5,  id: 'CR-24-04', result: '0.6 g/t Au over 3.0 m' },
  { x: 2.3,  y: 1.7,  id: 'CR-24-05', result: '2.45 g/t Au over 9 m' },
  { x: 2.4,  y: 0.8,  id: 'CR-24-06', result: '1.1 g/t Au over 6.2 m' },
  { x: -0.6, y: 0.2,  id: 'CR-24-07', result: '0.4 g/t Au over 2.2 m' },
  { x: -1.9, y: -0.1, id: 'CR-24-08', result: '0.2 g/t Au over 1.1 m' },
  { x: 0.4,  y: -0.7, id: 'CR-24-09', result: '0.5 g/t Au over 2.9 m' },
  { x: 1.4,  y: -0.8, id: 'CR-24-10', result: '0.7 g/t Au over 3.4 m' },
  { x: 2.0,  y: -0.3, id: 'CR-24-11', result: '0.3 g/t Au over 1.6 m' },
  { x: -1.6, y: -1.9, id: 'CR-24-12', result: '0.81% Cu over 22 m' },
  { x: -0.9, y: -2.3, id: 'CR-24-13', result: '0.55% Cu over 14 m' },
  { x: 0.3,  y: -1.5, id: 'CR-24-14', result: '0.2% Cu over 8 m' },
];

export const auroraDrillholes = {
  type: 'FeatureCollection',
  features: COLLARS.map((c) => ({
    type: 'Feature',
    properties: { HoleID: c.id, result: c.result, Status: 'Complete' },
    geometry: { type: 'Point', coordinates: toLngLat(c.x, c.y) },
  })),
};

// ── Target areas: rotated ellipses rendered as dashed gold polygons
function ellipsePolygon(cxKm, cyKm, rxKm, ryKm, rotDeg, name) {
  const rot = (rotDeg * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i <= 48; i += 1) {
    const t = (i / 48) * Math.PI * 2;
    const ex = rxKm * Math.cos(t);
    const ey = ryKm * Math.sin(t);
    const x = cxKm + ex * Math.cos(rot) - ey * Math.sin(rot);
    const y = cyKm + ex * Math.sin(rot) + ey * Math.cos(rot);
    pts.push(toLngLat(x, y));
  }
  return {
    type: 'Feature',
    properties: { Name: name },
    geometry: { type: 'Polygon', coordinates: [pts] },
  };
}

export const auroraTargets = {
  type: 'FeatureCollection',
  features: [
    ellipsePolygon(-1.85, 1.25, 1.3, 0.7, -25, 'Target A'),
    ellipsePolygon(2.0, 1.1, 0.9, 1.15, 8, 'Target B'),
    ellipsePolygon(-1.05, -1.75, 1.5, 0.75, -28, 'Target C'),
  ],
};

// ── Intercept callouts anchored to the headline collar in each target
const calloutAnchor = (xKm, yKm) => {
  const [lng, lat] = toLngLat(xKm, yKm);
  return { lat, lng };
};

export const auroraCallouts = [
  {
    text: 'Target A',
    subtext: '1.4 g/t @ 2.36 Au',
    type: 'leader',
    priority: 1,
    anchor: calloutAnchor(-2.6, 1.6),
    offset: { x: 70, y: -100 },
    boxWidth: 150,
    style: { background: '#ffffff', border: '#0b3533', textColor: '#0b3533', subtextColor: '#13554f', fontSize: 13, paddingX: 12, paddingY: 9 },
  },
  {
    text: 'Target B',
    subtext: '9 m @ 2.45 Au',
    type: 'leader',
    priority: 1,
    anchor: calloutAnchor(2.4, 0.8),
    offset: { x: 90, y: -16 },
    boxWidth: 150,
    style: { background: '#ffffff', border: '#0b3533', textColor: '#0b3533', subtextColor: '#13554f', fontSize: 13, paddingX: 12, paddingY: 9 },
  },
  {
    text: 'Target C',
    subtext: '22 m @ 0.81% Cu',
    type: 'leader',
    priority: 1,
    anchor: calloutAnchor(-0.9, -2.3),
    offset: { x: 95, y: 14 },
    boxWidth: 160,
    style: { background: '#ffffff', border: '#0b3533', textColor: '#0b3533', subtextColor: '#13554f', fontSize: 13, paddingX: 12, paddingY: 9 },
  },
];
