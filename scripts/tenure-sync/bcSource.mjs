// DataBC WFS client for the B.C. mineral tenure layer.
//
//   Endpoint  https://openmaps.gov.bc.ca/geo/pub/wfs
//   Layer     pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW
//   Licence   Open Government Licence – British Columbia
//
// The same layer api/bc-claims.js and scripts/pseo/02_fetch_claims_bc.mjs
// already query, deliberately: one source of truth for "what B.C. tenure data
// does this product read", so a layer rename is one grep away from being
// fixed everywhere.
//
// PAGING CONTRACT
//   WFS 2.0 startIndex/count with an explicit stable sortBy. The sort is not
//   optional decoration: without a deterministic order the server is free to
//   return overlapping or gap-ridden pages, and the importer would then draw
//   confident conclusions ("these 400 tenures vanished") from an artefact of
//   pagination. Pages are also de-duplicated by source id for the same reason.
//
// STREAMING, NOT ACCUMULATING
//   Pages are handed to a callback rather than collected into one array. The
//   Quebec loader needed a 12 GB heap precisely because it built the whole
//   province in memory first; a province-wide tenure pull with geometry is the
//   same shape of problem, and a GitHub runner is not the place to discover it.

const WFS_BASE = process.env.BC_TENURE_WFS_BASE || 'https://openmaps.gov.bc.ca/geo/pub/wfs';
const LAYER = process.env.BC_TENURE_WFS_LAYER
  || 'pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW';

export const SOURCE_ID = 'bc-wfs-mta-acquired-tenure-svw';
export const PAGE_SIZE = Number(process.env.TENURE_SYNC_PAGE_SIZE) || 2000;
/** Runaway guard. ~1M records at the default page size. */
const MAX_PAGES = Number(process.env.TENURE_SYNC_MAX_PAGES) || 500;
const REQUEST_TIMEOUT_MS = Number(process.env.TENURE_SYNC_TIMEOUT_MS) || 120_000;
const MAX_ATTEMPTS = Number(process.env.TENURE_SYNC_MAX_ATTEMPTS) || 5;

// Matches the headers the existing proxies send. Some provincial WAFs reject
// unidentified clients outright.
const FETCH_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; ExplorationMaps/1.0; +https://explorationmaps.com)',
  Referer: 'https://explorationmaps.com/',
  Origin: 'https://explorationmaps.com',
};

export function wfsUrl(params) {
  const qs = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    outputFormat: 'application/json',
    typeNames: LAYER,
    SRSNAME: 'EPSG:4326',
    ...params,
  });
  return `${WFS_BASE}?${qs.toString()}`;
}

/**
 * Fetch JSON with exponential backoff.
 *
 * Retries transient conditions only — network faults, timeouts, 429 and 5xx.
 * A 400 means we asked the wrong question and retrying just asks it four more
 * times; that fails fast so the error reaches the operator with its real cause.
 */
export async function fetchJsonWithRetry(url, {
  attempts = MAX_ATTEMPTS,
  timeoutMs = REQUEST_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  log = console.log,
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.json();

      const retryable = res.status === 429 || res.status >= 500;
      const body = await res.text().catch(() => '');
      lastError = new Error(`BC WFS responded ${res.status}: ${body.slice(0, 300)}`);
      if (!retryable) throw lastError;
    } catch (e) {
      lastError = e;
      // A non-retryable HTTP status was rethrown above; surface it immediately.
      if (/responded 4\d\d/.test(String(e?.message)) && !/responded 429/.test(String(e?.message))) {
        throw e;
      }
    }
    if (attempt < attempts) {
      const backoff = Math.min(2 ** attempt * 1000, 30_000);
      log(`  [bc-source] attempt ${attempt}/${attempts} failed (${lastError?.message?.slice(0, 120)}); retrying in ${backoff}ms`);
      await sleepImpl(backoff);
    }
  }
  throw lastError || new Error('BC WFS request failed');
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Pull one sample feature so field names can be resolved before any bulk work.
 * Also the backbone of --discover.
 */
