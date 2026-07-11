// Shared pagination helpers for the claims proxies.
//
// Every provider used to hard-truncate (500 attribute / 2000 bbox records)
// with no signal to the user. These helpers fetch ALL pages up to a hard
// safety ceiling and report honest metadata:
//   { totalKnown, returned, truncated, pagesFetched, provider }
// totalKnown is null when the provider never disclosed a total AND we
// couldn't prove completeness. `truncated` is only true when results are
// genuinely incomplete (ceiling hit, provider limit hit, or a later page
// failed after partial results) — never merely because a page was full.

export const MAX_TOTAL_FEATURES = 10000; // hard safety ceiling per request
export const MAX_PAGES = 30;             // runaway-loop backstop

/** Stable feature key for cross-page dedup. */
export function featureKey(f, idField) {
  if (f?.id != null) return `id:${f.id}`;
  const p = f?.properties || {};
  if (idField && p[idField] != null) return `f:${p[idField]}`;
  for (const k of ['OBJECTID', 'objectid', 'FID', 'TAG_NUMBER']) {
    if (p[k] != null) return `${k}:${p[k]}`;
  }
  // Last resort: hash-ish key from properties + a slice of geometry.
  try {
    return `j:${JSON.stringify(p)}|${JSON.stringify(f?.geometry ?? null).slice(0, 120)}`;
  } catch {
    return `r:${Math.random()}`;
  }
}

/**
 * Generic offset-based pagination.
 * fetchPage(offset, count) → { features, totalKnown?, pageLimitHit? }
 * Stops when: a short page arrives, nothing new is added (server ignoring
 * offset), the ceiling/max-pages is reached, or a later page fails (partial
 * results are kept and marked truncated). A FIRST-page failure throws.
 */
export async function fetchAllPages({ fetchPage, pageSize, provider, idField = null, maxTotal = MAX_TOTAL_FEATURES, maxPages = MAX_PAGES }) {
  const out = [];
  const seen = new Set();
  let pagesFetched = 0;
  let truncated = false;
  let totalKnown = null;
  let sawFullLastPage = false;

  for (let page = 0; page < maxPages; page++) {
    let result;
    try {
      result = await fetchPage(page * pageSize, pageSize);
    } catch (e) {
      if (pagesFetched === 0) throw e;
      truncated = true; // partial data: a later page failed
      break;
    }
    pagesFetched += 1;
    const feats = Array.isArray(result?.features) ? result.features : [];
    if (result?.totalKnown != null && Number.isFinite(Number(result.totalKnown))) {
      totalKnown = Number(result.totalKnown);
    }
    let added = 0;
    for (const f of feats) {
      const key = featureKey(f, idField);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
      added += 1;
      if (out.length >= maxTotal) break;
    }
    if (out.length >= maxTotal) {
      // Ceiling: truncated only if there was plausibly more.
      truncated = feats.length >= pageSize || (totalKnown != null && totalKnown > out.length);
      break;
    }
    sawFullLastPage = feats.length >= pageSize;
    if (feats.length < pageSize) break;          // short page → complete
    if (added === 0) {                            // server ignored the offset
      truncated = result?.pageLimitHit ?? true;
      break;
    }
    if (totalKnown != null && out.length >= totalKnown) break; // proven complete
  }

  if (!truncated && pagesFetched >= maxPages && sawFullLastPage) truncated = true;
  if (totalKnown != null && out.length < totalKnown) truncated = true;
  if (totalKnown == null && !truncated) totalKnown = out.length;

  return {
    features: out,
    meta: { totalKnown, returned: out.length, truncated, pagesFetched, provider },
  };
}

/**
 * WFS 2.0 pagination (GeoServer): startIndex + count. GeoServer's GeoJSON
 * output carries totalFeatures/numberMatched, which we surface as totalKnown.
 */
export async function fetchWfsAll({ fetchJson, buildUrl, pageSize = 1000, provider = 'wfs', maxTotal, maxPages }) {
  return fetchAllPages({
    provider,
    pageSize,
    maxTotal,
    maxPages,
    fetchPage: async (offset, count) => {
      const data = await fetchJson(buildUrl(offset, count));
      const total = data?.totalFeatures ?? data?.numberMatched;
      return { features: data?.features || [], totalKnown: Number.isFinite(Number(total)) ? Number(total) : undefined };
    },
  });
}
