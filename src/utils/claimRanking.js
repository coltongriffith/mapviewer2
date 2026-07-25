// Ranking for cross-jurisdiction claim hits.
//
// When a company deep-link lands on the wrong jurisdiction, the app fans out
// across the others and (for auto-searches only) adopts the strongest hit. That
// choice used to be "most claims", which is not materiality: US federal lode
// claims are ~20 acres each, so forty dormant Nevada claims outrank a
// four-claim BC flagship on count while representing far less ground. Area is
// the honest proxy, so candidates rank by total area first.
//
//   1. total area (hectares) descending — RCRD_ACRS is already converted to
//      AREA_IN_HECTARES by api/claims.js, and Canadian registries publish
//      hectares directly, so one comparison works across both
//   2. most recent recording date, when areas tie
//   3. claim count, only as a last resort — and for the whole candidate set
//      when NO candidate publishes area, since ranking a set of zeroes by
//      arbitrary order would be worse than ranking it by count

// Total known area of a hit, in hectares. Returns null when no feature in the
// set publishes an area — distinct from a genuine zero.
export function hitTotalHectares(hit) {
  const feats = hit?.data?.features || [];
  let total = 0;
  let seen = false;
  for (const f of feats) {
    const ha = Number(f?.properties?.AREA_IN_HECTARES);
    if (Number.isFinite(ha) && ha > 0) { total += ha; seen = true; }
  }
  return seen ? total : null;
}

// Most recent recording date in a hit, as a sortable timestamp (or null).
// RECORDED_DATE is the BLM recording date (api/claims.js). GOOD_TO_DATE is an
// expiry, not a recording date — it is used only as a weak proxy for Canadian
// registries, which publish no recording date, and only ever as a tie-break.
export function hitLatestDate(hit) {
  const feats = hit?.data?.features || [];
  let latest = null;
  for (const f of feats) {
    const raw = f?.properties?.RECORDED_DATE ?? f?.properties?.GOOD_TO_DATE;
    if (raw == null) continue;
    const t = typeof raw === 'number' ? raw : Date.parse(String(raw).slice(0, 10));
    if (Number.isFinite(t) && (latest == null || t > latest)) latest = t;
  }
  return latest;
}

// Decorate hits with the ranking inputs, strongest first. Input order is
// preserved for equal candidates (stable sort), so this never reshuffles
// arbitrarily.
export function rankJurisdictionHits(hits) {
  const list = (hits || []).map((hit, i) => ({
    hit,
    i,
    totalHa: hitTotalHectares(hit),
    latestDate: hitLatestDate(hit),
    count: hit?.count ?? (hit?.data?.features?.length || 0),
  }));
  // Area is only a usable ranking key if at least one candidate publishes it.
  const anyArea = list.some((r) => r.totalHa != null);
  return list
    .sort((a, b) => {
      if (anyArea) {
        const areaDiff = (b.totalHa ?? -1) - (a.totalHa ?? -1);
        if (areaDiff !== 0) return areaDiff;
      }
      const dateDiff = (b.latestDate ?? -Infinity) - (a.latestDate ?? -Infinity);
      if (Number.isFinite(dateDiff) && dateDiff !== 0) return dateDiff;
      if (b.count !== a.count) return b.count - a.count;
      return a.i - b.i;
    })
    .map((r) => ({ ...r.hit, totalHa: r.totalHa, latestDate: r.latestDate, rankedBy: anyArea ? 'area' : 'count' }));
}

// The strongest candidate, or null.
export function bestJurisdictionHit(hits) {
  return rankJurisdictionHits(hits)[0] || null;
}

// Attribution for an auto-adopted jurisdiction switch. This text follows the
// claims into the editor and out through an export, so a reader can never
// mistake "Nevada, because we found nothing in BC" for "Nevada, as requested".
export function autoAdoptionNotice(adoptedLabel, requestedLabel, query) {
  const who = query ? ` for ${query}` : ' for this company';
  return `Showing ${adoptedLabel} — no ${requestedLabel} claims found${who}`;
}
