// Registered-owner name handling for B.C. mineral tenures.
//
// THE RULE THIS FILE ENFORCES: normalization ranks candidates, it never
// decides membership. Company names reach the registry with legal-suffix
// differences, abbreviations, subsidiaries, previous names, joint-venture
// partners, nominees, and punctuation noise. Two names that normalize to the
// same string are usually the same company — "usually" is not good enough to
// silently pull someone else's mineral title into a monitored portfolio, so
// every owner search ends at a confirmation step the user drives.
//
// Pure and dependency-free: shared by the browser, the Vitest suite, and the
// Node jobs under scripts/.

/**
 * Corporate/legal suffixes stripped when comparing names.
 *
 * Ordered longest-first so "limited partnership" is consumed before
 * "limited". Includes the French forms that appear on B.C. titles held by
 * Quebec-registered companies.
 */
const LEGAL_SUFFIXES = [
  'limited partnership', 'limited liability company', 'limited liability partnership',
  'incorporated', 'corporation', 'société par actions', 'societe par actions',
  'company', 'limited', 'compagnie', 'holdings', 'holding',
  'llc', 'llp', 'plc', 'ltee', 'ltée', 'inc', 'ltd', 'corp', 'co', 'lp', 'sa', 'nl', 'pty',
];

const SUFFIX_RE = new RegExp(
  `(?:^|[\\s,.])(?:${LEGAL_SUFFIXES.map(escapeRe).join('|')})\\.?(?=$|[\\s,.])`,
  'gi',
);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fold a registered-owner name to a comparison key.
 *
 * Lowercases, strips accents, removes punctuation, drops legal suffixes, and
 * collapses whitespace. "GOLIATH RESOURCES LTD." and "Goliath Resources
 * Limited" both become "goliath resources".
 *
 * Returns '' for input that normalizes away entirely (e.g. a name that is
 * nothing but a suffix), which callers must treat as "no usable key" rather
 * than as a match-everything wildcard.
 *
 * @param {string|null|undefined} raw
 * @returns {string}
 */
export function normalizeOwnerName(raw) {
  if (raw == null) return '';
  let s = String(raw);
  // Decompose accents so "Métaux" and "Metaux" compare equal. The combining
  // range is written as escapes, not literal marks, so the source survives any
  // editor or tool that re-normalizes the file.
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.toLowerCase();
  // Ampersand and "and" are used interchangeably in registry names.
  s = s.replace(/&/g, ' and ');
  // Strip suffixes before punctuation removal, while the delimiters still exist.
  s = s.replace(SUFFIX_RE, ' ');
  // Run a second pass: "Acme Holdings Ltd" needs both tokens removed, and the
  // first pass consumed the delimiter the second one would have matched on.
  s = s.replace(SUFFIX_RE, ' ');
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Split a source owner field that may carry several owners in one string.
 *
 * The B.C. layer publishes OWNER_NAME as a single text field. Where a title is
 * jointly held, that field has been observed carrying multiple names joined by
 * separators. We split conservatively — only on separators that cannot appear
 * inside a single company name — and we record how the split was reached so the
 * UI can be honest about it (see ownershipRepresentation below).
 *
 * A comma is deliberately NOT a separator: "Acme Resources, Inc." is one owner,
 * and guessing wrong here invents co-owners that do not exist.
 *
 * @param {string|null|undefined} raw
 * @returns {string[]} one or more trimmed names (empty array for empty input)
 */
export function splitOwnerField(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  const parts = s
    .split(/\s*(?:;|\|| \/ | & )\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [s];
}

/**
 * How faithfully we can represent this title's ownership.
 *
 * 'single_field' — the source gave one flat owner string; we cannot state
 *   percentages or prove the owner count. The UI says so rather than implying
 *   a sole owner.
 * 'multi_field'  — the source published discrete owner records.
 *
 * Stored per owner row so a later schema improvement upgrades new rows without
 * retroactively lying about old ones.
 */
export const OWNERSHIP_REPRESENTATION = {
  SINGLE_FIELD: 'single_field',
  MULTI_FIELD: 'multi_field',
};

// ── Candidate matching ─────────────────────────────────────────────────────

export const MATCH_CONFIDENCE = {
  EXACT: 'exact',       // identical after normalization
  POSSIBLE: 'possible', // one name contains the other, or tokens overlap heavily
  WEAK: 'weak',         // some token overlap; shown last, never pre-selected
};

/**
 * Classify how well a candidate owner matches what the user searched for.
 *
 * Never returns a boolean, and never filters: the caller shows every candidate
 * grouped by confidence and the user picks. Only EXACT is safe to pre-select.
 *
 * @param {string} query      what the user typed
 * @param {string} candidate  a registered owner name from the registry
 * @returns {{confidence: string, score: number}|null} null when either side has no usable key
 */
export function classifyOwnerMatch(query, candidate) {
  const q = normalizeOwnerName(query);
  const c = normalizeOwnerName(candidate);
  if (!q || !c) return null;

  if (q === c) return { confidence: MATCH_CONFIDENCE.EXACT, score: 1 };

  const qTokens = new Set(q.split(' ').filter(Boolean));
  const cTokens = new Set(c.split(' ').filter(Boolean));
  if (!qTokens.size || !cTokens.size) return null;

  let shared = 0;
  for (const t of qTokens) if (cTokens.has(t)) shared += 1;
  if (shared === 0) return null;

  // Jaccard over tokens — symmetric, so a long registry name doesn't
  // automatically outrank a short one or vice versa.
  const union = new Set([...qTokens, ...cTokens]).size;
  const score = shared / union;

  // Whole-phrase containment ("goliath resources" inside "goliath resources
  // canada") is the single strongest signal short of an exact hit.
  const contained = c.includes(q) || q.includes(c);
  if (contained || score >= 0.6) return { confidence: MATCH_CONFIDENCE.POSSIBLE, score };
  return { confidence: MATCH_CONFIDENCE.WEAK, score };
}

/**
 * Group candidate tenures by match confidence for the confirmation step.
 *
 * @param {string} query
 * @param {Array<{owner_name?: string, ownerName?: string}>} candidates
 * @returns {{exact: Array, possible: Array, weak: Array, total: number}}
 */
export function groupOwnerCandidates(query, candidates = []) {
  const exact = [];
  const possible = [];
  const weak = [];
  for (const cand of candidates) {
    const name = cand?.owner_name ?? cand?.ownerName ?? '';
    const m = classifyOwnerMatch(query, name);
    const row = { ...cand, matchConfidence: m?.confidence || MATCH_CONFIDENCE.WEAK, matchScore: m?.score ?? 0 };
    if (m?.confidence === MATCH_CONFIDENCE.EXACT) exact.push(row);
    else if (m?.confidence === MATCH_CONFIDENCE.POSSIBLE) possible.push(row);
    else weak.push(row);
  }
  const byScore = (a, b) => b.matchScore - a.matchScore;
  possible.sort(byScore);
  weak.sort(byScore);
  return { exact, possible, weak, total: exact.length + possible.length + weak.length };
}

/**
 * The confirmation prompt. Deliberately states a count and asks the user to
 * choose — it never says "we found your claims".
 */
export function ownerMatchPrompt(total, searchedNames) {
  const names = Array.isArray(searchedNames) ? searchedNames.length : 1;
  const titles = total === 1 ? '1 title' : `${total} titles`;
  const searched = names === 1 ? 'the name you searched' : 'the names you searched';
  return `We found ${titles} associated with ${searched}. Select the titles that belong in this portfolio.`;
}
