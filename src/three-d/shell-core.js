// Exploratory grade shell, step one: composites and an inverse-distance estimate on a grid.
// Pure functions with no DOM or three.js, shared by the studio (composites, grouping, defaults),
// shell-worker.js (the estimate) and the unit tests.
//
// Method (adapted from a screening envelope, not a resource estimate):
//   - 10 m length-weighted composites down each hole, from the assayed length only (gaps and
//     missing values are left out, never read as zero); a composite needs half its length assayed.
//   - At each grid point, the nearest composite from each hole; holes whose collars lie within
//     20 m of each other form one collar group and give one value, the nearest.
//   - The nearest groups, at most four, within the search radius are combined with weights
//     1 / max(d, 5 m)^2. Fewer than three groups in range: no estimate.
//   - Nothing is estimated above the terrain or collar surface.

export const SHELL = { compLen: 10, minCover: 0.5, groupDist: 20, minGroups: 3, maxGroups: 4, minDist: 5, search: 75 };

// Length-weighted composites of `len` metres along one hole, from intervals { from, to, vals }.
// Returns [{ from, to, mid, value, length }]: mid is the middle of the assayed part.
export function composite(ints, col, len = SHELL.compLen, minCover = SHELL.minCover) {
  const bins = new Map();
  for (const it of ints) {
    const v = it.vals ? it.vals[col] : it.v;
    if (!Number.isFinite(v) || !(it.to > it.from)) continue;
    for (let k = Math.floor(it.from / len); k * len < it.to; k++) {
      const a = Math.max(it.from, k * len), b = Math.min(it.to, (k + 1) * len);
      if (b <= a) continue;
      let c = bins.get(k);
      if (!c) bins.set(k, (c = { k, m: 0, l: 0, d: 0 }));
      c.m += v * (b - a); c.l += b - a; c.d += ((a + b) / 2) * (b - a);
    }
  }
  return [...bins.values()].filter((c) => c.l >= len * minCover - 1e-9).sort((p, q) => p.k - q.k)
    .map((c) => ({ from: c.k * len, to: (c.k + 1) * len, mid: c.d / c.l, value: c.m / c.l, length: c.l }));
}

// Collar groups: collars within `dist` metres of each other (chained) share a group.
// pts: [[x, y], ...]; returns an Int32Array of group numbers 0..n-1, numbered in order of first use.
export function collarGroups(pts, dist = SHELL.groupDist) {
  const n = pts.length, up = Int32Array.from({ length: n }, (_, i) => i), d2 = dist * dist;
  const find = (i) => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if ((pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2 <= d2) { const a = find(i), b = find(j); if (a !== b) up[b] = a; }
  }
  const ids = new Map(), out = new Int32Array(n);
  for (let i = 0; i < n; i++) { const r = find(i); if (!ids.has(r)) ids.set(r, ids.size); out[i] = ids.get(r); }
  return out;
}

// Cell size: about 1/40 of the block's larger horizontal side, 5-25 m.
export const autoCell = (bw, bh) => Math.max(5, Math.min(25, Math.round(Math.max(bw, bh) / 40)));

// Search radius: 75 m, or 1.5 times the median spacing between collar groups where the drilling
// is wider than 50 m apart (rounded to 5 m, at most 500 m), so a sparse program still has three in range.
export function autoSearch(pts, groups) {
  const c = new Map();
  pts.forEach(([x, y], i) => { const g = c.get(groups[i]) || { x: 0, y: 0, n: 0 }; g.x += x; g.y += y; g.n++; c.set(groups[i], g); });
  const cs = [...c.values()].map((g) => [g.x / g.n, g.y / g.n]);
  if (cs.length < 2) return SHELL.search;
  const nn = cs.map((p, i) => Math.min(...cs.filter((_, j) => j !== i).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])))).sort((a, b) => a - b);
  const med = nn[Math.floor(nn.length / 2)];
  return Math.min(500, Math.max(SHELL.search, Math.round((1.5 * med) / 5) * 5));
}

// The estimate on a regular grid. holes: [{ group, pts: [x, y, z, value, x, y, z, value, ...] }];
// grid: { x0, y0, z0, cell, nx, ny, nz }; top: optional Float32Array(nx * ny) of surface elevations.
// Returns Float32Array(nx * ny * nz), index (k * ny + j) * nx + i, NaN where there is no estimate.
export function estimate(holes, grid, o = {}) {
  const { x0, y0, z0, cell, nx, ny, nz } = grid;
  const search = o.search ?? SHELL.search, minGroups = o.minGroups ?? SHELL.minGroups, maxGroups = o.maxGroups ?? SHELL.maxGroups;
  const s2 = search * search, md2 = (o.minDist ?? SHELL.minDist) ** 2, top = o.top || null;
  const out = new Float32Array(nx * ny * nz).fill(NaN);
  const ng = holes.reduce((m, h) => Math.max(m, h.group + 1), 0), gd = new Float64Array(ng).fill(Infinity), gv = new Float64Array(ng);
  // Each hole's bounding box, so holes out of range are skipped without visiting their composites.
  const bb = holes.map(({ pts }) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let p = 0; p < pts.length; p += 4) for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], pts[p + a]); b[a + 3] = Math.max(b[a + 3], pts[p + a]); }
    return b;
  });
  const gap = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  const cand = new Int32Array(holes.length), seen = new Uint8Array(ng), touched = [];
  for (let j = 0; j < ny; j++) {
    const y = y0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell;
      // Holes in plan range of this column, and a quick count of their groups.
      let nc = 0, groupsInRange = 0;
      for (let h = 0; h < holes.length; h++) {
        const b = bb[h];
        if (gap(x, b[0], b[3]) ** 2 + gap(y, b[1], b[4]) ** 2 > s2) continue;
        cand[nc++] = h; if (!seen[holes[h].group]) { seen[holes[h].group] = 1; groupsInRange++; }
      }
      for (let c = 0; c < nc; c++) seen[holes[cand[c]].group] = 0;
      if (groupsInRange < minGroups) continue;
      const zt = top ? top[j * nx + i] : Infinity;
      for (let k = 0; k < nz; k++) {
        const z = z0 + k * cell;
        if (z > zt) break;
        for (let c = 0; c < nc; c++) {
          const h = cand[c], b = bb[h], g = holes[h].group;
          if (gap(x, b[0], b[3]) ** 2 + gap(y, b[1], b[4]) ** 2 + gap(z, b[2], b[5]) ** 2 > Math.min(s2, gd[g])) continue;
          const pts = holes[h].pts;
          for (let p = 0; p < pts.length; p += 4) {
            const d = (pts[p] - x) ** 2 + (pts[p + 1] - y) ** 2 + (pts[p + 2] - z) ** 2;
            if (d < gd[g]) { if (gd[g] === Infinity) touched.push(g); gd[g] = d; gv[g] = pts[p + 3]; }
          }
        }
        // The nearest groups in range, at most maxGroups.
        let inRange = 0;
        for (const g of touched) if (gd[g] <= s2) inRange++;
        if (inRange >= minGroups) {
          touched.sort((a, b) => gd[a] - gd[b]);
          let sw = 0, sv = 0;
          for (let t = 0; t < Math.min(maxGroups, touched.length); t++) {
            const g = touched[t]; if (gd[g] > s2) break;
            const w = 1 / Math.max(gd[g], md2); sw += w; sv += w * gv[g];
          }
          out[(k * ny + j) * nx + i] = sv / sw;
        }
        for (const g of touched) gd[g] = Infinity;
        touched.length = 0;
      }
    }
    if (o.onRow) o.onRow((j + 1) / ny);
  }
  return out;
}
