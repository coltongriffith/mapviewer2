// A dense 2D drill plan, shaped like a real one (the report that prompted it:
// 39 collars with traces and 7 intercept callouts on a satellite basemap):
// 39 collars on six SW-facing fences 230 m apart over ~1.5 × 1.2 km, holes 60–170 m
// apart along a fence, a few pad pairs ~30 m apart, every hole with a trace,
// and seven intercept cards. Synthetic numbers; nothing here is anyone's data.
//
// The map is a Web-Mercator stand-in at a 16:9 editor stage (1333 × 750
// logical px, the size exports scale from) at 2 m/px.

const LAT0 = 50.62, LNG0 = -120.55;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos(LAT0 * Math.PI / 180);
export const STAGE = { width: 1333, height: 750 };
export const METRES_PER_PX = 2;

const at = (east, north) => ({ lat: LAT0 + north / M_PER_DEG_LAT, lng: LNG0 + east / M_PER_DEG_LNG });

// Six fences, NW–SE, 230 m apart; holes stepped along each with a fixed
// pseudo-random jitter so the plan is irregular but the same every run.
const FENCES = [7, 7, 6, 7, 6, 6];
const jitter = (i, k) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
export const collars = [];
FENCES.forEach((count, f) => {
  let along = -420 + jitter(f, 1) * 60;
  for (let h = 0; h < count; h += 1) {
    const n = collars.length;
    // Every fifth hole is a second hole off the same pad, ~30 m from the first.
    along += h === 0 ? 0 : n % 5 === 0 ? 30 : 60 + jitter(n, 2) * 110;
    const across = -575 + f * 230 + (jitter(n, 3) - 0.5) * 40;
    // Fence direction NW–SE (bearing 135°): along → (sin, -cos), across ⟂.
    const e = along * Math.SQRT1_2 + across * Math.SQRT1_2;
    const nn = -along * Math.SQRT1_2 + across * Math.SQRT1_2;
    collars.push({
      hole_id: `RN-25-${String(n + 1).padStart(3, '0')}`,
      ...at(e, nn),
      azimuth: 225 + Math.round((jitter(n, 4) - 0.5) * 30),
      dip: -(50 + Math.round(jitter(n, 5) * 20)),
      length: 150 + Math.round(jitter(n, 6) * 250),
    });
  }
});

// Where a hole ends in plan (as utils/drillTraces.js traceEnd, flat-earth at this size).
const toe = (c) => {
  const h = c.length * Math.cos(Math.abs(c.dip) * Math.PI / 180), b = c.azimuth * Math.PI / 180;
  return [c.lng + (h * Math.sin(b)) / M_PER_DEG_LNG, c.lat + (h * Math.cos(b)) / M_PER_DEG_LAT];
};

/** The collar layer as the editor holds it after import: each collar, then its trace. */
export const collarGeojson = {
  type: 'FeatureCollection',
  features: collars.flatMap((c) => {
    const properties = { hole_id: c.hole_id, azimuth: c.azimuth, dip: c.dip, length: c.length };
    return [
      { type: 'Feature', id: c.hole_id, geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties },
      { type: 'Feature', id: c.hole_id, geometry: { type: 'LineString', coordinates: [[c.lng, c.lat], toe(c)] }, properties: { ...properties, _trace: true, _azimuth: c.azimuth, _dip: c.dip, _length: c.length } },
    ];
  }),
};

const lats = collars.map((c) => c.lat), lngs = collars.map((c) => c.lng);
/** The middle of the collars' extent. */
export const PLAN_CENTER = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };

/** A Leaflet stand-in: container px for a lat/lng, centred on the plan. */
export function planMap({ width = STAGE.width, height = STAGE.height, metresPerPx = METRES_PER_PX } = {}) {
  const { lat: cLat, lng: cLng } = PLAN_CENTER;
  return {
    getSize: () => ({ x: width, y: height }),
    latLngToContainerPoint: (ll) => {
      const [lat, lng] = Array.isArray(ll) ? ll : [ll.lat, ll.lng];
      return { x: width / 2 + ((lng - cLng) * M_PER_DEG_LNG) / metresPerPx, y: height / 2 - ((lat - cLat) * M_PER_DEG_LAT) / metresPerPx };
    },
    on() {}, off() {}, getContainer: () => null,
  };
}

// A hole-ID label exactly as the editor makes one: click the collar, Add
// callout (App.jsx handleFeatureClick → addCalloutAtAnchor).
const style = { background: '#ffffff', border: '#102640', textColor: '#0f172a', subtextColor: '#475569', fontSize: 12, paddingX: 10, paddingY: 8 };
export const holeIdCallout = (c) => ({
  id: `id-${c.hole_id}`, text: c.hole_id, subtext: '', type: 'leader', priority: 2,
  anchor: { lat: c.lat, lng: c.lng }, offset: { x: 20, y: -18 },
  featureId: c.hole_id, layerId: 'collars', boxWidth: 188, style: { ...style },
});

// Seven intercepts, on the holes a release would pick.
const INTERCEPTS = [[3, '45.0 m @ 0.42% Cu', 'incl. 12.0 m @ 1.05% Cu'], [9, '88.5 m @ 0.31% Cu'], [14, '22.0 m @ 0.67% Cu, 0.21 g/t Au'],
  [20, '61.0 m @ 0.38% Cu'], [26, '15.5 m @ 1.12% Cu', 'incl. 4.0 m @ 2.9% Cu'], [31, '40.0 m @ 0.29% Cu'], [36, '33.0 m @ 0.51% Cu']];
export const interceptCallouts = () => INTERCEPTS.map(([i, text, sub]) => ({
  id: `int-${collars[i].hole_id}`, text: `${collars[i].hole_id}: ${text}`, subtext: sub || '', type: 'leader', priority: 1,
  anchor: { lat: collars[i].lat, lng: collars[i].lng }, offset: { x: 20, y: -18 },
  featureId: collars[i].hole_id, layerId: 'collars', boxWidth: 188, style: { ...style },
}));

/** The figure's callouts: every hole labelled, plus the intercept cards. */
export const planCallouts = () => [...interceptCallouts(), ...collars.map(holeIdCallout)];
