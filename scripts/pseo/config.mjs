// Central config for the pSEO pipeline.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PATHS = {
  root: ROOT,
  data: path.join(ROOT, 'data', 'pseo'),
  geo: path.join(ROOT, 'data', 'pseo', 'geo'),
  fixtures: path.join(ROOT, 'data', 'pseo', 'fixtures'),
  issuers: path.join(ROOT, 'data', 'pseo', 'issuers.csv'),
  claimsBc: path.join(ROOT, 'data', 'pseo', 'claims_bc.csv'),
  claimsOn: path.join(ROOT, 'data', 'pseo', 'claims_on.csv'),
  aliases: path.join(ROOT, 'data', 'pseo', 'aliases.csv'),
  matches: path.join(ROOT, 'data', 'pseo', 'matches.csv'),
  reviewQueue: path.join(ROOT, 'data', 'pseo', 'review_queue.csv'),
  pagesOut: path.join(ROOT, 'public', 'companies'),
  assetsOut: path.join(ROOT, 'public', 'companies-assets'),
  sitemap: path.join(ROOT, 'public', 'sitemap-companies.xml'),
};

// Resolve the working path set for a run. `fixture=true` redirects every
// generated/output path (issuers/claims/matches/geo/pages/assets) into a
// sandboxed .fixture-demo folder, completely separate from the tracked
// production files (issuers.csv, matches.csv, public/companies/, …) — so
// `npm run pseo:fixture` can never leave fake-company data sitting in a path
// a careless `git add` would pick up. aliases.csv and publish_batch.txt are
// intentionally NOT overridden: fixture mode reads its own
// fixtures/aliases_fixture.csv directly (see 04_match_owners.mjs).
export function resolvePaths(fixture) {
  if (!fixture) return PATHS;
  const demoData = path.join(PATHS.data, '.fixture-demo');
  const demoPublic = path.join(ROOT, 'public', '.pseo-fixture-demo');
  return {
    ...PATHS,
    geo: path.join(demoData, 'geo'),
    issuers: path.join(demoData, 'issuers.csv'),
    claimsBc: path.join(demoData, 'claims_bc.csv'),
    claimsOn: path.join(demoData, 'claims_on.csv'),
    matches: path.join(demoData, 'matches.csv'),
    reviewQueue: path.join(demoData, 'review_queue.csv'),
    pagesOut: path.join(demoPublic, 'companies'),
    assetsOut: path.join(demoPublic, 'companies-assets'),
    sitemap: path.join(demoData, 'sitemap-companies.xml'),
  };
}

export const SITE = 'https://www.explorationmaps.com';
export const SITE_NAME = 'Exploration Maps';

// ── Data sources ─────────────────────────────────────────────────────────────

// TSXV "mining" issuer directory workbook (tsx.com → resource 101). If the URL
// moves, download by hand and run 01 with --xlsx <file> or --csv <file>.
export const TSXV_XLSX_URL = 'https://www.tsx.com/en/resource/101';

// CSE listed-securities export. Undocumented endpoint — expect churn. Fallback:
// export the CSV manually from thecse.com/listings and pass --cse-csv <file>.
export const CSE_CSV_URL = 'https://thecse.com/export/listings/csv';

// BC Mineral Titles WFS (same layer api/bc-claims.js queries live).
export const BC_WFS = {
  base: 'https://openmaps.gov.bc.ca/geo/pub/wfs',
  typeName: 'pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW',
  pageSize: 2000,
  // Field names confirmed via --discover; update there if the schema shifts.
  fields: {
    owner: 'OWNER_NAME',
    tenureId: 'TENURE_NUMBER_ID',
    claimName: 'CLAIM_NAME',
    areaHa: 'AREA_IN_HECTARES',
    goodTo: 'GOOD_TO_DATE',
    type: 'TENURE_TYPE_DESCRIPTION',
  },
};

// Ontario MLAS operational service (same service api/claims.js queries live).
export const ON_ARCGIS = {
  service: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/MLAS/mlas_op/MapServer',
  // Layer index confirmed via --discover (the active-claims polygon layer).
  layer: null, // null → 03 requires --discover first, then pass --layer N
  pageSize: 1000,
  ownerFields: ['HOLDER', 'CLAIM_HOLDER', 'RECORDED_HOLDER', 'HOLDER_NAME', 'OWNER_NAME', 'OWNER', 'CLIENT_NAME'],
  numberFields: ['TENURE_NUMBER_ID', 'CLAIM_NUMBER', 'CLAIMNUM', 'CLAIM_NUM', 'TENURE_NUMBER', 'CLAIM_ID', 'CELL_CLAIM_NUMBER'],
};

// ── Matching thresholds ──────────────────────────────────────────────────────

export const MATCH = {
  auto: 92,       // ≥ auto-accept into matches.csv
  review: 80,     // review..auto-1 → review_queue.csv
};

// ── Page-generation knobs ────────────────────────────────────────────────────

export const PAGES = {
  // Rollout batching: only tickers in this list-file get generated + sitemapped.
  // One ticker per line; comments with '#'. Batch 1 = outreach targets.
  batchFile: path.join(ROOT, 'data', 'pseo', 'publish_batch.txt'),
  neighboursMax: 6,
  claimsTableMax: 400,   // safety cap per page
  correctionEmail: 'hello@explorationmaps.com',
  // Conversion copy. Prices stay off until billing exists in the product —
  // flip showPricing when the C$179 / C$149-mo SKUs are actually purchasable.
  showPricing: false,
  pricedExportCopy: 'Export an investor-ready version — C$179 single export or C$149/mo Pro.',
  freeExportCopy: 'Export an investor-ready version — free during early access.',
};
