// US-subsidiary alias layer for BLM claimant resolution.
//
// WHY THIS EXISTS
// US mining claims held by Canadian-listed issuers are almost never recorded
// under the parent's name. They sit under a US holding company ("X Gold US
// Inc.", "X Nevada LLC"), and the BLM claimant field frequently carries the
// LOCATOR (a staking contractor or an individual) rather than the beneficial
// owner. Corporate-suffix stripping alone does not bridge that gap: "X Gold
// Corp" and "X Nevada LLC" share only the distinctive token, and a bare
// suffix-stripped comparison of the two either misses or over-matches.
//
// So parent → claimant resolution runs in three tiers (see resolveUsCompanyTiers):
//   1. exact      claimant string equals the parent name
//   2. alias      curated parent→claimant pairs, plus deterministic US
//                 subsidiary-name variants generated from the parent name
//   3. fuzzy      broad stem query, then scored with the pipeline's own
//                 nameScore/NAME_MATCH.auto threshold (no new thresholds)
//
// A tier that returns nothing falls through to the next. All three returning
// nothing is reported as UNRESOLVED — explicitly distinct from "this company
// is resolved and holds no claims here". Those two must never share a message:
// one means "we could not link this issuer to a claimant", the other means
// "this issuer holds no ground in this state", and an investor reading a map
// needs to know which.
//
// CURATION
// data/pseo/aliases.csv is the human-editable source (kind=us_subsidiary rows,
// jurisdiction-tagged). scripts/pseo/08_seed_us_aliases.mjs queries live BLM
// claimant strings, cross-matches them against issuers.csv, and writes
// data/pseo/us_alias_review_queue.csv for a human to confirm — fuzzy hits are
// NEVER auto-accepted into the table below.

import { normalizeName, nameScore, NAME_MATCH } from './name-match.js';

// State code → the state word that appears in subsidiary names.
export const US_STATE_NAMES = {
  NV: 'Nevada', AZ: 'Arizona', UT: 'Utah', ID: 'Idaho', MT: 'Montana',
  WY: 'Wyoming', CO: 'Colorado', NM: 'New Mexico', CA: 'California',
  OR: 'Oregon', WA: 'Washington',
};

// Hand-verified parent → claimant pairs. Jurisdiction is 'us' (any state) or a
// specific 'us-nv'-style key when a subsidiary only holds ground in one state.
//
// DELIBERATELY EMPTY. Every row here asserts that a named public company holds
// claims through a named subsidiary, which is a factual claim that shows up on
// maps filed with NI 43-101 technical reports. Rows are added only from a
// confirmed review-queue entry (verified=yes), never from a fuzzy score and
// never from an unverified guess. The generated variants below cover the
// common naming patterns without asserting anything about a specific company.
export const CURATED_US_ALIASES = [
  // { parent: 'Example Gold Corp.', claimant: 'Example Gold US Inc.', jurisdiction: 'us-nv', source: 'BLM MLRS claimant report 2026-07', verified: 'yes' },
];

// Deterministic US-subsidiary name variants for a parent company. These are
// naming *patterns* ("<stem> US Inc", "<stem> Nevada LLC"), not assertions
// about any particular issuer, so they are safe to generate at request time.
// Returned as match stems, uppercased and suffix-stripped — the caller wraps
// them in LIKE '%…%', so "AWESOME GOLD US" matches "AWESOME GOLD US INC.".
export function usClaimantVariants(company, stateCode = null) {
  const stem = normalizeName(company);
  if (!stem) return [];
  const state = stateCode ? US_STATE_NAMES[String(stateCode).toUpperCase()] : null;
  const out = [
    `${stem} US`,
    `${stem} USA`,
    `${stem} AMERICA`,
    `${stem} AMERICAS`,
    `${stem} RESOURCES US`,
    `${stem} MINING`,
    `${stem} MINERALS`,
    `${stem} EXPLORATION`,
  ];
  if (state) {
    out.push(`${stem} ${state.toUpperCase()}`);
    // "X (Nevada)" normalizes to "X" — the parenthetical form is covered by
    // the plain stem tier, so nothing extra is needed for it here.
  }
  return dedupe(out);
}

// Curated claimant strings for a parent, filtered to the jurisdiction.
// province is a full jurisdiction key ('us-nv'); 'us' rows apply everywhere.
export function curatedAliasesFor(company, province = null, table = CURATED_US_ALIASES) {
  const stem = normalizeName(company);
  if (!stem) return [];
  return dedupe(table
    .filter((row) => normalizeName(row.parent) === stem)
    .filter((row) => {
      const j = String(row.jurisdiction || 'us').toLowerCase();
      return j === 'us' || !province || j === String(province).toLowerCase();
    })
    .map((row) => row.claimant)
    .filter(Boolean));
}

// The broad stem used by the fuzzy tier: the first two significant tokens of
// the suffix-stripped name. Single-token names use the one token. Anything
// shorter than 3 characters is refused — a two-character LIKE '%XY%' against a
// national claim table is not a search, it is a table scan that also matches
// half of Nevada.
export function fuzzyStem(company) {
  const tokens = normalizeName(company).split(' ').filter(Boolean);
  if (!tokens.length) return null;
  const stem = tokens.slice(0, 2).join(' ');
  return stem.length >= 3 ? stem : null;
}

// The tier ladder for one company + jurisdiction. Each tier is run in order and
// the first one that returns features wins; `method` lands in the API response
// so the UI (and a filed map) can say how the link was made.
export function resolveUsCompanyTiers(company, province = null) {
  const stateCode = province ? String(province).replace(/^us-/i, '').toUpperCase() : null;
  const exact = String(company || '').trim();
  const aliases = [
    ...curatedAliasesFor(company, province),
    ...usClaimantVariants(company, stateCode),
  ];
  const stem = fuzzyStem(company);
  const tiers = [];
  if (exact) tiers.push({ method: 'exact', terms: [exact], scored: false });
  if (aliases.length) tiers.push({ method: 'alias', terms: dedupe(aliases).slice(0, 12), scored: false });
  // Only the fuzzy tier is score-filtered after the query; the exact and alias
  // tiers are already specific enough to trust their own rows.
  if (stem) tiers.push({ method: 'fuzzy', terms: [stem], scored: true });
  return tiers;
}

// Does a claimant/claim-name string from BLM belong to this company? Used to
// filter the fuzzy tier's broad result set. Compares against the parent name
// and every alias variant, keeping the pipeline's auto threshold (92) — a row
// below it is a review-queue candidate, not a search result.
export function matchesCompany(company, candidate, province = null) {
  if (!candidate) return false;
  const candNorm = normalizeName(candidate);
  if (!candNorm) return false;
  const stateCode = province ? String(province).replace(/^us-/i, '').toUpperCase() : null;
  const targets = [
    normalizeName(company),
    ...curatedAliasesFor(company, province).map(normalizeName),
    ...usClaimantVariants(company, stateCode),
  ];
  for (const t of targets) {
    if (!t) continue;
    if (nameScore(candNorm, t) >= NAME_MATCH.auto) return true;
    // A subsidiary name contains the parent stem plus a geography token
    // ("AWESOME GOLD NEVADA" vs "AWESOME GOLD"), which token-Dice scores below
    // auto on short names. Prefix containment on the full stem is an exact,
    // non-fuzzy signal, so it is accepted on its own.
    if (candNorm === t || candNorm.startsWith(`${t} `)) return true;
  }
  return false;
}

function dedupe(list) {
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}
