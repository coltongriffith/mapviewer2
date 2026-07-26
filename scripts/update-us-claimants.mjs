#!/usr/bin/env node
// Load U.S. mining-claim CLAIMANTS into Supabase, joined to BLM geometry by
// MLRS serial number. Run after exporting a fresh extract.
//
//   node scripts/update-us-claimants.mjs --file report120.csv --source mlrs_report_120 --snapshot 2026-07-01
//   node scripts/update-us-claimants.mjs --file ndom.csv --source ndom --snapshot 2026-07-01 --dry-run
//
// Required env (same names /api/claims already uses):
//   SUPABASE_URL (or VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY   — writes bypass RLS; never the anon key
//
// SOURCE-AGNOSTIC BY DESIGN. Every candidate ownership source produces the same
// three facts — serial, claimant name, state — so this loader takes any CSV and
// maps its columns, rather than hard-coding one provider. That is deliberate:
// the choice between BLM's own MLRS report 120 (authoritative, Login.gov-gated,
// manual export) and a redistributor like NDOM is an operator decision, and it
// should not require rewriting the pipeline. See docs/us-claims.md.
//
// COLUMN MAPPING. Headers are matched case-insensitively against the candidate
// lists below; override any of them with --serial-col / --claimant-col /
// --state-col / --role-col when a source uses something unexpected. The script
// FAILS LOUDLY on an unmappable file rather than loading a column it guessed.
//
// SNAPSHOT DATE IS MANDATORY. This data is a point-in-time extract, and the
// date rides all the way into the exported map's source credit. Loading without
// one would let a stale snapshot read as current ownership.

import fs from 'node:fs';
import path from 'node:path';
import { readCsv } from './pseo/lib.mjs';

const SERIAL_COLS = ['serial', 'serial_nr', 'serial_number', 'cse_nr', 'case_serial', 'mlrs_serial', 'case_nr'];
const CLAIMANT_COLS = ['claimant', 'claimant_name', 'customer', 'customer_name', 'name', 'owner', 'owner_name'];
const STATE_COLS = ['state', 'geo_state', 'admin_state', 'state_code'];
const ROLE_COLS = ['role', 'claimant_role', 'customer_role', 'interest_type', 'relationship'];

const VALID_SOURCES = ['mlrs_report_120', 'ndom', 'claims_hub'];

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const FILE = flag('file');
const SOURCE = flag('source');
const SNAPSHOT = flag('snapshot');
const DRY_RUN = has('dry-run');
const BATCH = Number(flag('batch', '500'));

function creds() {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) is not set.');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. Writes need the service-role key — the anon key cannot write through RLS.');
  return { base: base.replace(/\/$/, ''), key };
}

function pickColumn(headers, candidates, override, label) {
  if (override) {
    const hit = headers.find((h) => h.toLowerCase() === override.toLowerCase());
    if (!hit) throw new Error(`--${label}-col "${override}" is not a column in the file. Columns: ${headers.join(', ')}`);
    return hit;
  }
  for (const cand of candidates) {
    const hit = headers.find((h) => h.toLowerCase().replace(/\s+/g, '_') === cand);
    if (hit) return hit;
  }
  return null;
}

