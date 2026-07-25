#!/usr/bin/env node
// 08 — Seed the US-subsidiary alias review queue from live BLM claimant data.
//
//   node scripts/pseo/08_seed_us_aliases.mjs
//   node scripts/pseo/08_seed_us_aliases.mjs --states NV,AZ --limit 20000
//
// Inputs : issuers.csv (ticker,exchange,company)
//          live BLM MLRS "Mining Claims Not Closed" FeatureServer
// Output : data/pseo/us_alias_review_queue.csv
//
// WHAT THIS DOES
// Pulls distinct claimant strings from the live BLM layer that look like a US
// subsidiary of a foreign parent — the string contains one of the subsidiary
// markers below ("NEVADA", "US INC", "USA", "LLC", "CORP", …) — and scores each
// against the issuer list using the pipeline's own scorer/thresholds.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It never writes api/_lib/us-aliases.js and never marks a row verified. Every
// candidate lands in a review CSV with its score and the exact claimant string,
// for a human to confirm and then copy into data/pseo/aliases.csv as
// kind=us_subsidiary. An auto-accepted fuzzy hit here would put a wrong
// company's ground on a map that goes into an NI 43-101 filing or an investor
// deck, so the human step is not optional.
//
// IF THE CLAIMANT FIELD IS ABSENT
// As of July 2026 the BLM Not Closed spatial layer publishes no claimant field
// (claimant names live in separate MLRS reports keyed by serial number). This
// script resolves the claimant field from live metadata and, when none exists,
// says so and exits 3 without writing a queue — rather than inventing rows.
// The candidate list below is what it looks for; run it again after BLM adds
// one, or point it at an export of MLRS report 103 via --claimants <csv>
// (columns: claimant,serial,state).

import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './config.mjs';
import { readCsv, writeCsv, normalizeName, nameScore, NAME_MATCH } from './lib.mjs';

const BLM_SERVICE = process.env.BLM_MLRS_SERVICE_URL
  || 'https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/FeatureServer';
const LAYER = `${BLM_SERVICE}/0`;

// Mirrors api/claims.js US_JURISDICTIONS.ownerFields — keep in sync.
const CLAIMANT_FIELDS = ['CLAIMANT_NAME', 'CLAIMANT', 'CLMNT_NAME', 'CLAIMANT_TXT', 'CUST_NAME', 'CUSTOMER_NAME'];
const GEO_STATE_FIELDS = ['GEO_STATE', 'STATE_GEO', 'GEOGRAPHIC_STATE'];

// The subsidiary markers the task calls for. A claimant string containing any
// of these is a candidate for parent-company cross-matching.
const SUBSIDIARY_MARKERS = ['NEVADA', 'US INC', 'U S INC', 'USA', 'LLC', 'CORP', 'AMERICA', 'MINERALS US', 'RESOURCES US'];

const argv = process.argv.slice(2);
const argOf = (flag, fallback = null) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const STATES = (argOf('--states', 'NV,AZ,UT,ID,MT,WY,CO,NM,CA,OR,WA')).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const LIMIT = Number(argOf('--limit', '50000'));
const CLAIMANTS_CSV = argOf('--claimants');
const OUT = path.join(PATHS.data, 'us_alias_review_queue.csv');
const HEADERS = ['parent_name', 'ticker', 'exchange', 'claimant_name', 'jurisdiction', 'claims', 'total_acres', 'score', 'marker', 'source', 'verified'];

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'ExplorationMaps-pSEO/1.0' },
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`Upstream ${r.status} for ${url.slice(0, 140)}`);
  const data = await r.json();
  if (data?.error) throw new Error(`ArcGIS error: ${JSON.stringify(data.error).slice(0, 300)}`);
  return data;
}

function pick(candidates, fields) {
  const names = new Set(fields.map((f) => String(f.name).toUpperCase()));
  return candidates.find((c) => names.has(c.toUpperCase())) || null;
}

// Distinct claimant rows straight off the live layer, one request per state.
async function fetchClaimantsFromBlm(claimantField, stateField) {
  const rows = [];
  for (const state of STATES) {
    const params = new URLSearchParams({
      where: stateField ? `UPPER(${stateField}) = '${state}'` : '1=1',
      outFields: [claimantField, 'RCRD_ACRS'].join(','),
      returnGeometry: 'false',
      f: 'json',
      resultRecordCount: String(Math.min(LIMIT, 32000)),
    });
    process.stdout.write(`  ${state}… `);
    const data = await fetchJson(`${LAYER}/query?${params}`);
    const feats = data.features || [];
    console.log(`${feats.length} rows`);
    for (const f of feats) {
      const a = f.attributes || {};
      rows.push({ claimant: a[claimantField], state, acres: Number(a.RCRD_ACRS) || 0 });
    }
  }
  return rows;
}

function loadClaimantsFromCsv(file) {
  return readCsv(file).map((r) => ({
    claimant: r.claimant || r.claimant_name || r.CLAIMANT_NAME,
    state: String(r.state || r.STATE || '').toUpperCase(),
    acres: Number(r.acres || r.RCRD_ACRS) || 0,
  })).filter((r) => r.claimant);
}

