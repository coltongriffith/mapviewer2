// Provenance helpers shared by the registry search, the map banners, and the
// export credit line.
//
// The export is the filing artifact — it is what ends up in an NI 43-101
// technical report or an investor deck, detached from the app that made it. So
// every qualification a reader needs to judge the claim set has to be legible
// on the exported image itself: what the data is, when it was retrieved, how the
// jurisdiction was scoped, and — critically — whether the claims were linked to
// a company by an ownership record or merely by a claim name.

// The single sentence that explains why a claim-name match is not ownership.
// Shown at the confirmation gate, in the map banner, and (condensed) in the
// export credit. Worded once so those three never drift apart.
export const CLAIM_NAME_CAVEAT =
  'These claims were matched by claim name, not by a claimant record. BLM does not publish claimant names in its public map data, and claim names are chosen by whoever located the claim — a name match does not establish who holds the ground.';

// Longest common leading run of whole tokens across the claim names in a set,
// e.g. ["AWESOME GOLD 1", "AWESOME GOLD 2"] → "AWESOME GOLD". Used to title a
// claim-name-resolved layer by what actually matched. Returns null when the
// names share no leading token (a heterogeneous set has no honest single title).
export function claimNamePrefix(features) {
  const names = (features || [])
    .map((f) => f?.properties?.CLAIM_NAME)
    .filter((n) => typeof n === 'string' && n.trim())
    .map((n) => n.trim());
  if (!names.length) return null;
  if (names.length === 1) return names[0];

  const tokenLists = names.map((n) => n.split(/\s+/));
  const shortest = Math.min(...tokenLists.map((t) => t.length));
  const shared = [];
  for (let i = 0; i < shortest; i++) {
    const tok = tokenLists[0][i];
    if (!tokenLists.every((t) => t[i] === tok)) break;
    shared.push(tok);
  }
  // A trailing numeric token is a claim sequence number, not part of the name.
  while (shared.length && /^[#]?\d+$/.test(shared[shared.length - 1])) shared.pop();
  if (!shared.length) return null;
  return shared.join(' ');
}

// Human-readable data-source credit for a jurisdiction's live registry.
export function sourceCredit(jurisdictionCfg, meta = null) {
  if (meta?.provider === 'blm-mlrs' || jurisdictionCfg?.country === 'us') {
    return 'BLM MLRS — Mining Claims Not Closed (federal)';
  }
  const registry = jurisdictionCfg?.registry;
  const label = jurisdictionCfg?.label;
  if (registry && label) return `${label} — ${registry}`;
  return registry || label || 'Claims registry';
}

// Scoping wording for the export credit — terse, factual, no warning styling.
const SCOPING_CREDIT = {
  geo_state: 'state scope: geographic (GEO_STATE)',
  admin_state: 'state scope: administering BLM office (approximate)',
  serial_prefix: 'state scope: case-serial prefix (approximate)',
};

const RESOLVED_CREDIT = {
  claimant: 'company link: claimant record',
  claim_name: 'company link: claim name only — not an ownership record',
};

// Build the permanent source credit line(s) rendered INTO an export.
//
// Styled as a standard cartographic credit, not a warning: a reader of a filed
// map expects a source note, and dressing it as an alert would get it cropped.
// It still states the two things that change how the map should be read —
// degraded scoping and a claim-name-only company link — in plain words.
//
// Returns an array of lines (one per distinct source), newest sources last.
export function exportCreditLines(layers) {
  const seen = new Map();
  for (const layer of layers || []) {
    const p = layer?.provenance;
    if (!p) continue;
    const parts = [];
    if (p.dataSource) parts.push(p.dataSource);
    if (p.snapshotDate) parts.push(`snapshot ${p.snapshotDate}`);
    else if (p.retrievedAt) parts.push(`retrieved ${p.retrievedAt}`);
    if (p.scopingMethod && SCOPING_CREDIT[p.scopingMethod]) parts.push(SCOPING_CREDIT[p.scopingMethod]);
    if (p.resolvedAgainst && RESOLVED_CREDIT[p.resolvedAgainst]) parts.push(RESOLVED_CREDIT[p.resolvedAgainst]);
    if (!parts.length) continue;
    const line = `Source: ${parts.join(' · ')}`;
    // Identical provenance across several layers credits once.
    if (!seen.has(line)) seen.set(line, true);
  }
  return [...seen.keys()];
}
