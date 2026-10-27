/* Generalized mineralized footprint
 * Plan-view outline of drill intercepts >= threshold:
 *   stamp intercepts (25 m) -> dilate 170 m -> erode 120 m (morphological closing + growth)
 *   -> marching squares -> keep rings > minArea -> Chaikin smoothing.
 * Raster-based (exact Euclidean distance transform), metres, no dependencies.
 */
type P2 = [number, number];

export interface FootprintOpts { cell?: number; stamp?: number; grow?: number; shrink?: number; minArea?: number; smooth?: number }

export function footprintRings(intercepts: P2[][], o: FootprintOpts = {}): P2[][] {
  const cell = o.cell ?? 10, stamp = o.stamp ?? 25, grow = o.grow ?? 170, shrink = o.shrink ?? 120, minArea = o.minArea ?? 5e4, smooth = o.smooth ?? 4;
  const pts = intercepts.flat(); if (!pts.length) return [];
  const pad = stamp + grow + 2 * cell;
  const bb = pts.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
  const x0 = bb[0] - pad, y0 = bb[1] - pad;
  const nx = Math.ceil((bb[2] + pad - x0) / cell) + 1, ny = Math.ceil((bb[3] + pad - y0) / cell) + 1;
  const n = nx * ny;
  if (!Number.isFinite(n) || n > 4000000) throw new Error('Footprint extent is too large; turn off the generalized footprint.');
  const A = new Uint8Array(n);
  // 1. stamp intercept traces
  const r = Math.ceil(stamp / cell);
  const dot = (x: number, y: number) => { const ci = Math.round((x - x0) / cell), cj = Math.round((y - y0) / cell);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if ((i * i + j * j) * cell * cell <= stamp * stamp) { const I = ci + i, J = cj + j; if (I >= 0 && J >= 0 && I < nx && J < ny) A[J * nx + I] = 1; } };
  for (const line of intercepts) for (let k = 0; k < line.length; k++) {
    if (k === 0) { dot(...line[0]); continue; }
    const [ax, ay] = line[k - 1], [bx, by] = line[k], L = Math.hypot(bx - ax, by - ay), s = Math.max(1, Math.ceil(L / (cell / 2)));
    for (let t = 1; t <= s; t++) dot(ax + (bx - ax) * t / s, ay + (by - ay) * t / s);
  }
  // 2. grow then shrink (distance transforms)
  const dIn = edt(A, nx, ny), B = new Uint8Array(n); for (let k = 0; k < n; k++) B[k] = dIn[k] * cell * cell <= grow * grow ? 1 : 0;
  const inv = new Uint8Array(n); for (let k = 0; k < n; k++) inv[k] = B[k] ? 0 : 1;
  const dOut = edt(inv, nx, ny), Cm = new Float32Array(n); for (let k = 0; k < n; k++) Cm[k] = dOut[k] * cell * cell > shrink * shrink ? 1 : 0;
  // 3. contour (0.5 iso on a lightly blurred mask)
  const F = blur(Cm, nx, ny);
  return marching(F, nx, ny, .5).map(rg => rg.map(([i, j]) => [x0 + i * cell, y0 + j * cell] as P2))
    .filter(rg => Math.abs(area(rg)) >= minArea).map(rg => chaikin(rg, smooth));
}

/* exact squared EDT (Felzenszwalb–Huttenlocher): distance (in cells²) to nearest 1-cell */
function edt(mask: Uint8Array, nx: number, ny: number): Float64Array {
  const INF = 1e20, f = new Float64Array(Math.max(nx, ny)), d = new Float64Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) d[k] = mask[k] ? 0 : INF;
  const pass = (len: number, get: (i: number) => number, set: (i: number, v: number) => void) => {
    for (let i = 0; i < len; i++) f[i] = get(i);
    const v = new Int32Array(len), z = new Float64Array(len + 1); let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) { let s: number; do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k]) k--; else break; } while (k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
    k = 0; for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; set(q, (q - v[k]) * (q - v[k]) + f[v[k]]); }
  };
  for (let i = 0; i < nx; i++) pass(ny, j => d[j * nx + i], (j, val) => { d[j * nx + i] = val; });
  for (let j = 0; j < ny; j++) pass(nx, i => d[j * nx + i], (i, val) => { d[j * nx + i] = val; });
  return d;
}
function blur(a: Float32Array, nx: number, ny: number) { const o = new Float32Array(a.length);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let s = 0, c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const I = i + di, J = j + dj; if (I >= 0 && J >= 0 && I < nx && J < ny) { s += a[J * nx + I]; c++; } } o[j * nx + i] = s / c; }
  return o; }

/* marching squares -> closed rings (grid coordinates) */
function marching(F: Float32Array, nx: number, ny: number, iso: number): P2[][] {
  const segs: [P2, P2][] = [], v = (i: number, j: number) => F[j * nx + i];
  const lerp = (i0: number, j0: number, i1: number, j1: number): P2 => { const a = v(i0, j0), b = v(i1, j1), t = (iso - a) / ((b - a) || 1e-9); return [i0 + (i1 - i0) * t, j0 + (j1 - j0) * t]; };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const c = (v(i, j) > iso ? 1 : 0) | (v(i + 1, j) > iso ? 2 : 0) | (v(i + 1, j + 1) > iso ? 4 : 0) | (v(i, j + 1) > iso ? 8 : 0);
    if (c === 0 || c === 15) continue;
    const e = [lerp(i, j, i + 1, j), lerp(i + 1, j, i + 1, j + 1), lerp(i, j + 1, i + 1, j + 1), lerp(i, j, i, j + 1)]; // bottom,right,top,left
    const T: Record<number, number[][]> = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 2], [0, 1]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[2, 0]], 10: [[0, 3], [1, 2]], 11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]] };
    for (const [a, b] of T[c]) segs.push([e[a], e[b]]);
  }
  const key = (p: P2) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`, next = new Map<string, number>();
  segs.forEach((s, k) => next.set(key(s[0]), k));
  const used = new Uint8Array(segs.length), rings: P2[][] = [];
  for (let k = 0; k < segs.length; k++) { if (used[k]) continue; const ring: P2[] = []; let q = k;
    while (q !== undefined && !used[q]) { used[q] = 1; ring.push(segs[q][0]); q = next.get(key(segs[q][1]))!; }
    if (ring.length > 3) { ring.push(ring[0]); rings.push(ring); } }
  return rings;
}
function area(r: P2[]) { let s = 0; for (let k = 0; k < r.length - 1; k++) s += r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1]; return s / 2; }
function chaikin(r: P2[], n: number): P2[] {
  // thin to ~every 3rd vertex first, then corner-cut
  let c = r.filter((_, i) => i % 8 === 0); c.push(c[0]);
  for (let it = 0; it < n; it++) { const q: P2[] = [];
    for (let i = 0; i < c.length - 1; i++) { const [a, b] = [c[i], c[i + 1]]; q.push([.75 * a[0] + .25 * b[0], .75 * a[1] + .25 * b[1]], [.25 * a[0] + .75 * b[0], .25 * a[1] + .75 * b[1]]); }
    q.push(q[0]); c = q; }
  return c.filter((_, i) => i % 2 === 0 || i === c.length - 1);
}
