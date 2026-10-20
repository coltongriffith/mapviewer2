// Exploratory grade shell, step two: a smooth surface through the estimated grid.
// Marching cubes with shared vertices, then light Taubin smoothing. Pure: used by
// shell-worker.js and the unit tests.
import { MC_TRIS } from './mc-table.js';
import { estimate } from './shell-core.js';

// Edge e of a cube runs from corner offset (di, dj, dk) along axis a (Bourke's numbering).
const EDGES = [[0, 0, 0, 0], [1, 0, 0, 1], [0, 1, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0], [1, 0, 1, 1], [0, 1, 1, 0], [0, 0, 1, 1], [0, 0, 0, 2], [1, 0, 0, 2], [1, 1, 0, 2], [0, 1, 0, 2]];
const CORNERS = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];

// The surface where the field crosses `iso`, as positions in metres from the grid origin
// (x0, y0, z0) and triangle indices. Points without an estimate (NaN) and the grid's outside
// count as below the level, so every piece is closed.
export function marchingCubes(field, grid, iso) {
  const { cell, nx, ny, nz } = grid, P = nx + 2, Q = ny + 2, R = nz + 2, lo = iso > 0 ? 0 : iso - 1;
  const f = new Float32Array(P * Q * R).fill(lo);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = field[(k * ny + j) * nx + i]; if (Number.isFinite(v)) f[((k + 1) * Q + j + 1) * P + i + 1] = v;
  }
  const stride = [1, P, P * Q], vid = new Int32Array(P * Q * R * 3).fill(-1), pos = [], idx = [];
  const corner = CORNERS.map(([a, b, c]) => a + b * P + c * P * Q);
  for (let c = 0; c < R - 1; c++) for (let b = 0; b < Q - 1; b++) for (let a = 0; a < P - 1; a++) {
    const q = a + b * P + c * P * Q; let ci = 0;
    for (let n = 0; n < 8; n++) if (f[q + corner[n]] < iso) ci |= 1 << n;
    if (ci === 0 || ci === 255) continue;
    for (const e of MC_TRIS[ci]) {
      const [di, dj, dk, ax] = EDGES[e], p = q + di + dj * P + dk * P * Q, key = p * 3 + ax;
      let id = vid[key];
      if (id < 0) {
        const fa = f[p], fb = f[p + stride[ax]], t = fb === fa ? 0.5 : (iso - fa) / (fb - fa);
        id = vid[key] = pos.length / 3;
        pos.push((a + di - 1 + (ax === 0 ? t : 0)) * cell, (b + dj - 1 + (ax === 1 ? t : 0)) * cell, (c + dk - 1 + (ax === 2 ? t : 0)) * cell);
      }
      idx.push(id);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

// Taubin smoothing (alternating shrink and inflate), which rounds off the grid steps without
// shrinking the body. In place; neighbours come from the triangle edges.
export function smoothMesh(positions, indices, passes = 2) {
  const n = positions.length / 3, deg = new Int32Array(n + 1);
  for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) { deg[indices[t + e] + 1] += 2; }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const nb = new Int32Array(deg[n]), fill = deg.slice(0, n);
  for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = indices[t + e], b = indices[t + (e + 1) % 3], c = indices[t + (e + 2) % 3];
    nb[fill[a]++] = b; nb[fill[a]++] = c;
  }
  const tmp = new Float32Array(positions.length);
  for (let s = 0; s < passes * 2; s++) {
    const lam = s % 2 ? -0.53 : 0.5;
    for (let i = 0; i < n; i++) {
      const d0 = deg[i], d1 = deg[i + 1]; let x = 0, y = 0, z = 0;
      if (d1 === d0) { tmp[i * 3] = positions[i * 3]; tmp[i * 3 + 1] = positions[i * 3 + 1]; tmp[i * 3 + 2] = positions[i * 3 + 2]; continue; }
      for (let k = d0; k < d1; k++) { const m = nb[k] * 3; x += positions[m]; y += positions[m + 1]; z += positions[m + 2]; }
      const w = 1 / (d1 - d0);
      tmp[i * 3] = positions[i * 3] + lam * (x * w - positions[i * 3]);
      tmp[i * 3 + 1] = positions[i * 3 + 1] + lam * (y * w - positions[i * 3 + 1]);
      tmp[i * 3 + 2] = positions[i * 3 + 2] + lam * (z * w - positions[i * 3 + 2]);
    }
    positions.set(tmp);
  }
  return positions;
}

// The whole shell from a worker message: { holes, grid, top, search, iso, field? }. A field from an
// earlier build of the same inputs skips the estimate (a new cut-off only re-runs the surface).
export function buildShell(m, onProgress) {
  const t0 = Date.now();
  const field = m.field || estimate(m.holes, m.grid, { search: m.search, top: m.top, onRow: onProgress && ((p) => onProgress(p * 0.9)) });
  let cells = 0, estimated = 0;
  for (const v of field) if (Number.isFinite(v)) { estimated++; if (v >= m.iso) cells++; }
  const { positions, indices } = marchingCubes(field, m.grid, m.iso);
  smoothMesh(positions, indices);
  if (onProgress) onProgress(1);
  return { field, positions, indices, stats: { cells, estimated, triangles: indices.length / 3, vertices: positions.length / 3, ms: Date.now() - t0 } };
}
