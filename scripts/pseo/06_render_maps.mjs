#!/usr/bin/env node
// 06 — Render a static claim map per ticker from the cached GeoJSON.
//
//   node scripts/pseo/06_render_maps.mjs            # all cached tickers
//   node scripts/pseo/06_render_maps.mjs --ticker ARM
//   node scripts/pseo/06_render_maps.mjs --skip-og  # SVG only (no Playwright)
//
// Outputs per ticker into public/companies-assets/:
//   [TICKER].svg      page map (1000×640): claims + labels + scale bar + watermark
//   [TICKER]-og.png   1200×630 raster for og:image (via headless Chromium)
//
// The map is a clean vector claim plat (no third-party basemap tiles — no tile
// licensing questions on 1,250 static pages; the in-app interactive version
// supplies the full basemap experience).

import fs from 'node:fs';
import path from 'node:path';
import { PATHS, SITE_NAME } from './config.mjs';
import { mercatorX, mercatorY, geojsonBounds, esc } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const W = 1000, H = 640, PAD = 70;
const INK = '#173042', CLAIM_FILL = '#2f8f83', CLAIM_EDGE = '#0e5b52', PAPER = '#f3efe6';

function project(bounds) {
  const x0 = mercatorX(bounds.minLng), x1 = mercatorX(bounds.maxLng);
  const y0 = mercatorY(bounds.maxLat), y1 = mercatorY(bounds.minLat);
  const spanX = Math.max(x1 - x0, 1e-9), spanY = Math.max(y1 - y0, 1e-9);
  const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
  const ox = (W - spanX * scale) / 2, oy = (H - spanY * scale) / 2;
  return (lng, lat) => [ox + (mercatorX(lng) - x0) * scale, oy + (mercatorY(lat) - y0) * scale];
}

