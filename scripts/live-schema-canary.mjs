#!/usr/bin/env node
// Live-schema canary for the BLM MLRS mining-claims layer.
//
//   node scripts/live-schema-canary.mjs
//   node scripts/live-schema-canary.mjs --json
//
// WHY THIS IS NOT A UNIT TEST
// The unit suite (tests/us-claims.test.js) runs against a mocked BLM service
// whose fixture field names were copied from the live layer. That makes the
// suite fast and deterministic, and it makes it BLIND: when MLRS/BLM renames a
// field, the fixtures keep the old name, every test stays green, and production
// silently loses claim types, acreages or state scoping. The fixtures cannot
// catch schema drift because they ARE the schema assumption.
//
// So this check hits the real endpoint and asserts that each candidate list in
// api/claims.js still resolves to a real field, failing loudly and naming the
// missing field. It is deliberately:
//   * NOT under tests/ and NOT named *.test.js — vitest's include glob is
//     tests/**/*.test.{js,jsx}, so `npm test` and the CI build gate never run
//     it. A government endpoint being down must never block a deploy.
//   * scheduled instead (.github/workflows/blm-schema-canary.yml, weekly), and
//     runnable by hand whenever US results look wrong.
//   * exit 0 = schema intact, exit 1 = a required field is gone (drift —
//     act on it), exit 2 = the endpoint was unreachable (not a schema verdict).
//
// Keep the candidate lists below in sync with api/claims.js US_JURISDICTIONS.

const SERVICE = process.env.BLM_MLRS_SERVICE_URL
  || 'https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/FeatureServer';
const LAYER = `${SERVICE}/0`;
const JSON_OUT = process.argv.includes('--json');

// Each entry mirrors one candidate list the runtime resolves against.
//   required: the feature breaks outright if nothing in the list resolves
//   optional: an OR-clause / enrichment that degrades gracefully when absent
const CHECKS = [
  {
    key: 'number',
    required: true,
    why: 'serial-number search and the degraded serial-prefix scoping',
    candidates: ['CSE_NR', 'MLRS_CSE_NR', 'CASE_NR', 'SER_NR', 'SERIAL_NR'],
  },
  {
    key: 'name',
    required: true,
    why: 'claim-name search, and the US company/parent alias ladder that runs against it',
    candidates: ['CSE_NAME', 'CLAIM_NAME', 'MC_NAME', 'CASE_NAME', 'NAME'],
  },
  {
    key: 'geoState',
    required: true,
    why: 'precise (geographic) state scoping — without it every US search degrades to admin_state or serial_prefix',
    candidates: ['GEO_STATE', 'STATE_GEO', 'GEOGRAPHIC_STATE'],
  },
  {
    key: 'adminState',
    required: false,
    why: 'first-line fallback scoping when GEO_STATE is gone',
    candidates: ['ADMIN_STATE', 'ADMIN_ST', 'ADM_ST', 'STATE'],
  },
  {
    key: 'claimType',
    required: true,
    why: 'lode/placer/mill/tunnel classification and the US claim-type filter',
    candidates: ['BLM_PROD', 'CSE_TYPE_TXT', 'CASETYPE_TXT', 'CSE_TYPE', 'CASE_TYPE', 'CASE_TYPE_TXT'],
  },
  {
    key: 'disposition',
    required: true,
    why: 'claim status shown in results',
    candidates: ['CSE_DISP', 'CSE_DISP_TXT', 'DISP_TXT', 'CASE_DISP', 'DISPOSITION'],
  },
  {
    key: 'acres',
    required: true,
    why: 'area, hectare conversion, and jurisdiction ranking by materiality',
    candidates: ['RCRD_ACRS', 'ACRES', 'RECORD_ACRES', 'RCRD_ACRES'],
  },
  {
    key: 'claimant',
    required: false,
    why: 'exact claimant search; absent as of July 2026, so company search resolves via claim names',
    candidates: ['CLAIMANT_NAME', 'CLAIMANT', 'CLMNT_NAME', 'CLAIMANT_TXT', 'CUST_NAME', 'CUSTOMER_NAME'],
  },
  {
    key: 'legacyNumber',
    required: false,
    why: 'legacy LR2000 serial OR-clause (NMC-style office serials)',
    candidates: ['LGCY_CSE_NR', 'LEGACY_CASE_NR', 'LGCY_SER_NR'],
  },
  {
    key: 'recordDate',
    required: false,
    why: 'recording-date tie-break when ranking jurisdictions of equal area',
    candidates: ['CSE_RCRD_DT', 'RCRD_DT', 'CSE_FILE_DT', 'LOCATION_DT', 'LOC_DT'],
  },
];

