// Fitting a company figure to the ground from a few known points.
//
// A figure arrives as a picture: a geology map out of a news release, often
// turned so the drilling runs across the page (Tower's Fig. 2 sits at about
// 45°). The person clicks two to four places on it and says where they are —
// a collar with known coordinates, a grid-line crossing, or the matching spot
// on the satellite map — or clicks a grid label along the frame, which fixes
// only an easting or only a northing.
//
// Every one of those is a linear equation in the transform's parameters, so
// the fit is ordinary least squares:
//   similarity (scale, rotation, shift; 4 parameters) from two points, so the
//     picture keeps its shape;
//   affine (6 parameters, so a stretched or sheared scan is honoured too)
//     once both the eastings and the northings have three independent clicks.
// With more equations than parameters the leftovers are the fit error, shown
// in metres per point and as an RMS, which is how a mistyped coordinate shows.
//
// Pure maths in a metric grid (UTM metres): no proj4 and no DOM, so it runs
// in tests and in the dialog alike. Pixel y runs down the image.

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The usable constraints: a pixel and at least one of easting / northing. */
export function usableConstraints(points) {
  return (points || []).filter((p) => p && finite(p.x) && finite(p.y) && (finite(p.e) || finite(p.n)));
}

// Least squares through the normal equations, solved by Gaussian elimination
// with partial pivoting. The systems are 3×3 or 4×4, centred and scaled to
// ±1 first, so a pivot under 1e-4 of the diagonal means the clicks barely
// pin the transform down (three points almost in a line, or grid labels all
// along one edge, whose two-pixel jitter would otherwise decide the turn).
function solveLeastSquares(rows, rhs, k) {
  const A = Array.from({ length: k }, () => new Float64Array(k + 1));
  rows.forEach((r, i) => {
    for (let a = 0; a < k; a += 1) {
      for (let b = 0; b < k; b += 1) A[a][b] += r[a] * r[b];
      A[a][k] += r[a] * rhs[i];
    }
  });
  const scale = Math.max(1e-12, ...A.map((row, i) => Math.abs(row[i])));
  for (let col = 0; col < k; col += 1) {
    let piv = col;
    for (let r = col + 1; r < k; r += 1) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < scale * 1e-4) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < k; r += 1) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= k; c += 1) A[r][c] -= f * A[col][c];
    }
  }
  return Array.from({ length: k }, (_, i) => A[i][k] / A[i][i]);
}

const mean = (vals) => vals.reduce((s, v) => s + v, 0) / (vals.length || 1);

/**
 * Fit pixel → grid. `points` are { x, y, e?, n? } (pixels; metres). `mode` is
 * 'auto' (affine when the clicks allow it, else similarity), 'similarity' or
 * 'affine'. Returns { kind, a, b, c, d, e, f, residuals, rms, exact, scale,
 * rotation } with E = a·x + b·y + c and N = d·x + e·y + f, or { error }.
 */
