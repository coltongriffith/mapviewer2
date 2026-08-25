#!/usr/bin/env node
/**
 * Generates the favicon set from scratch — no external deps:
 *
 *   public/favicon.ico          16 + 32 + 48
 *   public/favicon.svg          the mark itself, for browsers that prefer it
 *   public/apple-touch-icon.png 180
 *
 * The artwork is the Claim Matrix mark from the Exploration Maps Brand
 * Package v1.0 (public/brand/exploration-maps-mark.svg): a stepped cadastral
 * territory in Mineral Slate, crossed by a white geological channel, with one
 * selected claim in Claim Copper.
 *
 * Two brand rules are obeyed here rather than approximated:
 *   - Below 24px the internal copper square is dropped and the mark goes
 *     one-colour, because a 44/480 square is well under a pixel at 16px and
 *     only muddies the silhouette.
 *   - The tile is Map White. "Mineral Slate and Claim Copper on Map White or
 *     white" is an approved treatment; a transparent mark would disappear
 *     into a dark browser tab strip.
 *
 * Everything is drawn at 4x and box-downsampled, which anti-aliases the
 * polygon, the stroked channel and the tile corners with one mechanism.
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public');

// ─── Pixel renderer ───────────────────────────────────────────────────────────

function makeCanvas(w, h) {
  // RGBA buffer
  const buf = new Uint8Array(w * h * 4);
  return {
    w, h, buf,
    set(x, y, r, g, b, a = 255) {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const i = (y * w + x) * 4;
      // Alpha-composite over current pixel
      const srcA = a / 255;
      const dstA = buf[i + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      if (outA === 0) return;
      buf[i]     = Math.round((r * srcA + buf[i]     * dstA * (1 - srcA)) / outA);
      buf[i + 1] = Math.round((g * srcA + buf[i + 1] * dstA * (1 - srcA)) / outA);
      buf[i + 2] = Math.round((b * srcA + buf[i + 2] * dstA * (1 - srcA)) / outA);
      buf[i + 3] = Math.round(outA * 255);
    },
  };
}

function fillRect(cv, x0, y0, x1, y1, r, g, b, a = 255) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      cv.set(x, y, r, g, b, a);
}

// Filled circle with anti-aliased edge
function fillCircle(cv, cx, cy, radius, r, g, b) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
    for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
      const dx = x - cx, dy = y - cy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 <= r2) {
        cv.set(x, y, r, g, b, 255);
      } else {
        // simple AA: sample sub-pixel coverage
        const dist = Math.sqrt(dist2);
        const alpha = Math.max(0, Math.min(1, radius + 0.5 - dist));
        if (alpha > 0) cv.set(x, y, r, g, b, Math.round(alpha * 255));
      }
    }
  }
}

// Rounded rectangle
function fillRoundRect(cv, x0, y0, x1, y1, rad, r, g, b) {
  // Fill interior
  fillRect(cv, x0 + rad, y0, x1 - rad, y1, r, g, b);
  fillRect(cv, x0, y0 + rad, x1, y1 - rad, r, g, b);
  // Corners
  fillCircle(cv, x0 + rad, y0 + rad, rad, r, g, b);
  fillCircle(cv, x1 - rad, y0 + rad, rad, r, g, b);
  fillCircle(cv, x0 + rad, y1 - rad, rad, r, g, b);
  fillCircle(cv, x1 - rad, y1 - rad, rad, r, g, b);
}

// ─── The Claim Matrix mark ───────────────────────────────────────────────────
//
// Coordinates are the mark's own viewBox (480 x 520), so this file and
// public/brand/exploration-maps-mark.svg can be checked against each other.

const MARK_W = 480, MARK_H = 520;

// The ink, not the artboard. The mark's viewBox carries ~15% empty margin,
// and fitting the tile to that left a 16px favicon with a mark too small to
// read. These are the bounds of what is actually drawn: the channel's left
// tail at x=18, the territory's right edge at 445, its top at 40 and the
// channel's bottom at 490.
const MARK_BOX = { x: 18, y: 40, w: 427, h: 450 };

// M60 40H180V85H410V250H445V480H30V385H60Z — a rectilinear polygon, so a
// scanline crossing test fills it exactly.
const TERRITORY = [
  [60, 40], [180, 40], [180, 85], [410, 85], [410, 250],
  [445, 250], [445, 480], [30, 480], [30, 385], [60, 385],
];

// The channel and its branch into the selected claim, stroked at 22 wide.
const CHANNEL = [
  [[18, 180], [132, 180]],
  [[132, 180], [205, 250]],
  [[205, 250], [240, 250]],
  [[240, 250], [240, 325]],
  [[240, 325], [320, 400]],
  [[320, 400], [320, 490]],
  [[205, 250], [260, 195]],
];
const CHANNEL_HALF = 11;

const SLATE = [0x14, 0x21, 0x26];
const COPPER = [0xc6, 0x53, 0x22];
const MAP_WHITE = [0xfc, 0xfb, 0xf7];
const CHANNEL_WHITE = [0xff, 0xff, 0xff];

function insidePolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearSegment(px, py, [[x1, y1], [x2, y2]], half) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  const qx = x1 + t * dx, qy = y1 + t * dy;
  return (px - qx) ** 2 + (py - qy) ** 2 <= half * half;
}

/** Paint the mark into `cv`, fitted into the box at (ox, oy) with the given scale. */
function drawMark(cv, ox, oy, scale, { copper }) {
  const x0 = Math.floor(ox), x1 = Math.ceil(ox + MARK_W * scale);
  const y0 = Math.floor(oy), y1 = Math.ceil(oy + MARK_H * scale);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // Sample at the pixel centre, in mark coordinates.
      const mx = (x + 0.5 - ox) / scale;
      const my = (y + 0.5 - oy) / scale;

      let colour = null;
      if (insidePolygon(mx, my, TERRITORY)) colour = SLATE;

      // The channel is drawn over the territory, exactly as the SVG stacks it.
      if (CHANNEL.some((seg) => nearSegment(mx, my, seg, CHANNEL_HALF))) colour = CHANNEL_WHITE;

      // Claim chamber, then the selected parcel inside it.
      if (mx >= 250 && mx < 340 && my >= 145 && my < 235) colour = CHANNEL_WHITE;
      if (copper && mx >= 273 && mx < 317 && my >= 168 && my < 212) colour = COPPER;

      if (colour) cv.set(x, y, colour[0], colour[1], colour[2], 255);
    }
  }
}

