// Re-encode oversized landing-page PNGs as WebP at the sizes they are actually
// displayed.
//
// A PageSpeed run put /gallery/ba-after.png at 2,695 KiB — 78% of the whole
// page payload, and the LCP element. It was shipping 1448x1086 into an 870x653
// box, as PNG. Nothing about a screenshot of a map needs lossless encoding or
// double the pixels it is drawn at.
//
// Chromium does the encoding: there is no sharp/imagemagick/cwebp in this
// project, and Playwright's browser is already a build dependency. Canvas
// toDataURL('image/webp') is the same encoder the browser ships.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// width = the widest the image is ever DRAWN, x2 for high-density screens.
const TARGETS = [
  { src: 'public/gallery/ba-after.png', widths: [870, 1740], quality: 0.82 },
  { src: 'public/gallery/ba-before.png', widths: [870, 1740], quality: 0.82 },
  { src: 'public/gallery/regional.png', widths: [640, 1280], quality: 0.82 },
  { src: 'public/gallery/target.png', widths: [640, 1280], quality: 0.82 },
  { src: 'public/gallery/infrastructure.png', widths: [640, 1280], quality: 0.82 },
  { src: 'public/gallery/claims.png', widths: [640, 1280], quality: 0.82 },
  { src: 'public/gallery/drill-results.png', widths: [640, 1280], quality: 0.82 },
  { src: 'public/gallery/dark.png', widths: [640, 1280], quality: 0.82 },
];

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
});
const page = await browser.newPage();

let saved = 0;
for (const target of TARGETS) {
  const abs = path.join(ROOT, target.src);
  if (!existsSync(abs)) { console.log(`skip (missing) ${target.src}`); continue; }
  const before = readFileSync(abs).length;
  const dataUrl = `data:image/png;base64,${readFileSync(abs).toString('base64')}`;

  for (const width of target.widths) {
    const out = await page.evaluate(async ({ dataUrl: src, width: w, quality }) => {
      const img = await new Promise((res, rej) => {
        const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = src;
      });
      // Never upscale: a 2x file wider than the original just costs bytes.
      const targetW = Math.min(w, img.naturalWidth);
      const targetH = Math.round((img.naturalHeight / img.naturalWidth) * targetW);
      const canvas = document.createElement('canvas');
      canvas.width = targetW; canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetW, targetH);
      return { uri: canvas.toDataURL('image/webp', quality), w: targetW, h: targetH, natW: img.naturalWidth, natH: img.naturalHeight };
    }, { dataUrl, width, quality: target.quality });

    const buf = Buffer.from(out.uri.split(',')[1], 'base64');
    const suffix = width === target.widths[0] ? '' : '@2x';
    const dest = abs.replace(/\.png$/, `${suffix}.webp`);
    // Skip a 2x that would duplicate the 1x because the source was small.
    if (suffix && out.w === Math.min(target.widths[0], out.natW)) { console.log(`  skip @2x (source only ${out.natW}px wide)`); continue; }
    writeFileSync(dest, buf);
    console.log(`  ${path.basename(dest)} ${out.w}x${out.h} ${(buf.length / 1024).toFixed(0)} kB`);
    if (!suffix) saved += before - buf.length;
  }
  console.log(`${target.src} was ${(before / 1024).toFixed(0)} kB`);
}
console.log(`\n1x replacements save ${(saved / 1024 / 1024).toFixed(2)} MB versus the PNGs`);
await browser.close();