export async function fetchSampleFeature(opts = {}) {
  const data = await fetchJsonWithRetry(wfsUrl({ count: '1' }), opts);
  const feature = data?.features?.[0];
  if (!feature) {
    throw new Error(
      'The B.C. WFS layer returned no features. The layer name may have changed — '
      + `currently querying ${LAYER}.`,
    );
  }
  return feature;
}

/**
 * Page through the layer, handing each page to `onPage`.
 *
 * @param {object} opts
 * @param {(features: object[], meta: object) => Promise<void>} opts.onPage
 * @param {string} [opts.cqlFilter]  optional CQL_FILTER (targeted mode)
 * @param {string} opts.sortField    resolved stable sort field
 * @returns {Promise<{received: number, pages: number, truncated: boolean}>}
 */
export async function streamFeatures({
  onPage,
  cqlFilter = null,
  sortField,
  pageSize = PAGE_SIZE,
  maxPages = MAX_PAGES,
  log = console.log,
  ...fetchOpts
}) {
  if (!sortField) throw new Error('streamFeatures requires a stable sortField');

  const seen = new Set();
  let received = 0;
  let pages = 0;
  let truncated = false;

  for (let page = 0; page < maxPages; page += 1) {
    const startIndex = page * pageSize;
    const params = {
      count: String(pageSize),
      startIndex: String(startIndex),
      sortBy: sortField,
    };
    if (cqlFilter) params.CQL_FILTER = cqlFilter;

    let data;
    try {
      data = await fetchJsonWithRetry(wfsUrl(params), { log, ...fetchOpts });
    } catch (e) {
      if (pages === 0) throw e;   // first page failing is a hard failure
      // A later page failing leaves us holding an incomplete province. Keep
      // what we have, mark it truncated, and let the guardrails abort the run
      // — they will, because `truncated` is on the fatal list.
      truncated = true;
      log(`  [bc-source] page ${page} failed after ${received} records; marking run truncated`);
      break;
    }

    const features = Array.isArray(data?.features) ? data.features : [];
    pages += 1;

    // De-duplicate across pages. A server that silently ignores startIndex
    // would otherwise hand us page 0 forever, and the loop below would look
    // like steady progress.
    const fresh = [];
    for (const f of features) {
      const key = featureKey(f);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(f);
    }

    if (features.length > 0 && fresh.length === 0) {
      log('  [bc-source] page returned only records already seen — the service is ignoring startIndex; stopping.');
      truncated = true;
      break;
    }

    received += fresh.length;
    if (fresh.length) await onPage(fresh, { page, startIndex, received });

    log(`  [bc-source] page ${page}: ${features.length} received, ${fresh.length} new (running total ${received})`);

    // A short page is the natural end of the layer.
    if (features.length < pageSize) return { received, pages, truncated };

    if (page === maxPages - 1) {
      log(`  [bc-source] hit the ${maxPages}-page ceiling; marking run truncated`);
      truncated = true;
    }
  }

  return { received, pages, truncated };
}

function featureKey(f) {
  if (f?.id != null) return `id:${f.id}`;
  const p = f?.properties || {};
  for (const k of ['TENURE_NUMBER_ID', 'OBJECTID', 'TAG_NUMBER']) {
    if (p[k] != null) return `${k}:${p[k]}`;
  }
  try {
    return `j:${JSON.stringify(p).slice(0, 200)}`;
  } catch {
    return `r:${Math.random()}`;
  }
}

/**
 * CQL filter selecting a specific set of tenure numbers, for targeted runs.
 * Values are quote-escaped; the caller is expected to pass registry numbers,
 * and anything else simply matches nothing.
 */
export function tenureNumberFilter(field, tenureNumbers) {
  const values = [...new Set(tenureNumbers.map((n) => String(n).trim()).filter(Boolean))];
  if (!values.length) return null;
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
  return `${field} IN (${list})`;
}

export const SOURCE_METADATA = {
  id: SOURCE_ID,
  base: WFS_BASE,
  layer: LAYER,
  licence: 'Open Government Licence – British Columbia',
  attribution: 'Contains information licensed under the Open Government Licence – British Columbia.',
};
