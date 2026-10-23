// Synthetic figures: speckled "imagery", then lines, symbols and lettering
// drawn in flat colours, anti-aliased by 4×4 supersampling.

export function canvas(w, h, seed = 7, base = [78, 98, 66]) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < w * h; i += 1) {
    const n = (rnd() - 0.5) * 36;
    data[i * 4] = base[0] + n; data[i * 4 + 1] = base[1] + n; data[i * 4 + 2] = base[2] + n; data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}
// Paint with coverage from an inside(x, y) test over the box.
export function paint(img, box, colour, inside) {
  const [x0, y0, x1, y1] = box.map(Math.round);
  for (let y = Math.max(0, y0 - 1); y <= Math.min(img.height - 1, y1 + 1); y += 1) {
    for (let x = Math.max(0, x0 - 1); x <= Math.min(img.width - 1, x1 + 1); x += 1) {
      let c = 0;
      for (let j = 0; j < 4; j += 1) for (let i = 0; i < 4; i += 1) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) c += 1;
      if (!c) continue;
      const a = c / 16, o = (y * img.width + x) * 4;
      for (let k = 0; k < 3; k += 1) img.data[o + k] = img.data[o + k] * (1 - a) + colour[k] * a;
    }
  }
}
const segDist = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
export function segment(img, a, b, width, colour) {
  const r = width / 2;
  paint(img, [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r], colour, (x, y) => segDist(x, y, a, b) <= r);
}
// A dashed line along a polyline: on/off in px.
export function dashed(img, pts, width, colour, on, off) {
  let carry = 0, drawing = true;
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const L = Math.hypot(bx - ax, by - ay);
    let t = 0;
    while (t < L) {
      const left = (drawing ? on : off) - carry, step = Math.min(left, L - t);
      if (drawing) segment(img, [ax + ((bx - ax) * t) / L, ay + ((by - ay) * t) / L], [ax + ((bx - ax) * (t + step)) / L, ay + ((by - ay) * (t + step)) / L], width, colour);
      t += step; carry += step;
      if (carry >= (drawing ? on : off) - 1e-9) { carry = 0; drawing = !drawing; }
    }
  }
}
export function polygon(img, pts, colour) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  paint(img, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], colour, (x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}
export const star = (cx, cy, r, turn = 0) => Array.from({ length: 10 }, (_, i) => { const a = turn + (i * Math.PI) / 5 - Math.PI / 2, q = i % 2 ? r * 0.45 : r; return [cx + q * Math.cos(a), cy + q * Math.sin(a)]; });
export const diamond = (cx, cy, r) => [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
export const square = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
export const triangle = (cx, cy, r) => [0, 1, 2].map((i) => [cx + r * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 3), cy + r * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 3)]);
export const circle = (img, cx, cy, r, colour) => paint(img, [cx - r, cy - r, cx + r, cy + r], colour, (x, y) => Math.hypot(x - cx, y - cy) <= r);

// A 5×7 pixel font for a few capitals and digits, drawn at `size` px a cell.
const FONT = {
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
export function text(img, str, x, y, cellPx, colour) {
  [...str].forEach((ch, k) => {
    const rows = FONT[ch];
    rows.forEach((row, j) => [...row].forEach((bit, i) => {
      if (bit === '1') paint(img, [x + (k * 6 + i) * cellPx, y + j * cellPx, x + (k * 6 + i + 1) * cellPx, y + (j + 1) * cellPx], colour, () => true);
    }));
  });
}

export const BLACK = [20, 20, 24], GOLD = [242, 184, 36], WHITE = [255, 255, 255], GREY = [150, 150, 160];