async function fetchLayerMeta() {
  const r = await fetch(`${LAYER}?f=json`, {
    headers: { Accept: 'application/json', 'User-Agent': 'ExplorationMaps-schema-canary/1.0' },
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${LAYER}`);
  const body = await r.json();
  if (body?.error) throw new Error(`ArcGIS error: ${JSON.stringify(body.error).slice(0, 300)}`);
  if (!Array.isArray(body.fields) || !body.fields.length) throw new Error('Layer metadata carried no fields array');
  return body;
}

function resolve(candidates, fieldNames) {
  const upper = new Set(fieldNames.map((n) => n.toUpperCase()));
  return candidates.find((c) => upper.has(c.toUpperCase())) || null;
}

async function main() {
  let meta;
  try {
    meta = await fetchLayerMeta();
  } catch (e) {
    // Unreachable is not a schema verdict — exit 2 so a scheduled run can tell
    // "BLM is down" apart from "BLM renamed a field".
    console.error(`⚠ UNREACHABLE — could not read live layer metadata: ${e.message}`);
    console.error(`  endpoint: ${LAYER}`);
    console.error('  No schema conclusion drawn. Re-run; if this persists, check whether the service moved.');
    process.exit(2);
  }

  const fieldNames = meta.fields.map((f) => f.name);
  const results = CHECKS.map((c) => ({ ...c, resolved: resolve(c.candidates, fieldNames) }));
  const brokenRequired = results.filter((r) => r.required && !r.resolved);
  const missingOptional = results.filter((r) => !r.required && !r.resolved);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      endpoint: LAYER,
      layerName: meta.name,
      checkedAt: new Date().toISOString(),
      liveFields: fieldNames,
      results: results.map(({ key, required, resolved, candidates }) => ({ key, required, resolved, candidates })),
      ok: brokenRequired.length === 0,
    }, null, 2));
  } else {
    console.log(`BLM live-schema canary — ${meta.name || 'layer 0'}`);
    console.log(`  ${LAYER}`);
    console.log(`  ${fieldNames.length} fields published\n`);
    for (const r of results) {
      const mark = r.resolved ? '✓' : (r.required ? '✗' : '·');
      const detail = r.resolved ? r.resolved : `NONE OF: ${r.candidates.join(', ')}`;
      console.log(`  ${mark} ${r.key.padEnd(13)} ${detail}`);
    }
    console.log('');
  }

  if (brokenRequired.length) {
    console.error('✗ SCHEMA DRIFT — required fields no longer resolve on the live layer:\n');
    for (const r of brokenRequired) {
      console.error(`  ${r.key}: none of [${r.candidates.join(', ')}] exists.`);
      console.error(`    breaks: ${r.why}`);
    }
    console.error(`\n  Live field list: ${fieldNames.join(', ')}`);
    console.error('\n  Fix: add the new field name to the matching candidate list in');
    console.error('  api/claims.js (US_JURISDICTIONS) and in the CHECKS list in this file,');
    console.error('  then update the fixture names in tests/us-claims.test.js.');
    process.exit(1);
  }

  if (missingOptional.length && !JSON_OUT) {
    console.log(`Optional fields absent (expected, degrade gracefully): ${missingOptional.map((r) => r.key).join(', ')}`);
  }
  console.log('✓ Every required BLM field still resolves.');
}

await main();
