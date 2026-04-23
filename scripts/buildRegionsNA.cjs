// One-time script: downloads Natural Earth 1:110m admin-1 GeoJSON, filters to
// Canadian provinces and US states, strips unused properties, and writes a
// compact regionsNA.json for use by detectRegion.js and the auto-inset feature.
//
// Run: node scripts/buildRegionsNA.js
//
// Output: src/assets/regionsNA.json

const https = require('https');
const fs = require('fs');
const path = require('path');

const URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson';

const OUT = path.join(__dirname, '../src/assets/regionsNA.json');

function roundCoord(c) {
  return [Math.round(c[0] * 10) / 10, Math.round(c[1] * 10) / 10];
}

function simplifyRing(ring) {
  const rounded = ring.map(roundCoord);
  // Remove consecutive duplicates
  return rounded.filter((c, i) => i === 0 || c[0] !== rounded[i - 1][0] || c[1] !== rounded[i - 1][1]);
}

function getBbox(feature) {
  const coords = [];
  const g = feature.geometry;
  if (!g) return null;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  polys.forEach(poly => poly.forEach(ring => ring.forEach(c => coords.push(c))));
  if (!coords.length) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  coords.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng); minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng); maxLat = Math.max(maxLat, lat);
  });
  return [
    Math.round(minLng * 10) / 10, Math.round(minLat * 10) / 10,
    Math.round(maxLng * 10) / 10, Math.round(maxLat * 10) / 10,
  ];
}

function extractPolygons(feature) {
  const g = feature.geometry;
  if (!g) return [];
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  // Return outer ring of each polygon only (skip holes)
  return polys.map(poly => simplifyRing(poly[0]));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'mapviewer-build/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('Downloading Natural Earth 1:50m admin-1 data...');
  const geojson = await fetchJson(URL);
  console.log(`Downloaded. ${geojson.features.length} features total.`);

  const regions = [];
  for (const feat of geojson.features) {
    const p = feat.properties;
    const isCA = p.iso_a2 === 'CA';
    const isUS = p.iso_a2 === 'US';
    if (!isCA && !isUS) continue;

    const name = p.name || p.gn_name || p.gns_name || '';
    // For Canada, only keep first-level admin regions (provinces/territories)
    if (isCA && p.type_en !== 'Province' && p.type_en !== 'Territory') continue;

    const abbrev = (p.iso_3166_2 || '').split('-')[1] || p.postal || p.abbrev || '';
    const bbox = getBbox(feat);
    if (!bbox) continue;

    const coordinates = extractPolygons(feat);
    if (!coordinates.length) continue;

    const country = p.iso_a2;
    regions.push({
      id: `${country}-${abbrev}`,
      name,
      abbrev,
      country,
      bbox,
      coordinates,
    });
  }

  console.log(`Kept ${regions.length} regions (CA + US).`);

  // Sort: Canada first, then US, both alphabetical
  regions.sort((a, b) => {
    if (a.country !== b.country) return a.country === 'CA' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  fs.writeFileSync(OUT, JSON.stringify(regions));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`Written to ${OUT} (${kb} KB, ${regions.length} regions)`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
