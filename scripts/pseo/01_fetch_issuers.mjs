#!/usr/bin/env node
// 01 — Build data/pseo/issuers.csv: one row per TSXV/CSE mining issuer.
//
//   node scripts/pseo/01_fetch_issuers.mjs                # fetch both sources
//   node scripts/pseo/01_fetch_issuers.mjs --xlsx f.xlsx  # local TSXV workbook
//   node scripts/pseo/01_fetch_issuers.mjs --cse-csv f.csv
//   node scripts/pseo/01_fetch_issuers.mjs --fixture      # use bundled fixtures
//
// Output columns: ticker,exchange,company,sector,market_cap
// (market_cap stays blank when the source doesn't provide it — it only orders
// the hand-verification queue, nothing else depends on it.)

import fs from 'node:fs';
import path from 'node:path';
import { resolvePaths, TSXV_XLSX_URL, CSE_CSV_URL } from './config.mjs';
import { readCsv, writeCsv, fetchBuffer, fetchText, readXlsxFirstSheet, normalizeName } from './lib.mjs';

const args = process.argv.slice(2);
const PATHS = resolvePaths(args.includes('--fixture'));
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const MINING_SECTOR = /MINING|MINERAL|METALS|GOLD|SILVER|COPPER|LITHIUM|URANIUM|DIAMOND|COAL|RARE.?EARTH/i;

function pickCol(headerRow, patterns) {
  for (const p of patterns) {
    const i = headerRow.findIndex((h) => p.test(String(h || '')));
    if (i >= 0) return i;
  }
  return -1;
}

async function tsxvIssuers() {
  let rows;
  const localXlsx = opt('--xlsx');
  if (localXlsx) {
    rows = await readXlsxFirstSheet(fs.readFileSync(localXlsx));
  } else {
    console.log(`Fetching TSXV issuer workbook: ${TSXV_XLSX_URL}`);
    const buf = await fetchBuffer(TSXV_XLSX_URL);
    if (buf.slice(0, 2).toString() !== 'PK') {
      throw new Error('TSXV download is not an xlsx (endpoint likely moved). Download it by hand from tsx.com and re-run with --xlsx <file>.');
    }
    rows = await readXlsxFirstSheet(buf);
  }
  // Find the header row (workbooks lead with title/metadata rows)
  let headerIdx = rows.findIndex((r) => r.some((c) => /SYMBOL|TICKER/i.test(String(c || ''))) && r.some((c) => /NAME|ISSUER|COMPANY/i.test(String(c || ''))));
  if (headerIdx < 0) throw new Error('TSXV workbook: could not locate a header row containing Symbol + Name. Inspect the file.');
  const header = rows[headerIdx].map((h) => String(h || ''));
  const cTicker = pickCol(header, [/^SYMBOL$/i, /ROOT.?TICKER/i, /TICKER/i, /SYMBOL/i]);
  const cName = pickCol(header, [/^NAME$/i, /ISSUER/i, /COMPANY/i, /NAME/i]);
  const cSector = pickCol(header, [/SECTOR/i, /INDUSTRY/i]);
  const cCap = pickCol(header, [/MARKET.?CAP|QMV/i]);
  const out = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const ticker = String(r[cTicker] || '').trim();
    const company = String(r[cName] || '').trim();
    if (!ticker || !company) continue;
    const sector = cSector >= 0 ? String(r[cSector] || '').trim() : 'Mining';
    if (cSector >= 0 && sector && !MINING_SECTOR.test(sector)) continue;
    out.push({ ticker, exchange: 'TSXV', company, sector: sector || 'Mining', market_cap: cCap >= 0 ? String(r[cCap] || '').trim() : '' });
  }
  if (!out.length) throw new Error('TSXV workbook parsed to zero mining issuers — schema changed; inspect header row.');
  console.log(`  TSXV mining issuers: ${out.length}`);
  return out;
}

async function cseIssuers() {
  let text;
  const local = opt('--cse-csv');
  if (local) text = fs.readFileSync(local, 'utf8');
  else {
    console.log(`Fetching CSE securities CSV: ${CSE_CSV_URL}`);
    text = await fetchText(CSE_CSV_URL);
    if (/<html/i.test(text.slice(0, 200))) {
      throw new Error('CSE endpoint returned HTML, not CSV (undocumented endpoint moved). Export the listings CSV by hand from thecse.com and re-run with --cse-csv <file>.');
    }
  }
  const tmp = path.join(PATHS.data, '.cse_raw.csv');
  fs.mkdirSync(PATHS.data, { recursive: true });
  fs.writeFileSync(tmp, text);
  const rows = readCsv(tmp);
  fs.unlinkSync(tmp);
  const keys = Object.keys(rows[0] || {});
  const kTicker = keys.find((k) => /symbol|ticker/i.test(k));
  const kName = keys.find((k) => /company|issuer|name/i.test(k));
  const kInd = keys.find((k) => /industry|sector/i.test(k));
  if (!kTicker || !kName) throw new Error(`CSE CSV: expected symbol+name columns, got: ${keys.join(', ')}`);
  const out = rows
    .filter((r) => !kInd || MINING_SECTOR.test(r[kInd] || ''))
    .map((r) => ({ ticker: r[kTicker], exchange: 'CSE', company: r[kName], sector: r[kInd] || 'Mining', market_cap: '' }))
    .filter((r) => r.ticker && r.company);
  if (!out.length) throw new Error('CSE CSV parsed to zero mining issuers — check the industry column.');
  console.log(`  CSE mining issuers: ${out.length}`);
  return out;
}

async function main() {
  let issuers;
  if (flag('--fixture')) {
    issuers = readCsv(path.join(PATHS.fixtures, 'issuers_fixture.csv'));
    console.log(`Fixture mode: ${issuers.length} issuers`);
  } else {
    const [tsxv, cse] = [await tsxvIssuers(), await cseIssuers()];
    // Dedupe cross-listings by normalized company name (keep TSXV row)
    const seen = new Set();
    issuers = [];
    for (const r of [...tsxv, ...cse]) {
      const key = normalizeName(r.company);
      if (seen.has(key)) continue;
      seen.add(key);
      issuers.push(r);
    }
  }
  writeCsv(PATHS.issuers, issuers, ['ticker', 'exchange', 'company', 'sector', 'market_cap']);
}

main().catch((err) => { console.error(`\n✗ 01_fetch_issuers failed:\n${err.message}`); process.exit(1); });