// ─── Render at a given size ───────────────────────────────────────────────────

const SS = 4; // supersample factor

function downsample(hi, size) {
  const cv = makeCanvas(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * hi.w + (x * SS + sx)) * 4;
          const pa = hi.buf[i + 3] / 255;
          r += hi.buf[i] * pa; g += hi.buf[i + 1] * pa; b += hi.buf[i + 2] * pa; a += pa;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      cv.buf[i]     = a > 0 ? Math.round(r / a) : 0;
      cv.buf[i + 1] = a > 0 ? Math.round(g / a) : 0;
      cv.buf[i + 2] = a > 0 ? Math.round(b / a) : 0;
      cv.buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return cv;
}

const TILE_PAD = 0.11;   // share of the tile edge left clear around the mark
const TILE_RADIUS = 0.16;

function renderIcon(size) {
  const W = size * SS;
  const hi = makeCanvas(W, W);

  // Map White tile. Rounded just enough to read as an icon rather than a crop.
  fillRoundRect(hi, 0, 0, W, W, Math.round(W * TILE_RADIUS), MAP_WHITE[0], MAP_WHITE[1], MAP_WHITE[2]);

  // Fit the drawn mark into the tile (xMidYMid meet).
  const inner = W * (1 - TILE_PAD * 2);
  const scale = Math.min(inner / MARK_BOX.w, inner / MARK_BOX.h);
  // drawMark works in viewBox coordinates, so offset by the box origin.
  const ox = (W - MARK_BOX.w * scale) / 2 - MARK_BOX.x * scale;
  const oy = (W - MARK_BOX.h * scale) / 2 - MARK_BOX.y * scale;

  drawMark(hi, ox, oy, scale, { copper: size >= 24 });
  return downsample(hi, size);
}

// ─── PNG encoder (minimal, no compression — uses deflate store) ──────────────

