// Which U.S. state a BLM mining claim is in, decided from the claim's own row.
//
// Shared by the live proxy (api/claims.js, which places each row it gets back
// from BLM) and the mirror loader (scripts/update-us-claims.mjs, which stores
// the answer), so a claim lands in the same state whichever path served it.
//
// Pure, no dependencies.
//
// WHY PER ROW. BLM's October 2026 "Active Mining Claims" layer publishes
// GEO_STATE and ADMIN_STATE, but GEO_STATE is NULL on 88% of rows and
// ADMIN_STATE on 64%. What it does fill in (98% of rows) is CSE_META, the PLSS
// legal land description, one per aliquot, each led by the state the land is
// in: "NV 21 0330N 0510E 033 A SE|NV 21 0320N 0510E 004 A NE". So:
//
//   1. GEO_STATE, when BLM filled it in             → 'geo_state'
//   2. else the states in the legal description     → 'legal_description'
//   3. else the administering office's serial prefix → 'serial_prefix'
//      (administrative, not geographic: declared degraded to the user), and
//      never for Oregon/Washington, whose shared office cannot tell them apart
//   4. else nothing                                  → 'none'

/** The eleven states served. Alaska is deliberately absent (state-managed claims). */
export const US_STATE_CODES = ['NV', 'AZ', 'UT', 'ID', 'MT', 'WY', 'CO', 'NM', 'CA', 'OR', 'WA'];

// MLRS serial (CSE_NR) prefix and legacy LR2000 office prefix (LEG_CSE_NR) per
// state. Oregon and Washington share one BLM office: every Washington claim
// carries an OR… serial (Oct 2026: CSE_NR LIKE 'WA%' matches nothing; all
// 2,636 Washington-located claims are OR…), so their prefix only narrows a
// query to the shared office (sharedOffice) and never places a claim.
export const US_SERIAL_PREFIXES = {
  NV: { mlrs: 'NV', legacyOffice: 'NMC' },
  AZ: { mlrs: 'AZ', legacyOffice: 'AMC' },
  UT: { mlrs: 'UT', legacyOffice: 'UMC' },
  ID: { mlrs: 'ID', legacyOffice: 'IMC' },
  MT: { mlrs: 'MT', legacyOffice: 'MMC' },
  WY: { mlrs: 'WY', legacyOffice: 'WMC' },
  CO: { mlrs: 'CO', legacyOffice: 'CMC' },
  NM: { mlrs: 'NM', legacyOffice: 'NMMC' },
  CA: { mlrs: 'CA', legacyOffice: 'CAMC' },
  OR: { mlrs: 'OR', legacyOffice: 'ORMC', sharedOffice: true },
  WA: { mlrs: 'OR', legacyOffice: 'ORMC', sharedOffice: true },
};

/**
 * The states a PLSS legal description places a claim in.
 * "NV 21 0330N 0510E 033 A SE|NV 21 0320N 0510E 004 A NE" → ['NV'].
 * A claim straddling a state line lists both states and belongs to both.
 */
export function legalDescriptionStates(text) {
  if (text == null) return [];
  return [...new Set(String(text).split('|')
    .map((part) => part.trim().slice(0, 3))
    .filter((head) => /^[A-Za-z]{2}(\s|$)/.test(head))
    .map((head) => head.slice(0, 2).toUpperCase()))];
}

/**
 * The administering office a serial belongs to, as the state whose prefix it
 * carries (OR for the shared Oregon/Washington office), or null.
 * Longest prefix first: NMMC (New Mexico legacy) must not read as NM… or NMC.
 */
export function serialOffice(serial, legacy) {
  const s = String(serial ?? '').trim().toUpperCase();
  const l = String(legacy ?? '').trim().toUpperCase();
  if (s) {
    for (const [st, p] of Object.entries(US_SERIAL_PREFIXES)) {
      if (!p.sharedOffice && s.startsWith(p.mlrs)) return st;
    }
    if (s.startsWith('OR')) return 'OR';
  }
  if (l) {
    const byLength = Object.entries(US_SERIAL_PREFIXES)
      .filter(([, p]) => !p.sharedOffice)
      .sort((a, b) => b[1].legacyOffice.length - a[1].legacyOffice.length);
    for (const [st, p] of byLength) if (l.startsWith(p.legacyOffice)) return st;
    if (l.startsWith('ORMC')) return 'OR';
  }
  return null;
}

/**
 * Every state a claim is in, and how we know.
 * @param {{geoState?: string, legalDescription?: string, serial?: string, legacySerial?: string}} row
 * @returns {{states: string[], source: 'geo_state'|'legal_description'|'serial_prefix'|'none', office: string|null}}
 */
export function claimStates({ geoState, legalDescription, serial, legacySerial } = {}) {
  const office = serialOffice(serial, legacySerial);
  const geo = String(geoState ?? '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(geo)) return { states: [geo], source: 'geo_state', office };
  const legal = legalDescriptionStates(legalDescription);
  if (legal.length) return { states: legal, source: 'legal_description', office };
  // The shared Oregon/Washington office cannot place a claim.
  if (office && office !== 'OR') return { states: [office], source: 'serial_prefix', office };
  return { states: [], source: 'none', office };
}