function ringPath(ring, proj) {
  return ring.map((c, i) => {
    const [x, y] = proj(c[0], c[1]);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ') + ' Z';
}

function kmScale(bounds) {
  // metres per degree lng at centre latitude
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const mPerDegLng = 111320 * Math.cos((midLat * Math.PI) / 180);
  const spanM = (bounds.maxLng - bounds.minLng) * mPerDegLng;
  const proj = project(bounds);
  const [xA] = proj(bounds.minLng, midLat);
  const [xB] = proj(bounds.maxLng, midLat);
  const pxPerM = (xB - xA) / spanM;
  const steps = [0.5, 1, 2, 5, 10, 20, 50];
  const targetPx = 150;
  const km = steps.reduce((best, s) => (Math.abs(s * 1000 * pxPerM - targetPx) < Math.abs(best * 1000 * pxPerM - targetPx) ? s : best), steps[0]);
  return { km, px: Math.max(50, Math.min(240, km * 1000 * pxPerM)) };
}

function renderSvg(ticker, company, geojson) {
  const bounds = geojsonBounds(geojson);
  // pad bounds 12%
  const padLng = (bounds.maxLng - bounds.minLng) * 0.12 || 0.02;
  const padLat = (bounds.maxLat - bounds.minLat) * 0.12 || 0.02;
  const b = { minLng: bounds.minLng - padLng, maxLng: bounds.maxLng + padLng, minLat: bounds.minLat - padLat, maxLat: bounds.maxLat + padLat };
  const proj = project(b);

  const polys = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    const rings = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of rings) {
      polys.push(`<path d="${poly.map((r) => ringPath(r, proj)).join(' ')}" fill="${CLAIM_FILL}" fill-opacity="0.34" stroke="${CLAIM_EDGE}" stroke-width="1.6" />`);
    }
  }

  const scale = kmScale(b);
  const graticule = [];
  for (let i = 1; i < 5; i++) {
    graticule.push(`<line x1="${(W / 5) * i}" y1="0" x2="${(W / 5) * i}" y2="${H}" stroke="#d9d2c0" stroke-width="0.7" />`);
    graticule.push(`<line x1="0" y1="${(H / 5) * i}" x2="${W}" y2="${(H / 5) * i}" stroke="#d9d2c0" stroke-width="0.7" />`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">
  <rect width="${W}" height="${H}" fill="${PAPER}" />
  ${graticule.join('\n  ')}
  ${polys.join('\n  ')}
  <!-- title strip -->
  <rect x="0" y="0" width="${W}" height="54" fill="${INK}" />
  <text x="20" y="34" font-size="21" font-weight="bold" fill="#ffffff">${esc(company)} — Mineral Claims</text>
  <text x="${W - 20}" y="34" font-size="15" fill="#cfe3df" text-anchor="end">${esc(ticker)}</text>
  <!-- scale bar -->
  <g transform="translate(${W - 40 - scale.px}, ${H - 44})">
    <rect x="0" y="0" width="${scale.px / 2}" height="8" fill="${INK}" />
    <rect x="${scale.px / 2}" y="0" width="${scale.px / 2}" height="8" fill="#ffffff" stroke="${INK}" stroke-width="1" />
    <text x="${scale.px / 2}" y="-6" font-size="12" fill="${INK}" text-anchor="middle">${scale.km} km</text>
  </g>
  <!-- north arrow -->
  <g transform="translate(${W - 44}, 92)">
    <circle r="17" fill="#ffffff" stroke="#b9b09a" />
    <path d="M0 -10 L5 7 L0 3 L-5 7 Z" fill="${INK}" />
    <text y="14" font-size="9" font-weight="bold" fill="${INK}" text-anchor="middle">N</text>
  </g>
  <!-- watermark -->
  <text x="20" y="${H - 20}" font-size="13" fill="#7d8b8a">Map by ${esc(SITE_NAME)} — explorationmaps.com</text>
</svg>`;
}

async function loadChromium() {
  try { return (await import('playwright')).chromium; }
  catch {
    // Fall back to a globally installed playwright (e.g. CI images / sandboxes)
    return (await import('/opt/node22/lib/node_modules/playwright/index.mjs')).chromium;
  }
}

async function rasterizeOg(svgPath, pngPath) {
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const svg = fs.readFileSync(svgPath, 'utf8');
  await page.setContent(`<style>body{margin:0;background:${PAPER};display:flex;align-items:center;justify-content:center;height:630px}svg{width:1200px;height:630px;object-fit:cover}</style>${svg}`);
  await page.screenshot({ path: pngPath });
  await browser.close();
}

async function main() {
  const only = opt('--ticker');
  const files = fs.readdirSync(PATHS.geo).filter((f) => f.endsWith('.geojson'));
  if (!files.length) throw new Error('No cached geometry — run 05 first.');
  fs.mkdirSync(PATHS.assetsOut, { recursive: true });
  const { readCsv } = await import('./lib.mjs');
  const issuers = new Map(readCsv(PATHS.issuers).map((i) => [i.ticker, i]));

  for (const file of files) {
    const ticker = file.replace('.geojson', '');
    if (only && ticker !== only) continue;
    const company = issuers.get(ticker)?.company || ticker;
    const geojson = JSON.parse(fs.readFileSync(path.join(PATHS.geo, file), 'utf8'));
    const svg = renderSvg(ticker, company, geojson);
    const svgPath = path.join(PATHS.assetsOut, `${ticker}.svg`);
    fs.writeFileSync(svgPath, svg);
    console.log(`  ${ticker}: map → ${svgPath}`);
    if (!args.includes('--skip-og')) {
      const pngPath = path.join(PATHS.assetsOut, `${ticker}-og.png`);
      await rasterizeOg(svgPath, pngPath);
      console.log(`  ${ticker}: og → ${pngPath}`);
    }
  }
}

main().catch((err) => { console.error(`\n✗ 06_render_maps failed:\n${err.message}`); process.exit(1); });