function encodePNG(cv) {
  const { w, h, buf } = cv;

  function adler32(data) {
    let s1 = 1, s2 = 0;
    for (const b of data) { s1 = (s1 + b) % 65521; s2 = (s2 + s1) % 65521; }
    return (s2 << 16) | s1;
  }

  // Build raw scanlines (filter byte 0 = None per row)
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    raw.set(buf.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }

  // zlib DEFLATE store blocks (no compression, max 65535 bytes per block)
  function zlibStore(data) {
    const BLOCK = 65535;
    const nBlocks = Math.ceil(data.length / BLOCK) || 1;
    const out = [];
    // zlib header: CMF=0x78 (deflate, window=32k), FLG — must be divisible by 31
    out.push(0x78, 0x01);
    for (let i = 0; i < nBlocks; i++) {
      const last = i === nBlocks - 1 ? 1 : 0;
      const chunk = data.subarray(i * BLOCK, Math.min((i + 1) * BLOCK, data.length));
      const len = chunk.length;
      const nlen = (~len) & 0xffff;
      out.push(last);
      out.push(len & 0xff, (len >> 8) & 0xff);
      out.push(nlen & 0xff, (nlen >> 8) & 0xff);
      for (const b of chunk) out.push(b);
    }
    const a = adler32(data);
    out.push((a >> 24) & 0xff, (a >> 16) & 0xff, (a >> 8) & 0xff, a & 0xff);
    return Uint8Array.from(out);
  }

  function crc32(data) {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    let crc = 0xffffffff;
    for (const b of data) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const typeBytes = Array.from(type).map(c => c.charCodeAt(0));
    const len = data.length;
    const payload = [...typeBytes, ...data];
    const crc = crc32(Uint8Array.from(payload));
    return [
      (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff,
      ...payload,
      (crc >> 24) & 0xff, (crc >> 16) & 0xff, (crc >> 8) & 0xff, crc & 0xff,
    ];
  }

  const sig = [137, 80, 78, 71, 13, 10, 26, 10];

  const ihdr = chunk('IHDR', [
    (w >> 24) & 0xff, (w >> 16) & 0xff, (w >> 8) & 0xff, w & 0xff,
    (h >> 24) & 0xff, (h >> 16) & 0xff, (h >> 8) & 0xff, h & 0xff,
    8,  // bit depth
    6,  // colour type: RGBA
    0, 0, 0,
  ]);

  const idat = chunk('IDAT', Array.from(zlibStore(raw)));
  const iend = chunk('IEND', []);

  return Buffer.from([...sig, ...ihdr, ...idat, ...iend]);
}

// ─── ICO encoder ─────────────────────────────────────────────────────────────

function encodeICO(sizes) {
  // sizes: array of {size, pngData}
  const n = sizes.length;
  const headerSize = 6 + n * 16;
  let offset = headerSize;
  const entries = sizes.map(({ size, pngData }) => {
    const entry = { size, pngData, offset };
    offset += pngData.length;
    return entry;
  });

  const out = [];
  // ICONDIR
  out.push(0, 0); // reserved
  out.push(1, 0); // type: ICO
  out.push(n & 0xff, (n >> 8) & 0xff);

  for (const { size, pngData, offset: off } of entries) {
    const s = size >= 256 ? 0 : size;
    out.push(s, s, 0, 0, 1, 0, 32, 0);
    const len = pngData.length;
    out.push(len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff);
    out.push(off & 0xff, (off >> 8) & 0xff, (off >> 16) & 0xff, (off >> 24) & 0xff);
  }

  for (const { pngData } of entries) {
    for (const b of pngData) out.push(b);
  }

  return Buffer.from(out);
}

// ─── Generate files ───────────────────────────────────────────────────────────

const png16  = encodePNG(renderIcon(16));
const png32  = encodePNG(renderIcon(32));
const png48  = encodePNG(renderIcon(48));
const png180 = encodePNG(renderIcon(180));

const ico = encodeICO([
  { size: 16, pngData: png16 },
  { size: 32, pngData: png32 },
  { size: 48, pngData: png48 },
]);

// The vector favicon: the same mark, on the same tile, for browsers that take
// one. Kept in step with the raster sizes above by construction.
// The nested <svg> does the same fit the raster path does — content box into
// a padded tile — without a hand-computed transform to keep in step.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480" role="img" aria-label="Exploration Maps">
  <rect width="480" height="480" rx="${Math.round(480 * TILE_RADIUS)}" fill="#fcfbf7"/>
  <svg x="${480 * TILE_PAD}" y="${480 * TILE_PAD}" width="${480 * (1 - TILE_PAD * 2)}" height="${480 * (1 - TILE_PAD * 2)}" viewBox="${MARK_BOX.x} ${MARK_BOX.y} ${MARK_BOX.w} ${MARK_BOX.h}" preserveAspectRatio="xMidYMid meet" overflow="visible">
    <path fill="#142126" d="M60 40H180V85H410V250H445V480H30V385H60Z"/>
    <path fill="none" stroke="#ffffff" stroke-width="22" stroke-linecap="butt" stroke-linejoin="miter" d="M18 180H132L205 250H240V325L320 400V490"/>
    <path fill="none" stroke="#ffffff" stroke-width="22" stroke-linecap="butt" stroke-linejoin="miter" d="M205 250L260 195"/>
    <rect x="250" y="145" width="90" height="90" fill="#ffffff"/>
    <rect x="273" y="168" width="44" height="44" fill="#c65322"/>
  </svg>
</svg>
`;

writeFileSync(join(OUT, 'favicon.ico'), ico);
writeFileSync(join(OUT, 'favicon.svg'), svg);
writeFileSync(join(OUT, 'apple-touch-icon.png'), png180);

console.log('✓ public/favicon.ico (16 + 32 + 48)');
console.log('✓ public/favicon.svg');
console.log('✓ public/apple-touch-icon.png (180×180)');
