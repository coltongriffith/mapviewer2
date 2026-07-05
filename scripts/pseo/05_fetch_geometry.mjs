#!/usr/bin/env node
// 05 — Cache claim geometry per matched ticker → data/pseo/geo/[TICKER].geojson
//
//   node scripts/pseo/05_fetch_geometry.mjs             # all tickers in matches.csv
//   node scripts/pseo/05_fetch_geometry.mjs --ticker ARM
//   node scripts/pseo/05_fetch_geometry.mjs --fixture   # synthesize plausible blocks
//
// BC: WFS GetFeature with CQL owner filter (geometry included).
// ON: ArcGIS layer query with holder filter, f=geojson.
// Each feature carries {claim_id, claim_name, area_ha, good_to_date} properties
// so the renderer and page tables share one source of truth.

import fs from 'node:fs';
import path from 'node:path';
import { resolvePaths, BC_WFS, ON_ARCGIS } from './config.mjs';
import { readCsv, fetchJson, isExpired } from './lib.mjs';

const args = process.argv.slice(2);
const PATHS = resolvePaths(args.includes('--fixture'));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

async function bcGeometry(ownerRaw) {
  const F = BC_WFS.fields;
  const cql = `${F.owner}='${ownerRaw.replace(/'/g, "''")}'`;
  const url = `${BC_WFS.base}?${new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
    outputFormat: 'application/json', typeNames: BC_WFS.typeName,
    srsName: 'EPSG:4326', CQL_FILTER: cql, count: '2000',
  })}`;
  const j = await fetchJson(url, { timeoutMs: 120000 });
  return (j.features || [])
    // Live query returns tenures past their good-to date (pending forfeiture) —
    // filter here too or expired polygons land back on the page map/table.
    .filter((f) => !isExpired(f.properties?.[F.goodTo]))
    .map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        claim_id: f.properties?.[F.tenureId] ?? '',
        claim_name: f.properties?.[F.claimName] ?? '',
        area_ha: f.properties?.[F.areaHa] ?? '',
        good_to_date: String(f.properties?.[F.goodTo] ?? '').slice(0, 10),
        province: 'BC',
      },
    }));
}

async function onGeometry(ownerRaw, layerId) {
  const meta = await fetchJson(`${ON_ARCGIS.service}/${layerId}?f=json`);
  const fields = (meta.fields || []).map((f) => f.name);
  const ownerField = ON_ARCGIS.ownerFields.find((f) => fields.includes(f));
  const numField = ON_ARCGIS.numberFields.find((f) => fields.includes(f));
  // Same due-date preference as 03 — needed both for the page table and to
  // filter out claims already past their due date.
  const dateField = fields.find((f) => /DUE|EXPIR|GOOD_TO|END_DATE/i.test(f))
    || fields.find((f) => /ANNIVERSARY/i.test(f)) || null;
  const params = new URLSearchParams({
    f: 'geojson', outFields: '*', returnGeometry: 'true',
    where: `UPPER(${ownerField}) = UPPER('${ownerRaw.replace(/'/g, "''")}')`,
    outSR: '4326', resultRecordCount: '2000',
  });
  const j = await fetchJson(`${ON_ARCGIS.service}/${layerId}/query?${params}`, { timeoutMs: 120000 });
  const fmtDate = (v) => {
    if (v == null || v === '') return '';
    const n = Number(v);
    if (Number.isFinite(n) && n > 10_000_000_000) return new Date(n).toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  };
  return (j.features || [])
    .map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        claim_id: f.properties?.[numField] ?? '',
        claim_name: '',
        area_ha: f.properties?.AREA_HA ?? f.properties?.HECTARES ?? '',
        good_to_date: dateField ? fmtDate(f.properties?.[dateField]) : '',
        province: 'ON',
      },
    }))
    .filter((f) => !isExpired(f.properties.good_to_date));
}

// Fixture mode: synthesize a contiguous cluster of rectangular cells per claim
// row so the render + stats pipeline runs without network. Deterministic per
// ticker (seeded by char codes) so re-runs are stable.
function synthesize(ticker, claimRows) {
  let seed = [...ticker].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const baseLng = -127.5 + rand() * 6;   // northern BC-ish
  const baseLat = 54.2 + rand() * 2.4;
  const cellW = 0.028, cellH = 0.018;
  const cols = Math.max(2, Math.ceil(Math.sqrt(claimRows.length)));
  return claimRows.map((c, i) => {
    const gx = i % cols, gy = Math.floor(i / cols);
    const jitter = (rand() - 0.5) * 0.002;
    const x0 = baseLng + gx * cellW + jitter;
    const y0 = baseLat + gy * cellH + jitter;
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x0 + cellW, y0], [x0 + cellW, y0 + cellH], [x0, y0 + cellH], [x0, y0]]] },
      properties: { claim_id: c.claim_id, claim_name: c.claim_name, area_ha: c.area_ha, good_to_date: c.good_to_date, province: c.province },
    };
  });
}

async function main() {
  const matches = readCsv(PATHS.matches);
  const only = opt('--ticker');
  const fixture = args.includes('--fixture');
  const byTicker = new Map();
  for (const m of matches) {
    if (only && m.ticker !== only) continue;
    if (!byTicker.has(m.ticker)) byTicker.set(m.ticker, []);
    byTicker.get(m.ticker).push(m);
  }
  if (!byTicker.size) {
    if (only) throw new Error(`--ticker ${only} not found in matches.csv.`);
    // Zero matches is valid (e.g. every claim expired) — 07 still runs and
    // removes the now-unpublishable pages, so don't kill the pipeline here.
    console.warn('  ! matches.csv has no rows — nothing to fetch');
    fs.mkdirSync(PATHS.geo, { recursive: true });
    return;
  }
  fs.mkdirSync(PATHS.geo, { recursive: true });

  const allClaims = [PATHS.claimsBc, PATHS.claimsOn]
    .filter((f) => fs.existsSync(f))
    .flatMap((f) => readCsv(f));

  const layerId = opt('--layer') ?? ON_ARCGIS.layer;
  for (const [ticker, rows] of byTicker) {
    let features = [];
    if (fixture) {
      const owners = new Set(rows.map((r) => r.owner_raw));
      const claimRows = allClaims.filter((c) => owners.has(c.owner_raw));
      features = synthesize(ticker, claimRows);
    } else {
      for (const m of rows) {
        if (m.province === 'BC') features.push(...await bcGeometry(m.owner_raw));
        else if (m.province === 'ON') {
          if (layerId == null) throw new Error('Ontario geometry needs --layer N (from 03 --discover).');
          features.push(...await onGeometry(m.owner_raw, layerId));
        }
      }
    }
    if (!features.length) { console.warn(`  ! ${ticker}: no geometry returned — skipping`); continue; }
    const out = path.join(PATHS.geo, `${ticker}.geojson`);
    fs.writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
    console.log(`  ${ticker}: ${features.length} claim polygons → ${out}`);
  }
}

main().catch((err) => { console.error(`\n✗ 05_fetch_geometry failed:\n${err.message}`); process.exit(1); });
