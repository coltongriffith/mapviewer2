// Logo background removal: a logo on a white or flat-coloured background made transparent, so it sits on a map,
// a card or a block face without a box round it. Plain functions on RGBA pixels (ImageData-like { data, width,
// height }) plus a canvas wrapper; no imports, so the 2D editor can use it too. /3d loads it when a logo is added.
//
// Method: the border's most common colour is the background when at least 85% of the border is within tol of it.
// The background is then flood-filled from the border (4-connected, within tol), so the same colour inside the logo
// (white letters, a white inner ring) is kept. The pixels just outside the fill fade out by how far they are from
// the background colour, and the background's tint is taken out of them, so edges stay smooth with no white fringe.

const dist = (d, i, c) => Math.max(Math.abs(d[i] - c[0]), Math.abs(d[i + 1] - c[1]), Math.abs(d[i + 2] - c[2]));

// The flat background, or null: { color: [r, g, b], share (of the border within tol) }. An already transparent
// border (most of it under alpha 16) has nothing to remove: null.
export function findBackground({ data, width: w, height: h }, tol = 24) {
  if (w < 3 || h < 3) return null;
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const solid = border.filter((p) => data[p * 4 + 3] >= 16);
  if (solid.length < border.length / 2) return null;
  // The most common colour, in buckets of 16 levels a channel, then the mean of that bucket.
  const n = new Map(); solid.forEach((p) => { const i = p * 4, k = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4); n.set(k, (n.get(k) || 0) + 1); });
  const top = [...n].reduce((a, b) => (b[1] > a[1] ? b : a))[0], sum = [0, 0, 0]; let c = 0;
  solid.forEach((p) => { const i = p * 4; if ((data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4) === top) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; c++; } });
  const color = sum.map((v) => Math.round(v / c)), share = solid.filter((p) => dist(data, p * 4, color) <= tol).length / border.length;
  return share >= 0.85 ? { color, share } : null;
}

// Makes the background transparent in place: the fill from the border within tol, and a soft edge out to 3 × tol.
// Returns the share of pixels cleared.
export function removeBackground({ data, width: w, height: h }, color, tol = 24) {
  const N = w * h, bg = new Uint8Array(N), q = new Int32Array(N); let head = 0, tail = 0;
  const seed = (p) => { if (!bg[p] && data[p * 4 + 3] >= 16 && dist(data, p * 4, color) <= tol) { bg[p] = 1; q[tail++] = p; } else if (data[p * 4 + 3] < 16) bg[p] = 1; };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (head < tail) {
    const p = q[head++], x = p % w;
    for (const n of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (n >= 0 && n < N && !bg[n] && dist(data, n * 4, color) <= tol) { bg[n] = 1; q[tail++] = n; }
  }
  let cleared = 0;
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    if (bg[p]) { data[i + 3] = 0; cleared++; continue; }
    // The edge: a pixel next to the cleared background keeps alpha by its distance from the background colour.
    const x = p % w, near = (x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (p >= w && bg[p - w]) || (p < N - w && bg[p + w]);
    if (!near) continue;
    const a = Math.min(1, Math.max(0.05, (dist(data, i, color) - tol) / (2 * tol)));
    if (a >= 1) continue;
    for (let k = 0; k < 3; k++) data[i + k] = Math.max(0, Math.min(255, Math.round((data[i + k] - color[k] * (1 - a)) / a)));
    data[i + 3] = Math.round(data[i + 3] * a);
  }
  return cleared / N;
}

// An image (loaded) as a canvas with its flat background removed: { canvas, found } (found: the background, or null,
// when the canvas is the image unchanged). Large logos are drawn at most 1200 px a side.
export function logoWithoutBackground(img, tol = 24) {
  const w0 = img.naturalWidth || img.width || 300, h0 = img.naturalHeight || img.height || 150, k = Math.min(1, 1200 / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height), found = findBackground(px, tol);
  if (found) { removeBackground(px, found.color, tol); ctx.putImageData(px, 0, 0); }
  return { canvas: c, found };
}
