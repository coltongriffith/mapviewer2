#!/usr/bin/env node
/**
 * Generates /public/favicon.ico (16×16 + 32×32) and /public/apple-touch-icon.png (180×180)
 * from scratch — no external deps. Design: blue (#2563eb) rounded-square background
 * with a white map-pin shape, matching the existing nav icon.
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

// Draw a map-pin shape centred at (cx, cy) scaled to pinH tall
function drawPin(cv, cx, cy, pinH, r, g, b) {
  // The pin: circle on top, teardrop point at bottom
  // Circle radius ~38% of height, centre at 35% from top
  const circR = pinH * 0.33;
  const circCY = cy - pinH * 0.18;
  fillCircle(cv, cx, circCY, circR, r, g, b);

  // Triangle body: from circle centre down to a point
  const tipY  = cy + pinH * 0.40;
  const bodyTop = circCY;
  const steps = Math.ceil(tipY - bodyTop);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const yw = bodyTop + i;
    // Width tapers from circR*1.1 to 0
    const halfW = circR * 1.1 * (1 - t);
    for (let dx = -Math.ceil(halfW); dx <= Math.ceil(halfW); dx++) {
      const alpha = Math.max(0, Math.min(1, halfW - Math.abs(dx) + 0.5));
      cv.set(Math.round(cx + dx), Math.round(yw), r, g, b, Math.round(alpha * 255));
    }
  }

  // Punch inner circle (hole) for classic pin look
  const holeR = circR * 0.38;
  fillCircle(cv, cx, circCY, holeR, 0x25, 0x63, 0xeb); // bg colour
}

// ─── Render at a given size ───────────────────────────────────────────────────

function renderIcon(size) {
  const cv = makeCanvas(size, size);
  const pad = size * 0.07;
  const rad = size * 0.22;
  // Blue background
  fillRoundRect(cv, Math.round(pad), Math.round(pad),
                    Math.round(size - pad), Math.round(size - pad),
                    Math.round(rad), 0x25, 0x63, 0xeb);
  // White pin
  const pinH = size * 0.58;
  const cx = size / 2;
  const cy = size / 2 + size * 0.03;
  drawPin(cv, cx, cy, pinH, 255, 255, 255);
  return cv;
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
const png180 = encodePNG(renderIcon(180));

const ico = encodeICO([
  { size: 16, pngData: png16 },
  { size: 32, pngData: png32 },
]);

writeFileSync(join(OUT, 'favicon.ico'), ico);
writeFileSync(join(OUT, 'apple-touch-icon.png'), png180);

console.log('✓ public/favicon.ico (16×16 + 32×32)');
console.log('✓ public/apple-touch-icon.png (180×180)');
