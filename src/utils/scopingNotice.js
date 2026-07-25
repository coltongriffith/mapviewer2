// User-facing text for degraded US state scoping, and for the two zero-result
// outcomes that must never share a message.
//
// api/claims.js declares how it scoped every US claim set (meta.scopingMethod:
// geo_state | admin_state | serial_prefix). Only geo_state is geographically
// precise. The other two are administrative — a BLM state office can administer
// cases in another state — so a claim set produced under them may omit claims
// inside the state and include claims outside it.
//
// These maps go into NI 43-101 technical reports and investor decks. A
// wrong-but-plausible claim set is the worst failure this product can produce,
// so a degraded scope is stated wherever the claims are shown: in the search
// results AND on the map itself, carried through the layer's provenance.

export const SCOPING_WARNINGS = {
  admin_state: {
    short: 'Approximate state scoping',
    detail: 'These claims were selected by administering BLM office, not by claim location — the geographic state field is unavailable right now. Claims near the state line may be missing, and a few may sit outside the state. Verify against BLM records before using this in a filing.',
  },
  serial_prefix: {
    short: 'Approximate state scoping (serial prefix)',
    detail: 'The BLM state fields are unavailable, so these claims were selected by case-serial prefix. Serial prefixes follow the administering BLM office rather than the claim location, so claims near the state line may be missing, and a few may sit outside the state. Verify against BLM records before using this in a filing.',
  },
};

// Warning for a claims response, or null when scoping was precise (or the
// jurisdiction needs no scoping at all, e.g. Canadian provinces).
export function scopingWarning(meta) {
  if (!meta?.scopingDegraded) return null;
  const preset = SCOPING_WARNINGS[meta.scopingMethod];
  if (!preset) {
    return { short: 'Approximate state scoping', detail: meta.scopingNote || 'State scoping is degraded for this result set.', method: meta.scopingMethod || 'unknown' };
  }
  // Prefer the server's own note when it sent one — it names the actual field.
  return { ...preset, detail: meta.scopingNote || preset.detail, method: meta.scopingMethod };
}

// Zero results have two distinct causes and two distinct messages.
//
//   unresolved  we could not link the company to any BLM claimant or claim
//               name. Says nothing about whether it holds ground.
//   empty       the company resolved and genuinely holds no claims here.
//
// Collapsing these into one "no claims found" is the bug: a US issuer whose
// Nevada ground sits under a subsidiary looks identical to one that owns
// nothing. Never merge them.
export function emptyResultMessage({ resolution, query, jurisdictionLabel, isUs }) {
  if (resolution?.status === 'unresolved') {
    const base = `We couldn't link "${query}" to a claim holder in ${jurisdictionLabel}.`;
    if (resolution.reason === 'no_claimant_field') {
      return {
        kind: 'unresolved',
        headline: base,
        detail: 'BLM\'s public map data publishes no claimant names, so there is nothing to match a company against directly. This is not a statement that the company holds no ground here.',
        hint: isUs
          ? 'US claims are usually recorded under a subsidiary ("… US Inc.", "… Nevada LLC"). Try the subsidiary name, or a claim name, or look up serial numbers in BLM\'s Customer Info Report and search a serial.'
          : 'Try a claim number instead.',
      };
    }
    return {
      kind: 'unresolved',
      headline: base,
      detail: 'We tried the company name, its known US subsidiaries, and a close-name match — none of them matched a holder record. This is not a statement that the company holds no ground here.',
      hint: isUs
        ? 'US claims are usually recorded under a subsidiary ("… US Inc.", "… Nevada LLC") and BLM often lists the locator rather than the owner. Try the subsidiary name, or search a serial number.'
        : 'Try a shorter name, an alternate spelling, or a claim number.',
    };
  }
  return {
    kind: 'empty',
    headline: `No active claims found for "${query}" in ${jurisdictionLabel}.`,
    detail: null,
    hint: 'Try a shorter name or check spelling.',
  };
}