async function post(base, key, pathname, body, extraHeaders = {}) {
  const r = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase ${r.status} on ${pathname}: ${text.slice(0, 400)}`);
  }
  return r;
}

async function main() {
  if (!FILE) throw new Error('--file <csv> is required.');
  if (!SOURCE) throw new Error(`--source <${VALID_SOURCES.join('|')}> is required — it records which extract a row came from.`);
  if (!VALID_SOURCES.includes(SOURCE)) throw new Error(`--source must be one of: ${VALID_SOURCES.join(', ')}`);
  if (!SNAPSHOT || !/^\d{4}-\d{2}-\d{2}$/.test(SNAPSHOT)) {
    throw new Error('--snapshot YYYY-MM-DD is required. This is a point-in-time extract and the date is shown on exported maps; loading without it would let a stale snapshot read as current ownership.');
  }
  if (!fs.existsSync(FILE)) throw new Error(`No such file: ${FILE}`);

  const rows = readCsv(FILE);
  if (!rows.length) throw new Error(`${FILE} has no data rows.`);
  const headers = Object.keys(rows[0]);
  console.log(`Read ${rows.length} rows from ${path.basename(FILE)}`);
  console.log(`Columns: ${headers.join(', ')}`);

  const serialCol = pickColumn(headers, SERIAL_COLS, flag('serial-col'), 'serial');
  const claimantCol = pickColumn(headers, CLAIMANT_COLS, flag('claimant-col'), 'claimant');
  const stateCol = pickColumn(headers, STATE_COLS, flag('state-col'), 'state');
  const roleCol = pickColumn(headers, ROLE_COLS, flag('role-col'), 'role');

  if (!serialCol || !claimantCol) {
    throw new Error(
      `Could not map required columns.\n` +
      `  serial   → ${serialCol || 'NOT FOUND (looked for: ' + SERIAL_COLS.join(', ') + ')'}\n` +
      `  claimant → ${claimantCol || 'NOT FOUND (looked for: ' + CLAIMANT_COLS.join(', ') + ')'}\n` +
      `Pass --serial-col / --claimant-col explicitly. Refusing to guess: loading the wrong column would attach one company's name to another's ground.`
    );
  }
  console.log(`Mapped: serial=${serialCol}, claimant=${claimantCol}, state=${stateCol || '(none)'}, role=${roleCol || '(none)'}`);

  const records = [];
  let skipped = 0;
  for (const r of rows) {
    const serial = String(r[serialCol] || '').trim().replace(/[\s-]/g, '').toUpperCase();
    const claimant = String(r[claimantCol] || '').trim();
    if (!serial || !claimant) { skipped += 1; continue; }
    records.push({
      serial,
      claimant_name: claimant,
      claimant_role: roleCol ? (String(r[roleCol] || '').trim() || null) : null,
      state: stateCol ? (String(r[stateCol] || '').trim().toUpperCase().slice(0, 2) || null) : null,
      source: SOURCE,
      snapshot_date: SNAPSHOT,
      raw: r,
    });
  }
  // De-duplicate on the table's unique key so one payload can't self-conflict.
  const seen = new Set();
  const unique = records.filter((rec) => {
    const k = `${rec.serial}|${rec.claimant_name}|${rec.source}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  console.log(`\n${unique.length} rows to load (${skipped} skipped for missing serial/claimant, ${records.length - unique.length} duplicate keys)`);
  const distinctClaimants = new Set(unique.map((r) => r.claimant_name)).size;
  const distinctSerials = new Set(unique.map((r) => r.serial)).size;
  console.log(`  ${distinctClaimants} distinct claimants across ${distinctSerials} distinct serials`);
  console.log('\nSample:');
  for (const r of unique.slice(0, 3)) {
    console.log(`  ${r.serial}  ${r.claimant_name}${r.claimant_role ? ` [${r.claimant_role}]` : ''}${r.state ? ` (${r.state})` : ''}`);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written. Drop the flag to load.');
    return;
  }

  const { base, key } = creds();

  // Replace this source's rows atomically; other sources keep their snapshots.
  console.log(`\nClearing previous rows for source=${SOURCE}…`);
  await post(base, key, '/rest/v1/rpc/replace_us_claimants_source', { p_source: SOURCE });

  let written = 0;
  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    await post(base, key, '/rest/v1/us_claim_claimants', chunk, {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    });
    written += chunk.length;
    process.stdout.write(`\r  loaded ${written}/${unique.length}`);
  }
  console.log(`\n\n✓ Loaded ${written} claimant rows (source=${SOURCE}, snapshot=${SNAPSHOT})`);
  console.log('\nNext: US company searches will now resolve against claimant records');
  console.log('(resolvedAgainst="claimant") instead of claim names, and the export credit');
  console.log(`will read "snapshot ${SNAPSHOT}". Re-run scripts/pseo/08_seed_us_aliases.mjs`);
  console.log('to seed the subsidiary alias review queue against real claimant strings.');
}

try { await main(); } catch (err) { console.error(`\n✗ update-us-claimants failed:\n${err.message}`); process.exit(1); }