function markerIn(claimant) {
  const up = String(claimant).toUpperCase();
  return SUBSIDIARY_MARKERS.find((m) => up.includes(m)) || null;
}

async function main() {
  const issuers = readCsv(PATHS.issuers);
  if (!issuers.length) throw new Error(`No issuers in ${PATHS.issuers} — run 01 first.`);
  const issuerNorms = issuers.map((i) => ({ ...i, norm: normalizeName(i.company) }));
  console.log(`Loaded ${issuers.length} issuers`);

  let claimantRows;
  if (CLAIMANTS_CSV) {
    claimantRows = loadClaimantsFromCsv(CLAIMANTS_CSV);
    console.log(`Loaded ${claimantRows.length} claimant rows from ${CLAIMANTS_CSV}`);
  } else {
    console.log(`Resolving live BLM schema at ${LAYER}`);
    const meta = await fetchJson(`${LAYER}?f=json`);
    const fields = meta.fields || [];
    const claimantField = pick(CLAIMANT_FIELDS, fields);
    if (!claimantField) {
      console.error('\n✗ The live BLM layer publishes no claimant field.');
      console.error(`  Looked for: ${CLAIMANT_FIELDS.join(', ')}`);
      console.error(`  Layer has:  ${fields.map((f) => f.name).join(', ')}`);
      console.error('\n  Nothing written. Re-run with --claimants <csv> using an export of');
      console.error('  MLRS report 103 (Mining Claims Customer Info), or re-run this script');
      console.error('  after BLM adds a claimant field to the spatial layer.');
      process.exit(3);
    }
    const stateField = pick(GEO_STATE_FIELDS, fields);
    console.log(`  claimant field: ${claimantField}${stateField ? `, state field: ${stateField}` : ' (no state field — querying nationwide)'}`);
    claimantRows = await fetchClaimantsFromBlm(claimantField, stateField);
  }

  // Aggregate per (claimant, state) so the queue shows real materiality.
  const agg = new Map();
  for (const r of claimantRows) {
    const marker = markerIn(r.claimant);
    if (!marker) continue;                       // not a subsidiary-looking name
    const key = `${r.claimant}||${r.state}`;
    const cur = agg.get(key) || { claimant: r.claimant, state: r.state, marker, claims: 0, acres: 0 };
    cur.claims += 1;
    cur.acres += r.acres;
    agg.set(key, cur);
  }
  console.log(`\nSubsidiary-looking claimant/state pairs: ${agg.size}`);

  const queue = [];
  for (const c of agg.values()) {
    const norm = normalizeName(c.claimant);
    if (!norm) continue;
    let best = null;
    for (const iss of issuerNorms) {
      // Score both the raw claimant and the claimant with the US/state markers
      // removed — "AWESOME GOLD NEVADA" vs parent "Awesome Gold Corp".
      const stripped = norm.replace(/\b(US|USA|AMERICA|AMERICAS|NEVADA|ARIZONA|UTAH|IDAHO|MONTANA|WYOMING|COLORADO|NEW MEXICO|CALIFORNIA|OREGON|WASHINGTON)\b/g, ' ').replace(/\s+/g, ' ').trim();
      const score = Math.max(nameScore(norm, iss.norm), nameScore(stripped, iss.norm));
      if (!best || score > best.score) best = { iss, score };
    }
    // Everything at or above the review floor is queued — including scores that
    // clear the auto threshold. Nothing here is auto-accepted; `verified` stays
    // blank until a human sets it.
    if (best && best.score >= NAME_MATCH.review) {
      queue.push({
        parent_name: best.iss.company,
        ticker: best.iss.ticker,
        exchange: best.iss.exchange,
        claimant_name: c.claimant,
        jurisdiction: `us-${c.state.toLowerCase()}`,
        claims: c.claims,
        total_acres: Math.round(c.acres * 10) / 10,
        score: best.score,
        marker: c.marker,
        source: CLAIMANTS_CSV ? path.basename(CLAIMANTS_CSV) : 'BLM MLRS live',
        verified: '',
      });
    }
  }
  queue.sort((a, b) => b.score - a.score || b.total_acres - a.total_acres);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  writeCsv(OUT, queue, HEADERS);
  console.log(`\n✓ ${queue.length} candidates queued (scores ${NAME_MATCH.review}+), none auto-accepted`);
  console.log('\nReview loop: confirm rows in us_alias_review_queue.csv (set verified=yes),');
  console.log('then append each confirmed pair to data/pseo/aliases.csv as');
  console.log('  <claimant_name>,<ticker>,us_subsidiary,<jurisdiction>,<parent_name>,<source>,yes');
  console.log('and add it to CURATED_US_ALIASES in api/_lib/us-aliases.js.');
}

try { await main(); } catch (err) { console.error(`\n✗ 08_seed_us_aliases failed:\n${err.message}`); process.exit(1); }
