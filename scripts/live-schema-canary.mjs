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
//   * exit 0 = no NEW drift (see ACKNOWLEDGED_ABSENT — a known, already-disclosed
//     degradation stays green but prints loudly), exit 1 = a required field is
//     gone and we did not know, or an acknowledged one came back, exit 2 = the
//     endpoint was unreachable (not a schema verdict).
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
    why: 'legacy LR2000 serial OR-clause (NMC-style office serials) — carries half of '
      + 'serial_prefix scoping, which is the only scoping mode left while the state fields are gone',
    candidates: ['LEG_CSE_NR', 'LGCY_CSE_NR', 'LEGACY_CASE_NR', 'LGCY_SER_NR'],
  },
  {
    key: 'recordDate',
    required: false,
    why: 'recording-date tie-break when ranking jurisdictions of equal area',
    candidates: ['CSE_RCRD_DT', 'RCRD_DT', 'CSE_FILE_DT', 'LOCATION_DT', 'LOC_DT'],
  },
];

// ── Acknowledged absences ───────────────────────────────────────────────────
//
// A required field that is ALREADY gone, already handled by a disclosed
// degraded mode, and already known to us is not news. Left as a plain failure
// it would turn this into a weekly red check that everyone learns to scroll
// past — and the next drift, the one that matters, would be scrolled past with
// it. That is the specific way a canary dies.
//
// So a known absence is recorded here, with the date and the consequence, and
// the run stays green while printing the degradation loudly every single time.
// Three things still fail the run:
//   * any OTHER required field going missing (real, new drift)
//   * an acknowledged field COMING BACK — that is good news and it needs a code
//     change to act on, so it must not pass silently
//   * an acknowledgement that is no longer needed
//
// This is a record of a live product degradation, not a way to stop thinking
// about one. Remove an entry the moment the field returns.
const ACKNOWLEDGED_ABSENT = {
  geoState: {
    since: '2026-08-03',
    noticed: 'first scheduled run of this canary',
    what: 'BLM republished the Not Closed layer with a much slimmer schema '
      + '(18 fields). No geographic state field is published on it any more, and '
      + 'neither is any ADMIN_STATE candidate.',
    consequence: 'US state scoping runs in serial_prefix mode for the nine states '
      + 'with a distinct serial prefix, disclosed to the user by the degraded-scoping '
      + 'banner. Oregon and Washington share one BLM office, so no prefix separates '
      + 'them and those two states return an error rather than a wrong answer.',
    todo: 'Find where state moved — CSE_META is the only plausible field left on the '
      + 'layer, and a sibling layer or the MLRS reports may carry it. Restoring a '
      + 'geographic field is what brings OR/WA back.',
  },
};

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
  const results = CHECKS.map((c) => ({
    ...c,
    resolved: resolve(c.candidates, fieldNames),
    acknowledged: ACKNOWLEDGED_ABSENT[c.key] || null,
  }));
  // Drift is a required field that is missing AND not already known to be.
  const brokenRequired = results.filter((r) => r.required && !r.resolved && !r.acknowledged);
  const knownDegraded = results.filter((r) => !r.resolved && r.acknowledged);
  // An acknowledged field that resolved again: the degraded mode can be
  // retired, but only by a human editing api/claims.js and this file.
  const recovered = results.filter((r) => r.resolved && r.acknowledged);
  const missingOptional = results.filter((r) => !r.required && !r.resolved && !r.acknowledged);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      endpoint: LAYER,
      layerName: meta.name,
      checkedAt: new Date().toISOString(),
      liveFields: fieldNames,
      results: results.map(({ key, required, resolved, candidates, acknowledged }) => ({
        key, required, resolved, candidates, acknowledgedAbsent: Boolean(acknowledged),
      })),
      knownDegraded: knownDegraded.map((r) => ({ key: r.key, ...r.acknowledged })),
      recovered: recovered.map((r) => r.key),
      ok: brokenRequired.length === 0 && recovered.length === 0,
    }, null, 2));
  } else {
    console.log(`BLM live-schema canary — ${meta.name || 'layer 0'}`);
    console.log(`  ${LAYER}`);
    console.log(`  ${fieldNames.length} fields published\n`);
    for (const r of results) {
      let mark = '·';
      if (r.resolved) mark = r.acknowledged ? '↑' : '✓';
      else if (r.acknowledged) mark = '!';
      else if (r.required) mark = '✗';
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

  // An acknowledged field that came back is a PASS condition nobody should be
  // allowed to sleep through: precise scoping is recoverable and two states are
  // waiting on it. Fail until a human retires the acknowledgement.
  if (recovered.length) {
    console.error('✗ A field we had written off is published again:\n');
    for (const r of recovered) {
      console.error(`  ${r.key}: resolved to ${r.resolved} (acknowledged absent since ${r.acknowledged.since}).`);
      console.error(`    restores: ${r.why}`);
    }
    console.error('\n  Act on it: delete the entry from ACKNOWLEDGED_ABSENT in this file,');
    console.error('  confirm api/claims.js resolves the field, and re-check that the');
    console.error('  degraded-scoping banner stops firing for the affected states.');
    process.exit(1);
  }

  if (missingOptional.length && !JSON_OUT) {
    console.log(`Optional fields absent (expected, degrade gracefully): ${missingOptional.map((r) => r.key).join(', ')}`);
  }

  if (knownDegraded.length && !JSON_OUT) {
    console.log('! RUNNING DEGRADED — known, disclosed, and not yet resolved:\n');
    for (const r of knownDegraded) {
      const a = r.acknowledged;
      console.log(`  ${r.key} — absent since ${a.since} (${a.noticed})`);
      console.log(`    what:        ${a.what}`);
      console.log(`    consequence: ${a.consequence}`);
      console.log(`    to resolve:  ${a.todo}`);
      console.log('');
    }
    // Surface it on the run itself, so a green check still carries the warning
    // into the Actions UI rather than hiding it in the log body.
    if (process.env.GITHUB_ACTIONS) {
      const keys = knownDegraded.map((r) => r.key).join(', ');
      console.log(`::warning title=BLM schema running degraded::${keys} still absent from the live layer. `
        + 'US state scoping is degraded and disclosed to users. See the job log for detail.');
    }
  }

  console.log(knownDegraded.length
    ? '✓ No NEW drift — every other required BLM field still resolves.'
    : '✓ Every required BLM field still resolves.');
}

await main();
