#!/usr/bin/env node
// 04 — Match registry claim owners to exchange issuers.
//
//   node scripts/pseo/04_match_owners.mjs
//
// Inputs : issuers.csv, claims_bc.csv / claims_on.csv (whichever exist),
//          aliases.csv (optional; owner_raw → ticker overrides, grows over time)
// Outputs: matches.csv       one row per (ticker, owner_raw, province) ≥ auto
//          review_queue.csv  scores in [review, auto) for the human loop
//
// Scoring: normalized-name equality = 100; token Dice + prefix bonuses below
// (lib.nameScore). Aliases always win at score 100 with source=alias.

import fs from 'node:fs';
import { PATHS, MATCH } from './config.mjs';
import { readCsv, writeCsv, normalizeName, nameScore } from './lib.mjs';

function loadClaims() {
  const files = [PATHS.claimsBc, PATHS.claimsOn].filter((f) => fs.existsSync(f));
  if (!files.length) throw new Error('No claims CSVs found — run 02/03 first.');
  const rows = files.flatMap((f) => readCsv(f));
  console.log(`Loaded ${rows.length} claims from ${files.length} file(s)`);
  return rows;
}

function main() {
  const issuers = readCsv(PATHS.issuers);
  const claims = loadClaims();
  const aliases = fs.existsSync(PATHS.aliases) ? readCsv(PATHS.aliases) : [];
  const aliasMap = new Map(aliases.map((a) => [normalizeName(a.owner_raw), a.ticker]));
  const issuerByTicker = new Map(issuers.map((i) => [i.ticker, i]));
  const issuerNorms = issuers.map((i) => ({ ...i, norm: normalizeName(i.company) }));

  // Distinct owners with claim stats per (owner, province)
  const ownerStats = new Map();
  for (const c of claims) {
    const key = `${c.owner_raw}||${c.province}`;
    const s = ownerStats.get(key) || { owner_raw: c.owner_raw, province: c.province, claims: 0, ha: 0 };
    s.claims += 1;
    s.ha += Number(c.area_ha) || 0;
    ownerStats.set(key, s);
  }
  console.log(`Distinct (owner, province) pairs: ${ownerStats.size}`);

  const matches = [];
  const review = [];
  for (const s of ownerStats.values()) {
    const norm = normalizeName(s.owner_raw);
    if (!norm) continue;

    const aliasTicker = aliasMap.get(norm);
    if (aliasTicker && issuerByTicker.has(aliasTicker)) {
      const iss = issuerByTicker.get(aliasTicker);
      matches.push(row(iss, s, 100, 'alias'));
      continue;
    }

    let best = null;
    for (const iss of issuerNorms) {
      const score = nameScore(norm, iss.norm);
      if (!best || score > best.score) best = { iss, score };
      if (score === 100) break;
    }
    if (!best) continue;
    if (best.score >= MATCH.auto) matches.push(row(best.iss, s, best.score, 'name'));
    else if (best.score >= MATCH.review) review.push(row(best.iss, s, best.score, 'name'));
  }

  matches.sort((a, b) => a.ticker.localeCompare(b.ticker) || b.claims - a.claims);
  review.sort((a, b) => b.score - a.score);

  writeCsv(PATHS.matches, matches, ['ticker', 'exchange', 'company', 'owner_raw', 'province', 'claims', 'total_ha', 'score', 'source', 'verified']);
  writeCsv(PATHS.reviewQueue, review, ['ticker', 'exchange', 'company', 'owner_raw', 'province', 'claims', 'total_ha', 'score', 'source', 'verified']);

  const tickers = new Set(matches.map((m) => m.ticker));
  console.log(`\n✓ ${matches.length} auto-matches across ${tickers.size} tickers`);
  console.log(`  ${review.length} in the review queue (scores ${MATCH.review}–${MATCH.auto - 1})`);
  console.log('\nReview loop: confirm rows in review_queue.csv, append confirmed pairs to');
  console.log(`aliases.csv (owner_raw,ticker) and re-run. Hand-verify top-300 by market cap`);
  console.log('(set verified=yes in matches.csv) before pages go live.');
}

function row(iss, s, score, source) {
  return {
    ticker: iss.ticker, exchange: iss.exchange, company: iss.company,
    owner_raw: s.owner_raw, province: s.province,
    claims: s.claims, total_ha: Math.round(s.ha * 10) / 10,
    score, source, verified: '',
  };
}

try { main(); } catch (err) { console.error(`\n✗ 04_match_owners failed:\n${err.message}`); process.exit(1); }
