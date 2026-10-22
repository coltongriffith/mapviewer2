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
//   * A REDIRECT THAT CHANGES THE PATH IS EXIT 1, not "unreachable". In October
//     2026 BLM moved the service and answered every request with a 301 to the
//     bare REST root of a new host; fetch followed it, found no fields, and
//     this canary reported exit 2 — neutral — for a move that had broken every
//     US search. A moved service is drift and fails the run.
//   * It also measures how FULL the state fields are. A field that exists can
//     be empty: GEO_STATE resolved fine in October 2026 while being NULL on
//     88% of rows. The runtime no longer relies on it, but the legal
//     description it does rely on (CSE_META) is checked for fill here.
//
// Keep the candidate lists below in sync with api/claims.js US_JURISDICTIONS.

const SERVICE = process.env.BLM_MLRS_SERVICE_URL
  || 'https://nlsdbpubgis.blm.gov/arcgis/rest/services/Mining_Claims/MiningClaims/MapServer';
const LAYER = `${SERVICE}/${process.env.BLM_MLRS_LAYER_ID || 1}`;
const JSON_OUT = process.argv.includes('--json');
const SKIP_FILL = process.argv.includes('--no-fill');
// Below this share of rows carrying a legal description, per-row scoping
// leans on serial prefixes for too many claims — fail and look.
const MIN_LEGAL_FILL_PCT = 90;

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
    key: 'legalDescription',
    required: true,
    why: 'geographic per-row state scoping (the PLSS state leading each legal description) — '
      + 'without it, and with GEO_STATE mostly NULL, US claims are placed by serial prefix and '
      + 'Oregon/Washington lose most of their claims',
    candidates: ['CSE_META'],
  },
  {
    key: 'geoState',
    required: false,
    why: 'first source of a claim\'s state where BLM fills it in (NULL on most rows since October 2026)',
    candidates: ['GEO_STATE', 'STATE_GEO', 'GEOGRAPHIC_STATE'],
  },
  {
    key: 'adminState',
    required: false,
    why: 'whole-set fallback scoping on a layer that has neither GEO_STATE nor a legal description',
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
//
// History: geoState was acknowledged absent from 2026-08-03 (the old HUB layer
// dropped it). The October 2026 MapServer/1 publishes GEO_STATE again but
// mostly NULL, and scoping moved to the legal description, so the entry was
// retired rather than left to fail as "recovered".
const ACKNOWLEDGED_ABSENT = {};

class MovedError extends Error {}

async function fetchLayerMeta() {
  // redirect: 'manual' — see the header: a followed redirect is how the
  // October 2026 move was misread as an outage.
  const r = await fetch(`${LAYER}?f=json`, {
    headers: { Accept: 'application/json', 'User-Agent': 'ExplorationMaps-schema-canary/1.0' },
    signal: AbortSignal.timeout(45000),
    redirect: 'manual',
  });
  if (r.status >= 300 && r.status < 400) {
    const location = r.headers.get('location');
    let samePath = false;
    try { samePath = new URL(location, LAYER).pathname.replace(/\/+$/, '') === new URL(LAYER).pathname.replace(/\/+$/, ''); } catch { /* no */ }
    throw new MovedError(`HTTP ${r.status} from ${LAYER} to ${location || '(no Location)'}${samePath ? ' (same path — update the host)' : ' (path changed)'}`);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${LAYER}`);
  const body = await r.json();
  if (body?.error) throw new Error(`ArcGIS error: ${JSON.stringify(body.error).slice(0, 300)}`);
  if (!Array.isArray(body.fields) || !body.fields.length) throw new Error('Layer metadata carried no fields array');
  return body;
}

// Share of rows with each state source filled. Count queries cost BLM 2-20 s
// each (a NULL test scans the layer), so they run in parallel with a generous
// timeout, and a count that does not come back is "unmeasured", not a failure.
async function fillRates(results) {
  const field = (key) => results.find((r) => r.key === key)?.resolved || null;
  const legal = field('legalDescription');
  const geo = field('geoState');
  const admin = field('adminState');
  const wheres = {
    total: '1=1',
    ...(legal ? { legalDescription: `${legal} IS NOT NULL AND ${legal} <> ''` } : {}),
    ...(geo ? { geoState: `${geo} IS NOT NULL` } : {}),
    ...(admin ? { adminState: `${admin} IS NOT NULL` } : {}),
  };
  const started = Date.now();
  const counts = {};
  const errors = {};
  await Promise.all(Object.entries(wheres).map(async ([k, where]) => {
    try {
      const r = await fetch(`${LAYER}/query?${new URLSearchParams({ where, returnCountOnly: 'true', f: 'json' })}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'ExplorationMaps-schema-canary/1.0' },
        signal: AbortSignal.timeout(90000),
        redirect: 'manual',
      });
      const body = await r.json();
      if (Number.isFinite(Number(body?.count))) counts[k] = Number(body.count);
      else errors[k] = JSON.stringify(body?.error || body).slice(0, 160);
    } catch (e) {
      errors[k] = String(e?.message || e).slice(0, 160);
    }
  }));
  const pct = (k) => (counts.total > 0 && counts[k] != null ? Math.round((counts[k] / counts.total) * 1000) / 10 : null);
  return {
    total: counts.total ?? null,
    counts,
    percent: Object.fromEntries(Object.keys(wheres).filter((k) => k !== 'total').map((k) => [k, pct(k)])),
    errors,
    ms: Date.now() - started,
  };
}

function fillTooLow(fill) {
  const v = fill?.percent?.legalDescription;
  return typeof v === 'number' && v < MIN_LEGAL_FILL_PCT;
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
    if (e instanceof MovedError) {
      console.error(`✗ SERVICE MOVED — ${e.message}`);
      console.error('  Every US search fails until api/claims.js points at the new location.');
      console.error('  Find the new service/layer, then set BLM_MLRS_SERVICE_URL / BLM_MLRS_LAYER_ID');
      console.error('  on Vercel (immediate) and update the defaults in api/claims.js and this file.');
      process.exit(1);
    }
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
  const fill = SKIP_FILL ? null : await fillRates(results);

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
      fillRates: fill,
      ok: brokenRequired.length === 0 && recovered.length === 0 && !fillTooLow(fill),
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
      console.log(`  ${mark} ${r.key.padEnd(16)} ${detail}`);
    }
    console.log('');
    if (fill) {
      console.log(`  Fill rates over ${fill.total ?? '?'} rows (${fill.ms} ms):`);
      for (const [k, v] of Object.entries(fill.percent)) {
        console.log(`    ${k.padEnd(16)} ${v == null ? `unmeasured${fill.errors[k] ? ` — ${fill.errors[k]}` : ''}` : `${v}%`}`);
      }
      console.log('');
    }
  }

  if (fillTooLow(fill)) {
    console.error(`✗ LEGAL DESCRIPTION SPARSE — ${fill.percent.legalDescription}% of rows carry one (minimum ${MIN_LEGAL_FILL_PCT}%).`);
    console.error('  US claims without one are placed by serial prefix (degraded) or, in OR/WA, left out.');
    console.error('  Check whether BLM moved the location into another field.');
    process.exit(1);
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
