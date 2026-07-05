#!/usr/bin/env node
// 03 — Pull active Ontario mining claims (holder + attributes) into
// data/pseo/claims_on.csv from the LIO MLAS ArcGIS service (the same service
// api/claims.js queries live). LIO URLs move — --discover fails loudly and
// prints the layer list so the right polygon layer can be pinned.
//
//   node scripts/pseo/03_fetch_claims_on.mjs --discover      # list layers+fields
//   node scripts/pseo/03_fetch_claims_on.mjs --layer 4       # full paged pull
//   node scripts/pseo/03_fetch_claims_on.mjs --fixture

import path from 'node:path';
import { resolvePaths, ON_ARCGIS } from './config.mjs';
import { readCsv, writeCsv, fetchJson } from './lib.mjs';

const args = process.argv.slice(2);
const PATHS = resolvePaths(args.includes('--fixture'));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

async function discover() {
  console.log(`Discovering ${ON_ARCGIS.service} …`);
  const svc = await fetchJson(`${ON_ARCGIS.service}?f=json`);
  if (!svc.layers?.length) throw new Error('Service metadata has no layers — LIO URL has moved. Find the new MLAS service and update config.mjs.');
  console.log('\nLayers:');
  for (const l of svc.layers) console.log(`  [${l.id}] ${l.name}`);
  const claimLayer = svc.layers.find((l) => /claim/i.test(l.name) && !/historic|abandon/i.test(l.name));
  if (claimLayer) {
    const meta = await fetchJson(`${ON_ARCGIS.service}/${claimLayer.id}?f=json`);
    console.log(`\nLikely claims layer [${claimLayer.id}] ${claimLayer.name} — fields:`);
    for (const f of meta.fields || []) console.log(`  ${f.name} (${f.type})`);
    console.log(`\nRe-run with: --layer ${claimLayer.id}`);
  } else {
    console.log('\nNo obvious claims layer — inspect the list above and pass --layer N.');
  }
}

async function fullPull(layerId) {
  const base = `${ON_ARCGIS.service}/${layerId}/query`;
  const meta = await fetchJson(`${ON_ARCGIS.service}/${layerId}?f=json`);
  const fields = (meta.fields || []).map((f) => f.name);
  const ownerField = ON_ARCGIS.ownerFields.find((f) => fields.includes(f));
  const numField = ON_ARCGIS.numberFields.find((f) => fields.includes(f));
  if (!ownerField || !numField) {
    throw new Error(`Layer ${layerId} lacks expected owner/number fields.\n  has: ${fields.join(', ')}`);
  }
  const areaField = fields.find((f) => /AREA|HECTARE/i.test(f)) || null;
  // "Good-to" = the claim's due/expiry date; prefer that over the assessment
  // anniversary when both exist (Ontario layer 1 has CLAIM_DUE_DATE + ANNIVERSARY_DATE).
  const dateField = fields.find((f) => /DUE|EXPIR|GOOD_TO|END_DATE/i.test(f))
    || fields.find((f) => /ANNIVERSARY/i.test(f)) || null;
  const nameField = fields.find((f) => /CLAIM_NAME|TITLE_NAME|NAME/i.test(f) && f !== ownerField) || null;
  console.log(`  owner=${ownerField} num=${numField} area=${areaField} date=${dateField}`);

  const rows = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      f: 'json', where: '1=1', outFields: '*', returnGeometry: 'false',
      resultOffset: String(offset), resultRecordCount: String(ON_ARCGIS.pageSize),
      orderByFields: numField,
    });
    console.log(`  page @ ${offset}…`);
    const j = await fetchJson(`${base}?${params}`, { timeoutMs: 120000 });
    if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error)}`);
    const feats = j.features || [];
    for (const f of feats) {
      const a = f.attributes || {};
      rows.push({
        claim_id: a[numField] ?? '',
        claim_name: nameField ? (a[nameField] ?? '') : '',
        owner_raw: a[ownerField] ?? '',
        area_ha: areaField ? (a[areaField] ?? '') : '',
        good_to_date: dateField ? fmtEpoch(a[dateField]) : '',
        type: 'Mining claim',
        province: 'ON',
      });
    }
    if (!j.exceededTransferLimit && feats.length < ON_ARCGIS.pageSize) break;
    offset += ON_ARCGIS.pageSize;
    if (offset > 800000) throw new Error('Paging runaway — aborting.');
  }
  if (!rows.length) throw new Error('Zero Ontario claims returned — wrong layer?');
  writeCsv(PATHS.claimsOn, rows);
}

function fmtEpoch(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (Number.isFinite(n) && n > 10_000_000_000) return new Date(n).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

async function main() {
  if (args.includes('--fixture')) {
    const rows = readCsv(path.join(PATHS.fixtures, 'claims_on_fixture.csv'));
    console.log(`Fixture mode: ${rows.length} ON claims`);
    writeCsv(PATHS.claimsOn, rows);
    return;
  }
  if (args.includes('--discover')) return discover();
  const layer = opt('--layer') ?? ON_ARCGIS.layer;
  if (layer == null) throw new Error('Run --discover first, verify the claims layer id, then pass --layer N.');
  await fullPull(layer);
}

main().catch((err) => { console.error(`\n✗ 03_fetch_claims_on failed:\n${err.message}`); process.exit(1); });
