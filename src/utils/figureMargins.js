// A scanned or turned figure's blank margins, made transparent.
//
// A figure turned 45° to sit north-up arrives on a white page, and the page's
// corners would draw as a white diamond over the satellite. The margin is the
// border's most common colour when at least 85% of the border is within tol
// of it; it is flood-filled from the border (4-connected, within tol), so the
// same colour inside the figure (a white title card, the legend) is kept, and
// the pixels along the fill's edge fade by their distance from it, so the
// edge has no fringe. Adapted from the logo background removal in /3d
// (src/utils/logoBackground.js, #323). Plain functions on { data, width,
// height } RGBA pixels.

const dist = (d, i, c) => Math.max(Math.abs(d[i] - c[0]), Math.abs(d[i + 1] - c[1]), Math.abs(d[i + 2] - c[2]));

/** The flat margin colour, or null: { color: [r, g, b], share } (share of the border within tol). */
export function findMargin({ data, width: w, height: h }, tol = 24) {
  if (w < 3 || h < 3) return null;
  const border = [];
  for (let x = 0; x < w; x += 1) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y += 1) border.push(y * w, y * w + w - 1);
  const solid = border.filter((p) => data[p * 4 + 3] >= 16);
  if (solid.length < border.length / 2) return null; // already transparent
  // The most common colour in buckets of 16 levels a channel, then that bucket's mean.
  const key = (i) => (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
  const n = new Map();
  solid.forEach((p) => { const k = key(p * 4); n.set(k, (n.get(k) || 0) + 1); });
  const top = [...n].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const sum = [0, 0, 0]; let c = 0;
  solid.forEach((p) => { const i = p * 4; if (key(i) === top) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; c += 1; } });
  const color = sum.map((v) => Math.round(v / c));
  const share = solid.filter((p) => dist(data, p * 4, color) <= tol).length / border.length;
  return share >= 0.85 ? { color, share } : null;
}

/** Clears the margin in place (alpha 0) with a soft one-pixel edge. Returns the share of pixels cleared. */
export function clearMargin({ data, width: w, height: h }, color, tol = 24) {
  const N = w * h, bg = new Uint8Array(N), q = new Int32Array(N);
  let head = 0, tail = 0;
  const seed = (p) => {
    if (bg[p]) return;
    if (data[p * 4 + 3] < 16) bg[p] = 1;
    else if (dist(data, p * 4, color) <= tol) { bg[p] = 1; q[tail++] = p; }
  };
  for (let x = 0; x < w; x += 1) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y += 1) { seed(y * w); seed(y * w + w - 1); }
  while (head < tail) {
    const p = q[head++], x = p % w;
    for (const nb of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (nb >= 0 && nb < N && !bg[nb] && dist(data, nb * 4, color) <= tol) { bg[nb] = 1; q[tail++] = nb; }
    }
  }
  let cleared = 0;
  for (let p = 0; p < N; p += 1) {
    const i = p * 4;
    if (bg[p]) { data[i + 3] = 0; cleared += 1; continue; }
    const x = p % w;
    const near = (x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (p >= w && bg[p - w]) || (p < N - w && bg[p + w]);
    if (!near) continue;
    const a = Math.min(1, Math.max(0.05, (dist(data, i, color) - tol) / (2 * tol)));
    if (a >= 1) continue;
    for (let k = 0; k < 3; k += 1) data[i + k] = Math.max(0, Math.min(255, Math.round((data[i + k] - color[k] * (1 - a)) / a)));
    data[i + 3] = Math.round(data[i + 3] * a);
  }
  return cleared / N;
}

/** Clears everything outside the crop rectangle (in pixels) in place. */
export function clearOutside({ data, width: w, height: h }, { x0, y0, x1, y1 }) {
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) data[(y * w + x) * 4 + 3] = 0;
    }
  }
}
