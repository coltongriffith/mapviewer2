// What somebody typed into the Claim # box, read as claim numbers.
//
// The claim-number search used to take the box verbatim. Telemetry from the
// Quebec guide (Oct 2026) showed what people actually paste: "#4527312", a list
// of thirty numbers separated by spaces copied off a claim schedule, and
// company names typed into the wrong tab. Each of those was sent upstream as one
// literal string and came back as an error. This reads the box the way a person
// means it, and is shared by the search form (src/components/RegistrySearch.jsx)
// and the proxy (api/claims.js) so both agree on what a "list" is.
//
// Pure, no dependencies: it is imported by the editor's lazy registry chunk and
// by the serverless function.

// One search answers at most this many numbers. A claim schedule pasted whole
// can run to hundreds; the cap keeps one request to one upstream query of a
// readable size, and the form says plainly which numbers were left out.
export const MAX_CLAIM_NUMBERS = 100;

// The longest box a number list may be. 100 seven-digit numbers with separators
// is ~800 characters; the rest is room for "#", commas and stray words. Company
// and claim-name searches keep their own, much shorter limit.
export const MAX_NUMBER_LIST_LENGTH = 1600;

// Words that ride along with a number without changing it ("claims 2351771 and
// 2351772", "CDC 2654321", "No. 627637"). Anything else that has no digit makes
// the box text, not a list of numbers.
const FILLER = /^(?:and|or|et|claims?|titles?|titres?|tenures?|cdc|nos?|numbers?|num|n°|nº|&)$/i;

// Strip what people put in front of a number: "#", "No.", "N°".
function stripMarkers(s) {
  return s.replace(/#/g, ' ').replace(/(^|[\s,;])(?:no\.|n[°º]\.?)\s*/gi, '$1 ');
}

// Punctuation at either end of a token is never part of a claim number
// ("2351771." at the end of a sentence, "(627637)").
const EDGE = /^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g;
// What may remain inside one: letters, digits and the hyphen some registries
// keep ("CB-12345"). A token with anything else is not a number.
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * @param {string} input what was typed or pasted
 * @param {{max?: number}} [opts]
 * @returns {{
 *   kind: 'empty'|'numbers'|'text',
 *   numbers: string[],   // de-duplicated, in the order typed, at most `max`
 *   total: number,       // how many distinct numbers were found before the cap
 *   truncated: boolean,  // total > max
 *   words: string[],     // tokens with no digit that are not filler
 * }}
 */
export function parseClaimNumbers(input, { max = MAX_CLAIM_NUMBERS } = {}) {
  const raw = stripMarkers(String(input ?? ''));
  // Commas, semicolons, pipes, tabs and newlines always separate numbers;
  // spaces do too, except between a short letter prefix and its digits.
  const parts = raw.split(/[\s,;|]+/).map((t) => t.replace(EDGE, '')).filter(Boolean);

  // "CB 12345", "NV 105331298": a one-to-three-letter prefix written apart from
  // its digits is one identifier, not a word and a number.
  const tokens = [];
  for (let i = 0; i < parts.length; i += 1) {
    const t = parts[i];
    const next = parts[i + 1];
    if (/^[A-Za-z]{1,3}$/.test(t) && !FILLER.test(t) && next && /^\d/.test(next)) {
      tokens.push(t + next);
      i += 1;
    } else {
      tokens.push(t);
    }
  }

  const words = tokens.filter((t) => !/\d/.test(t) && !FILLER.test(t));
  const candidates = tokens.filter((t) => /\d/.test(t));
  if (!candidates.length && !words.length) return { kind: 'empty', numbers: [], total: 0, truncated: false, words };
  // Any real word makes the whole box text: "1911 Gold" is a company, not claim
  // 1911, and "big ridge gold corp" typed into Claim # is a company search.
  if (words.length || candidates.some((t) => !TOKEN.test(t))) {
    return { kind: 'text', numbers: [], total: 0, truncated: false, words };
  }

  const seen = new Set();
  const unique = candidates.filter((t) => {
    const key = t.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    kind: 'numbers',
    numbers: unique.slice(0, max),
    total: unique.length,
    truncated: unique.length > max,
    words,
  };
}

/** The box with "#", "No." and edge punctuation removed: the one number in it, as typed. */
export function cleanSingleNumber(input) {
  return stripMarkers(String(input ?? '')).trim().replace(EDGE, '').replace(/\s+/g, ' ');
}
