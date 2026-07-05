#!/usr/bin/env node
// 01 — Build data/pseo/issuers.csv: one row per TSXV/CSE mining issuer.
//
// Reliable path (recommended): keep a hand-maintained list. Drop a CSV with at
// least `ticker,exchange,company` columns at data/pseo/manual/issuers.csv (or
// pass --issuers-csv <path>) and this step uses it directly, no network. That's
// the batch-1 workflow — you already know your outreach tickers, and it dodges
// the exchanges entirely.
//
//   node scripts/pseo/01_fetch_issuers.mjs                     # manual file if present, else auto-fetch
//   node scripts/pseo/01_fetch_issuers.mjs --issuers-csv f.csv # explicit ready-made list
//   node scripts/pseo/01_fetch_issuers.mjs --xlsx f.xlsx       # local TSXV workbook
//   node scripts/pseo/01_fetch_issuers.mjs --cse-csv f.csv     # local CSE csv
//   node scripts/pseo/01_fetch_issuers.mjs --fixture           # bundled fixtures
//
// Auto-fetch from tsx.com / thecse.com is BEST-EFFORT: the exchanges block
// automated downloads (TSX returns HTTP 403), so a failing source just warns
// and is skipped. The step only hard-fails if it ends up with zero issuers.
//
// Output columns: ticker,exchange,company,sector,market_cap
// (sector defaults to "Mining"; market_cap is optional and only orders the
// hand-verification queue — nothing else depends on it.)

import fs from 'node:fs';
import path from 'node:path';
import { resolvePaths, TSXV_XLSX_URL, CSE_CSV_URL } from './config.mjs';
import { readCsv, writeCsv, fetchBuffer, fetchText, readXlsxFirstSheet, normalizeName } from './lib.mjs';

const args = process.argv.slice(2);
const PATHS = resolvePaths(args.includes('--fixture'));
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const MINING_SECTOR = /MINING|MINERAL|METALS|GOLD|SILVER|COPPER|LITHIUM|URANIUM|DIAMOND|COAL|RARE.?EARTH/i;

// Read a ready-made issuer CSV (any column names — we detect ticker/exchange/
// company/sector/market_cap). exchange defaults to TSXV when a column is absent.
function readIssuerCsv(file) {
  const rows = readCsv(file);
  if (!rows.length) throw new Error(`${file} has no rows`);
  const keys = Object.keys(rows[0]);
  const k = (re) => keys.find((key) => re.test(key));
  const kT = k(/ticker|symbol/i), kC = k(/company|issuer|name/i);
  const kE = k(/exchange|exch|market\b/i), kS = k(/sector|industry/i), kM = k(/market.?cap|qmv/i);
  if (!kT || !kC) throw new Error(`${file}: need a ticker and a company column; found: ${keys.join(', ')}`);
  const out = [];
  for (const r of rows) {
    const ticker = (r[kT] || '').trim();
    const company = (r[kC] || '').trim();
    if (!ticker || ticker.startsWith('#') || !company) continue;
    let exchange = (kE ? r[kE] : '').trim().toUpperCase();
    if (/VENTURE|TSXV|TSX.?V|TSX-?V/.test(exchange)) exchange = 'TSXV';
    else if (/CSE|CNSX|CANADIAN SEC/.test(exchange)) exchange = 'CSE';
    else if (!exchange) exchange = 'TSXV';
    out.push({ ticker, exchange, company, sector: (kS ? r[kS] : '').trim() || 'Mining', market_cap: (kM ? r[kM] : '').trim() });
  }
  if (!out.length) throw new Error(`${file}: parsed to zero issuers`);
  return out;
}

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

// Dedupe cross-listings by normalized company name, keeping the first-seen row
// (callers pass the higher-priority source first).
function dedupe(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = normalizeName(r.company);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function main() {
  if (flag('--fixture')) {
    const issuers = readCsv(path.join(PATHS.fixtures, 'issuers_fixture.csv'));
    console.log(`Fixture mode: ${issuers.length} issuers`);
    writeCsv(PATHS.issuers, issuers, ['ticker', 'exchange', 'company', 'sector', 'market_cap']);
    return;
  }

  // 1) Explicit ready-made list — highest priority, no network.
  const explicit = opt('--issuers-csv');
  if (explicit) {
    const issuers = dedupe(readIssuerCsv(explicit));
    console.log(`Using --issuers-csv ${explicit}: ${issuers.length} issuers`);
    writeCsv(PATHS.issuers, issuers, ['ticker', 'exchange', 'company', 'sector', 'market_cap']);
    return;
  }

  // 2) Hand-maintained manual file — the recommended reliable path.
  const manualFile = path.join(PATHS.manual, 'issuers.csv');
  if (fs.existsSync(manualFile)) {
    const issuers = dedupe(readIssuerCsv(manualFile));
    console.log(`Using manual list ${manualFile}: ${issuers.length} issuers`);
    writeCsv(PATHS.issuers, issuers, ['ticker', 'exchange', 'company', 'sector', 'market_cap']);
    return;
  }

  // 3) Best-effort auto-fetch. The exchanges block automated downloads, so a
  //    failing source just warns and is skipped — we only hard-fail on zero.
  const collected = [];
  for (const [label, fn] of [['TSXV', tsxvIssuers], ['CSE', cseIssuers]]) {
    try {
      collected.push(...(await fn()));
    } catch (err) {
      console.warn(`  ⚠ ${label} auto-fetch skipped: ${err.message}`);
    }
  }
  const issuers = dedupe(collected);
  if (!issuers.length) {
    throw new Error(
      'No issuers resolved. The exchanges block automated downloads, so provide a\n' +
      'hand-maintained list instead:\n' +
      `  • drop a CSV (ticker,exchange,company) at ${manualFile}, or\n` +
      '  • pass --issuers-csv <path> (or --xlsx / --cse-csv for a local export).\n' +
      'See data/pseo/manual/issuers.example.csv for the format.'
    );
  }
  console.log(`Auto-fetched ${issuers.length} issuers`);
  writeCsv(PATHS.issuers, issuers, ['ticker', 'exchange', 'company', 'sector', 'market_cap']);
}

main().catch((err) => { console.error(`\n✗ 01_fetch_issuers failed:\n${err.message}`); process.exit(1); });
