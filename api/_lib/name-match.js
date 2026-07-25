// Company-name normalization and similarity scoring.
//
// This is the single source of truth for both the pSEO owner-matching pipeline
// (scripts/pseo/lib.mjs re-exports it) and the runtime US claimant resolution
// in api/claims.js. It moved here from scripts/pseo/lib.mjs unchanged so the
// serverless function can reuse the exact same normalization and thresholds
// the offline matcher was tuned against — a runtime resolver that scored names
// differently from the pipeline would silently disagree with review_queue.csv.
//
// Dependency-free and deterministic on purpose: no rapidfuzz/fuzzball here.
// The thresholds below are the pipeline's existing ones, not new numbers.

const LEGAL_SUFFIXES = /\b(INCORPORATED|INC|LIMITED|LTD|LTEE|LTÉE|CORPORATION|CORP|COMPANY|CO|PLC|SA|AG|NL|LLC|LP|ULC|HOLDINGS?|GROUP)\b\.?/g;
const NOISE_WORDS = new Set(['THE', 'OF', 'AND', '&', 'A']);

// Match thresholds on the 0–100 nameScore scale.
//   auto   ≥ this is accepted without a human in the loop
//   review [review, auto) goes to a human review queue, never auto-accepted
export const NAME_MATCH = {
  auto: 92,
  review: 80,
};

export function normalizeName(raw) {
  if (!raw) return '';
  return String(raw)
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')          // strip accents
    .replace(/\([^)]*\)/g, ' ')                                // parentheticals
    .replace(/[^A-Z0-9& ]+/g, ' ')                             // punctuation
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(normalized) {
  return normalized.split(' ').filter((t) => t && !NOISE_WORDS.has(t));
}

// 0–100 similarity between two already-normalized names. Exact = 100; token
// Dice overlap weighted with a prefix bonus. Deterministic and dependency-free.
export function nameScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 100;
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  const inter = ta.filter((t) => setB.has(t)).length;
  const dice = (2 * inter) / (ta.length + tb.length);
  let score = Math.round(dice * 90);
  // Prefix bonus: first tokens agree (distinctive part of mining co names)
  if (ta[0] === tb[0]) score += 8;
  if (ta.length >= 2 && tb.length >= 2 && ta[1] === tb[1]) score += 2;
  // Containment (one name fully inside the other) is a strong signal
  if (inter === Math.min(ta.length, tb.length)) score = Math.max(score, 88 + Math.min(inter, 4));
  return Math.min(score, 99); // only literal equality reaches 100
}
