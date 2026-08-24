// What to say when the search that answered is not the search that was asked.
//
// The server widens a query rather than returning nothing (see the near-miss
// ladders in api/claims.js) and reports what it actually ran in
// meta.relaxedKind / relaxedMatch / relaxedFrom / relaxedTo. This turns that
// into the sentence shown ABOVE the results.
//
// The rule: a widened answer must never be readable as an exact one. These maps
// go into NI 43-101 reports and investor decks, so "here are claims whose
// number starts with yours" and "here is the claim you asked for" cannot look
// alike. That is why the copy names both the search asked for and the search
// that ran, and why a number near-miss never borrows the holder wording — those
// claims belong to whoever holds them, not to the company the user had in mind.

const NUMBER_MATCH_PHRASE = {
  prefix: 'starting with',
  contains: 'containing',
};

/**
 * @param {object} meta       the FeatureCollection meta from /api/claims
 * @param {object} ctx        { query, jurisdictionLabel, province, count }
 * @returns {{headline: string, detail: string|null}|null} null when the exact search answered
 */
export function relaxationNotice(meta, { query, jurisdictionLabel, province, count } = {}) {
  if (!meta?.relaxedTo) return null;
  const asked = meta.relaxedFrom || query || '';
  const ran = meta.relaxedTo;
  const kind = meta.relaxedKind || 'owner';
  const where = jurisdictionLabel ? ` in ${jurisdictionLabel}` : '';

  if (kind === 'number') {
    const phrase = NUMBER_MATCH_PHRASE[meta.relaxedMatch] || 'close to';
    const n = typeof count === 'number' ? count : null;
    return {
      headline: `No claim numbered ${asked}${where}. `
        + `Showing ${n === null ? 'claims' : `${n === 1 ? 'the claim' : `${n} claims`}`} with a number ${phrase} ${ran}.`,
      detail: meta.relaxedLimited
        ? `These are the closest numbers in the registry, capped at ${meta.relaxedLimited}. `
          + 'They are different claims from the one you typed — check the number on each before adding it to a map.'
        : 'These are different claims from the one you typed — check the number on each before adding it to a map.',
    };
  }

  if (kind === 'name') {
    return {
      headline: `No claim named "${asked}"${where}. Showing claims whose name contains "${ran}".`,
      detail: 'A claim name is chosen by whoever staked it. A name match is not a '
        + 'statement about who holds the ground.',
    };
  }

  // Holder search. Quebec keeps its own sentence: GESTIM is francophone and
  // records the legal name on title, so the reason a looser match was needed
  // there is usually vocabulary rather than spelling, and the user needs to
  // know which French word to look for.
  const base = {
    headline: `No exact match for "${asked}"${where}. Showing holders matching "${ran}".`,
  };
  if (province === 'qc') {
    return {
      ...base,
      detail: 'Quebec records the legal name on title, often in French — a company '
        + 'known for gold may be recorded as "Aurifère". Check the holder names below '
        + 'before adding them to a map.',
    };
  }
  return {
    ...base,
    detail: 'Registries record the legal entity on title, which is often a project '
      + 'subsidiary rather than the parent. Check the holder names below before '
      + 'adding them to a map.',
  };
}
