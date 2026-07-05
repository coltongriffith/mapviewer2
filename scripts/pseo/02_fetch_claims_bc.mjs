#!/usr/bin/env node
// 02 — Pull every active BC mineral tenure (owner + attributes, no geometry)
// into data/pseo/claims_bc.csv. Geometry is fetched later, per matched ticker.
//
//   node scripts/pseo/02_fetch_claims_bc.mjs --discover   # print schema, exit
//   node scripts/pseo/02_fetch_claims_bc.mjs              # full paged pull
//   node scripts/pseo/02_fetch_claims_bc.mjs --fixture    # bundled fixture
//
// Uses the exact WFS layer the live app queries (api/bc-claims.js):
// pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW — OGL-BC open data, but
// confirm MTO terms before the public launch (plan: Risks).

import path from 'node:path';
import { resolvePaths, BC_WFS } from './config.mjs';
import { readCsv, writeCsv, fetchJson, isExpired } from './lib.mjs';

const args = process.argv.slice(2);
const PATHS = resolvePaths(args.includes('--fixture'));

function wfsUrl(params) {
  const base = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
    outputFormat: 'application/json',
    typeNames: BC_WFS.typeName,
    srsName: 'EPSG:4326',
    ...params,
  });
  return `${BC_WFS.base}?${base.toString()}`;
}

async function discover() {
  console.log('Discovering BC WFS schema (1 feature)…');
  const j = await fetchJson(wfsUrl({ count: '1' }));
  const f = j.features?.[0];
  if (!f) throw new Error('WFS returned no features — layer name may have changed.');
  console.log('\nFields on the layer:');
  for (const [k, v] of Object.entries(f.properties)) console.log(`  ${k} = ${JSON.stringify(v)}`);
  console.log('\nCompare with BC_WFS.fields in config.mjs; update there if names differ.');
}

async function fullPull() {
  const F = BC_WFS.fields;
  const rows = [];
  let expired = 0;
  let startIndex = 0;
  for (;;) {
    const url = wfsUrl({
      count: String(BC_WFS.pageSize),
      startIndex: String(startIndex),
      propertyName: Object.values(F).join(','),
      sortBy: F.tenureId,
    });
    console.log(`  page @ ${startIndex}…`);
    const j = await fetchJson(url, { timeoutMs: 120000 });
    const feats = j.features || [];
    for (const f of feats) {
      const p = f.properties || {};
      // The layer keeps tenures past their good-to date (pending forfeiture) —
      // those must never be published as held claims.
      if (isExpired(p[F.goodTo])) { expired++; continue; }
      rows.push({
        claim_id: p[F.tenureId] ?? '',
        claim_name: p[F.claimName] ?? '',
        owner_raw: p[F.owner] ?? '',
        area_ha: p[F.areaHa] ?? '',
        good_to_date: String(p[F.goodTo] ?? '').slice(0, 10),
        type: p[F.type] ?? '',
        province: 'BC',
      });
    }
    if (feats.length < BC_WFS.pageSize) break;
    startIndex += BC_WFS.pageSize;
    if (startIndex > 500000) throw new Error('Paging runaway (>500k) — aborting.');
  }
  if (!rows.length) throw new Error('Full pull returned zero tenures — check the CQL/typeName.');
  console.log(`  dropped ${expired} expired tenures (good-to date in the past)`);
  writeCsv(PATHS.claimsBc, rows);
}

async function main() {
  if (args.includes('--fixture')) {
    const rows = readCsv(path.join(PATHS.fixtures, 'claims_bc_fixture.csv'));
    console.log(`Fixture mode: ${rows.length} BC claims`);
    writeCsv(PATHS.claimsBc, rows);
    return;
  }
  if (args.includes('--discover')) return discover();
  await fullPull();
}

main().catch((err) => { console.error(`\n✗ 02_fetch_claims_bc failed:\n${err.message}`); process.exit(1); });