export function fitTransform(points, { mode = 'auto' } = {}) {
  const pts = usableConstraints(points);
  const withE = pts.filter((p) => finite(p.e));
  const withN = pts.filter((p) => finite(p.n));
  if (withE.length + withN.length < 4 || !withE.length || !withN.length) {
    return { error: 'Add at least two points (or grid labels for both eastings and northings).' };
  }
  // Centred on the clicks and on the coordinates, so 5 000 000 m northings do
  // not eat the precision of a 2 m residual.
  const x0 = mean(pts.map((p) => p.x)), y0 = mean(pts.map((p) => p.y));
  const e0 = mean(withE.map((p) => p.e)), n0 = mean(withN.map((p) => p.n));
  const s = Math.max(1, ...pts.map((p) => Math.max(Math.abs(p.x - x0), Math.abs(p.y - y0))));
  const X = (p) => (p.x - x0) / s, Y = (p) => (p.y - y0) / s;

  let t = null;
  if (mode !== 'similarity' && withE.length >= 3 && withN.length >= 3) {
    const ue = solveLeastSquares(withE.map((p) => [X(p), Y(p), 1]), withE.map((p) => p.e - e0), 3);
    const un = solveLeastSquares(withN.map((p) => [X(p), Y(p), 1]), withN.map((p) => p.n - n0), 3);
    if (ue && un) {
      t = { kind: 'affine', a: ue[0] / s, b: ue[1] / s, c: ue[2] + e0, d: un[0] / s, e: un[1] / s, f: un[2] + n0, unknowns: 6 };
    }
  }
  if (!t && mode === 'affine') return { error: 'An affine fit needs three points that are not in a line (or three of each grid label).' };
  if (!t) {
    // E = p·x + q·y + c, N = q·x − p·y + f: a rotation and one scale, with the
    // image's downward y turned to the map's northward one.
    const rows = [...withE.map((p) => [X(p), Y(p), 1, 0]), ...withN.map((p) => [-Y(p), X(p), 0, 1])];
    const rhs = [...withE.map((p) => p.e - e0), ...withN.map((p) => p.n - n0)];
    const u = solveLeastSquares(rows, rhs, 4);
    if (u) {
      const p = u[0] / s, q = u[1] / s;
      t = { kind: 'similarity', a: p, b: q, c: u[2] + e0, d: q, e: -p, f: u[3] + n0, unknowns: 4 };
    } else {
      // Eastings read along one edge and northings along another cannot show
      // a turn: such a figure is taken as north-up (scale and shift only).
      const v = solveLeastSquares([...withE.map((p) => [X(p), 1, 0]), ...withN.map((p) => [-Y(p), 0, 1])], rhs, 3);
      if (!v) return { error: 'These clicks do not fix the figure: add a point away from the others.' };
      t = { kind: 'north-up', a: v[0] / s, b: 0, c: v[1] + e0, d: 0, e: -v[0] / s, f: v[2] + n0, unknowns: 3 };
    }
  }
  // Translate the centred offsets back to the image origin.
  t.c -= t.a * x0 + t.b * y0;
  t.f -= t.d * x0 + t.e * y0;
  const det = t.a * t.e - t.b * t.d;
  if (!finite(det) || Math.abs(det) < 1e-12) return { error: 'The points collapse the figure to a line: check the coordinates.' };

  const residuals = pts.map((p) => {
    const [E, N] = applyFit(t, p.x, p.y);
    const de = finite(p.e) ? E - p.e : null;
    const dn = finite(p.n) ? N - p.n : null;
    return { de, dn, r: Math.hypot(de || 0, dn || 0) };
  });
  const equations = withE.length + withN.length;
  const sq = residuals.reduce((sum, r) => sum + r.r * r.r, 0);
  const rms = Math.sqrt(sq / pts.length);
  const { unknowns, ...rest } = t;
  return {
    ...rest,
    residuals,
    rms,
    // As many equations as unknowns: the fit passes through every click, so
    // a zero error says nothing. One more point makes it a check.
    exact: equations <= unknowns,
    // Metres per pixel, and how far the figure is drawn turned from north-up
    // (anticlockwise positive: its north points up and to the left), for the
    // summary line.
    scale: Math.sqrt(Math.abs(det)),
    rotation: (-Math.atan2(t.d, t.a) * 180) / Math.PI,
  };
}

export function applyFit(t, x, y) {
  return [t.a * x + t.b * y + t.c, t.d * x + t.e * y + t.f];
}

export function invertFit(t, E, N) {
  const det = t.a * t.e - t.b * t.d;
  const dx = E - t.c, dy = N - t.f;
  return [(t.e * dx - t.b * dy) / det, (-t.d * dx + t.a * dy) / det];
}

/** The plain-words summary under the point table. */
export function describeFit(t) {
  if (!t || t.error) return t?.error || '';
  const kind = { affine: 'Affine', similarity: 'Similarity', 'north-up': 'North-up (no rotation seen)' }[t.kind];
  const rot = Math.abs(t.rotation) < 0.05 ? 'north-up' : `drawn turned ${Math.abs(t.rotation).toFixed(1)}° ${t.rotation > 0 ? 'anticlockwise' : 'clockwise'}`;
  const err = t.exact ? 'exact fit: add a point to check it' : `RMS error ${formatMetres(t.rms)}`;
  return `${kind} · ${rot} · ${t.scale.toFixed(t.scale < 10 ? 2 : 1)} m per pixel · ${err}`;
}

export function formatMetres(m) {
  if (!finite(m)) return '–';
  return m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`;
}
