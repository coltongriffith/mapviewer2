import { describe, it, expect } from 'vitest';
import proj4 from 'proj4';
import { computeGridTicks, getMapFrame, solveEdge } from '../src/utils/coordinateFrame.js';

// B1 acceptance: every UTM tick on the coordinate frame lands within 1 px of
// where that grid line really crosses the frame rule, at zooms 14–19.
//
// The map here is real Web Mercator (Leaflet's projection, fractional zoom),
// not the flat fake the other frame tests use, and the ground truth is
// independent of the code under test: proj4's inverse Transverse Mercator
// walks the grid line itself (easting fixed, northing varied) until it meets
// the frame edge in container pixels.

function mercatorMap({ lat, lng, zoom, w = 1600, h = 1000 }) {
  const world = 256 * 2 ** zoom;
  const project = (la, ln) => {
    const s = Math.sin((la * Math.PI) / 180);
    return { x: (world * (ln + 180)) / 360, y: world * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) };
  };
  const c = project(lat, lng);
  return {
    getSize: () => ({ x: w, y: h }),
    latLngToContainerPoint: ([la, ln]) => { const p = project(la, ln); return { x: p.x - c.x + w / 2, y: p.y - c.y + h / 2 }; },
    containerPointToLatLng: ([x, y]) => {
      const wx = x - w / 2 + c.x, wy = y - h / 2 + c.y;
      const ln = (wx / world) * 360 - 180;
      const la = (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / world))) * 180) / Math.PI;
      return { lat: la, lng: ln };
    },
  };
}

const utmDef = (zone, south) => `+proj=utm +zone=${zone} ${south ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`;

// Where the grid line `value` (an easting, or a northing) crosses the frame
// edge, found by moving ALONG THE GRID LINE with proj4's inverse.
function trueCrossing(map, def, axis, value, edge, edgeAt, guess) {
  const toPx = (other) => {
    const [ln, la] = proj4(def, 'WGS84', axis === 'e' ? [value, other] : [other, value]);
    return map.latLngToContainerPoint([la, ln]);
  };
  // Bracket the other coordinate around the guess, then bisect on the pixel
  // coordinate that must equal the edge's.
  const along = (p) => (edge === 'h' ? p.y : p.x) - edgeAt;
  let a = guess - 20000, b = guess + 20000;
  let fa = along(toPx(a));
  for (let i = 0; i < 80; i += 1) {
    const m = (a + b) / 2, fm = along(toPx(m));
    if (fm * fa <= 0) b = m; else { a = m; fa = fm; }
  }
  const p = toPx((a + b) / 2);
  return edge === 'h' ? p.x : p.y;
}

// Each map is centred on a grid intersection, so even at z19 (a ~300 m wide
// frame, one 250 m interval) every edge carries at least one tick to check.
const CASES = [
  // The reported case: UTM 10N at 50.6°N, the 663 250E tick at z17.5.
  { name: 'lat 50.6 (UTM 10N, 663 250E)', e: 663250, n: 5607750, zone: 10, south: false },
  { name: 'southern hemisphere (UTM 50S, Pilbara)', e: 650000, n: 7484000, zone: 50, south: true },
  { name: 'high latitude (UTM 8N, 68.4°N, 2.6° west of the central meridian)', e: 394000, n: 7590000, zone: 8, south: false },
].map((c) => {
  const [lng, lat] = proj4(utmDef(c.zone, c.south), 'WGS84', [c.e, c.n]);
  return { ...c, lat, lng };
});
const ZOOMS = [14, 15, 16, 17, 17.5, 18, 19];

describe('UTM frame ticks are within 1 px of the true grid crossing', () => {
  const frame = getMapFrame({ templateId: 'ni_43101_technical' }, { width: 1600, height: 1000 });

  for (const c of CASES) {
    for (const zoom of ZOOMS) {
      it(`${c.name} at z${zoom}`, () => {
        const map = mercatorMap({ lat: c.lat, lng: c.lng, zoom });
        const t = computeGridTicks(map, frame, 1);
        expect(t.zone).toBe(c.zone);
        expect(t.hemisphere).toBe(c.south ? 'S' : 'N');
        const def = utmDef(c.zone, c.south);
        const centreE = c.e, centreN = c.n;
        let checked = 0;
        for (const [edge, y] of [['top', frame.top], ['bottom', frame.bottom]]) {
          expect(t[edge].length).toBeGreaterThan(0);
          for (const { px, easting } of t[edge]) {
            const truth = trueCrossing(map, def, 'e', easting, 'h', y, centreN);
            expect(Math.abs(px - truth)).toBeLessThan(1);
            checked += 1;
          }
        }
        for (const [edge, x] of [['left', frame.left], ['right', frame.right]]) {
          expect(t[edge].length).toBeGreaterThan(0);
          for (const { py, northing, label } of t[edge]) {
            const n = c.south ? northing + 10000000 : northing;
            expect(label.replace(/\D/g, '')).toBe(String(Math.round(n)));
            const truth = trueCrossing(map, def, 'n', n, 'v', x, centreE);
            expect(Math.abs(py - truth)).toBeLessThan(1);
            checked += 1;
          }
        }
        expect(checked).toBeGreaterThanOrEqual(4);
      });
    }
  }

  it('puts 663 250E where it belongs at z17.5, which the old flat placement missed by tens of pixels', () => {
    const c = CASES[0];
    const map = mercatorMap({ lat: c.lat, lng: c.lng, zoom: 17.5 });
    const t = computeGridTicks(map, frame, 1);
    const tick = t.top.find((k) => k.easting === 663250);
    expect(tick).toBeTruthy();
    const def = utmDef(10, false);
    const truth = trueCrossing(map, def, 'e', 663250, 'h', frame.top, c.n);
    expect(Math.abs(tick.px - truth)).toBeLessThan(1);
    // What the previous code drew on both the top and bottom edges: the
    // easting turned into a longitude with a flat metres-per-degree at the
    // centre's latitude. Kept to show the size of the bug it fixes.
    const A = 6378137, F = 1 / 298.257223563, E2 = 2 * F - F * F, K0 = 0.9996;
    const latR = (c.lat * Math.PI) / 180;
    const mPerLngRad = (K0 * A * Math.cos(latR)) / Math.sqrt(1 - E2 * Math.sin(latR) ** 2);
    const oldLng = -123 + ((663250 - 500000) / mPerLngRad) * (180 / Math.PI);
    const oldPx = map.latLngToContainerPoint([c.lat, oldLng]).x;
    expect(Math.abs(oldPx - truth)).toBeGreaterThan(10);
  });
});

describe('solveEdge', () => {
  it('finds every multiple of the interval, once, in order', () => {
    const hits = solveEdge((t) => 1000 + 3 * t, 0, 100, 50);
    expect(hits.map((h) => h.v)).toEqual([1000, 1050, 1100, 1150, 1200, 1250, 1300]);
    for (const h of hits) expect(Math.abs(1000 + 3 * h.t - h.v)).toBeLessThan(1e-3);
  });

  it('works when the value falls along the edge (northings down the page)', () => {
    const hits = solveEdge((t) => 5000 - t * t, 0, 50, 500);
    expect(hits.map((h) => h.v)).toEqual([5000, 4500, 4000, 3500, 3000, 2500]);
    for (const h of hits) expect(Math.abs(5000 - h.t * h.t - h.v)).toBeLessThan(1e-2);
  });

  it('returns nothing for an empty edge or interval', () => {
    expect(solveEdge((t) => t, 10, 10, 1)).toEqual([]);
    expect(solveEdge((t) => t, 0, 10, 0)).toEqual([]);
  });
});
