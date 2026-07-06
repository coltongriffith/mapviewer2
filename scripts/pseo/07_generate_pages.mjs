#!/usr/bin/env node
// 07 — Generate the static /companies/ pages + hubs + sitemap-companies.xml.
//
//   node scripts/pseo/07_generate_pages.mjs                 # tickers in publish_batch.txt
//   node scripts/pseo/07_generate_pages.mjs --all           # every matched ticker
//   node scripts/pseo/07_generate_pages.mjs --fixture       # fixture run (noindex, no sitemap)
//
// Same static-HTML pattern as scripts/generate-blog.js — fully indexable pages
// on the main domain under /companies/, no framework. Rollout batching is the
// publish_batch.txt allowlist (never bulk-publish all 1,250 at once).

import fs from 'node:fs';
import path from 'node:path';
import { resolvePaths, SITE, SITE_NAME, PAGES } from './config.mjs';
import { readCsv, esc, fmtHa, centroidOf, haversineKm, todayIso, isExpired } from './lib.mjs';

const args = process.argv.slice(2);
const FIXTURE = args.includes('--fixture');
const ALL = args.includes('--all');
const PATHS = resolvePaths(FIXTURE);

const REGISTRY_BY_PROV = {
  BC: { name: 'BC Mineral Titles Online', url: 'https://www.mtonline.gov.bc.ca/' },
  ON: { name: 'Ontario MLAS', url: 'https://www.mlas.mndm.gov.on.ca/' },
};
const PROV_NAME = { BC: 'British Columbia', ON: 'Ontario' };

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;color:#18212e;background:#fafbfd;line-height:1.6}
a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}
.nav{display:flex;align-items:center;justify-content:space-between;padding:0 24px;height:58px;border-bottom:1px solid #e4e9f1;background:#fff;position:sticky;top:0;z-index:50}
.nav-brand{display:flex;align-items:center;gap:8px;font-weight:750;font-size:15px;color:#0f1b2d}
.nav-cta{background:#2563eb;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:650;white-space:nowrap}
.nav-cta:hover{background:#1d4ed8;text-decoration:none}
.wrap{max-width:960px;margin:0 auto;padding:36px 22px 70px}
.crumb{font-size:12.5px;color:#8b96a5;margin-bottom:16px}
.crumb a{color:#8b96a5}
h1{font-size:clamp(22px,3.4vw,32px);line-height:1.15;letter-spacing:-.02em;margin-bottom:10px}
.sub{color:#566274;font-size:15px;max-width:70ch;margin-bottom:8px}
.updated{font-size:12px;color:#8b96a5;margin-bottom:22px}
.map-card{background:#fff;border:1px solid #e4e9f1;border-radius:14px;overflow:hidden;box-shadow:0 10px 32px -14px rgba(15,27,45,.15);margin-bottom:14px}
.map-card img,.map-card object{display:block;width:100%;height:auto}
.map-actions{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 30px}
.btn{display:inline-flex;align-items:center;gap:7px;border-radius:9px;font-weight:640;font-size:13.5px;padding:9px 16px;border:1px solid transparent}
.btn-primary{background:#2563eb;color:#fff}.btn-primary:hover{background:#1d4ed8;text-decoration:none}
.btn-ghost{background:#fff;color:#18212e;border-color:#d4dce7}.btn-ghost:hover{border-color:#aebccf;text-decoration:none}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0 0 30px}
.stat{background:#fff;border:1px solid #e4e9f1;border-radius:11px;padding:14px 16px}
.stat b{display:block;font-size:21px;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.stat span{font-size:12px;color:#8b96a5}
h2{font-size:18px;letter-spacing:-.01em;margin:34px 0 12px}
table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e4e9f1;border-radius:10px;overflow:hidden}
th{background:#f3f6fa;text-align:left;padding:9px 12px;font-weight:650;color:#45566a;border-bottom:1px solid #e4e9f1}
td{padding:8px 12px;border-bottom:1px solid #eef2f7;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:none}
.tbl-wrap{overflow-x:auto;border-radius:10px}
.claim-cta{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;background:linear-gradient(135deg,#eff6ff,#e0e7ff);border:1px solid #c7d7fe;border-radius:12px;padding:16px 20px;margin:30px 0}
.claim-cta b{font-size:15px}
.claim-cta span{display:block;font-size:13px;color:#566274}
.neigh{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.neigh a{background:#fff;border:1px solid #e4e9f1;border-radius:11px;padding:13px 15px;display:block}
.neigh a:hover{border-color:#2563eb;text-decoration:none}
.neigh b{display:block;font-size:13.5px;color:#0f1b2d}
.neigh span{font-size:12px;color:#8b96a5}
.disclaimer{background:#fffbeb;border-left:4px solid #d97706;border-radius:0 10px 10px 0;padding:13px 16px;font-size:13px;color:#57534e;line-height:1.65;margin:34px 0}
.footer{border-top:1px solid #e4e9f1;padding:26px 22px;text-align:center;font-size:12.5px;color:#8b96a5;background:#fff}
.footer a{color:#566274}
.hub-list{columns:3;column-gap:26px;font-size:14px}
.hub-list li{margin-bottom:7px;break-inside:avoid;list-style:none}
@media(max-width:700px){.hub-list{columns:1}}
`;

function shell({ title, description, canonical, ogImage, schema, body, noindex }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex,follow">' : ''}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:image" content="${esc(ogImage || `${SITE}/og-image.png`)}">
<meta name="twitter:card" content="summary_large_image">
${schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ''}
<style>${CSS}</style>
</head>
<body>
<nav class="nav">
  <a class="nav-brand" href="/">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#2563eb"/></svg>
    ${esc(SITE_NAME)}
  </a>
  <a class="nav-cta" href="/">Start Mapping</a>
</nav>
${body}
<footer class="footer">
  <p><a href="/">Home</a> · <a href="/companies/">Companies</a> · <a href="/blog/">Guides</a> · <a href="/about/">About</a> · <a href="/privacy/">Privacy</a></p>
  <p style="margin-top:6px">© ${new Date().getFullYear()} ${esc(SITE_NAME)}</p>
</footer>
</body>
</html>`;
}

function companyPage({ iss, claims, geo, neighbours, updated }) {
  const provs = [...new Set(claims.map((c) => c.province))];
  const provNames = provs.map((p) => PROV_NAME[p] || p).join(' and ');
  // Some registries (Ontario MLAS) don't publish a claim area and the polygon
  // can be missing, so an area of 0 means "unknown", not a zero-hectare claim.
  // Sum only known areas, and phrase the total so unknowns aren't misrepresented.
  const hasArea = (c) => Number(c.area_ha) > 0;
  const knownArea = claims.filter(hasArea);
  const totalHa = knownArea.reduce((a, c) => a + Number(c.area_ha), 0);
  const allAreasKnown = knownArea.length === claims.length;
  // Prose fragment: "" when no areas known, " totalling X ha" when all known,
  // " spanning over X ha" when only some are.
  const haPhrase = knownArea.length === 0 ? ''
    : allAreasKnown ? ` totalling ${fmtHa(totalHa)} ha`
    : ` spanning over ${fmtHa(totalHa)} ha`;
  // Same fragment with the hectares figure bolded, for the on-page headline.
  const haPhraseHtml = knownArea.length === 0 ? ''
    : allAreasKnown ? ` totalling <strong>${fmtHa(totalHa)} ha</strong>`
    : ` spanning over <strong>${fmtHa(totalHa)} ha</strong>`;
  const totalHaStat = knownArea.length === 0 ? '—'
    : allAreasKnown ? fmtHa(totalHa) : `${fmtHa(totalHa)}+`;
  const registries = provs.map((p) => REGISTRY_BY_PROV[p]).filter(Boolean);
  const url = `${SITE}/companies/${iss.ticker.toLowerCase()}/`;
  const mapSvg = `/companies-assets/${iss.ticker}.svg`;
  // OG-image rendering (06 --skip-og) is optional — fall back to the site
  // default so pages never link a 404'd image when Playwright isn't set up.
  const ogPngPath = path.join(PATHS.assetsOut, `${iss.ticker}-og.png`);
  const ogPng = fs.existsSync(ogPngPath) ? `${SITE}/companies-assets/${iss.ticker}-og.png` : `${SITE}/og-image.png`;
  const title = `${iss.company} (${iss.exchange}: ${iss.ticker}) — Mineral Claims Map`;
  const description = `${iss.company} holds ${claims.length} mineral claims${haPhrase} in ${provNames}. Interactive claims map, claim list, and expiry dates from public registry data.`;

  const exportCopy = PAGES.showPricing ? PAGES.pricedExportCopy : PAGES.freeExportCopy;
  const claimRows = claims.slice(0, PAGES.claimsTableMax).map((c) => `
      <tr><td>${esc(c.claim_id)}</td><td>${esc(c.claim_name || '—')}</td><td>${hasArea(c) ? fmtHa(c.area_ha) : '—'}</td><td>${esc(c.good_to_date || '—')}</td><td>${esc(c.province)}</td></tr>`).join('');

  const neighHtml = neighbours.length ? `
  <h2>Neighbouring claim holders</h2>
  <div class="neigh">
    ${neighbours.map((n) => `<a href="/companies/${n.ticker.toLowerCase()}/"><b>${esc(n.company)}</b><span>${esc(n.exchange)}: ${esc(n.ticker)} · ~${Math.round(n.km)} km away</span></a>`).join('\n    ')}
  </div>` : '';

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: iss.company, tickerSymbol: `${iss.exchange}:${iss.ticker}`, url },
      {
        '@type': 'Dataset',
        name: `${iss.company} mineral claims`,
        description,
        url,
        creator: { '@type': 'Organization', name: SITE_NAME, url: SITE },
        dateModified: updated,
        license: registries[0]?.url,
        spatialCoverage: provNames,
      },
    ],
  };

  const body = `
<div class="wrap">
  <p class="crumb"><a href="/">Home</a> › <a href="/companies/">Companies</a> › ${esc(iss.ticker)}</p>
  <h1>${esc(iss.company)} (${esc(iss.exchange)}: ${esc(iss.ticker)}) — Mineral Claims Map</h1>
  <p class="sub">${esc(iss.company)} holds <strong>${claims.length} mineral claims</strong>${haPhraseHtml} in ${esc(provNames)}. Data from ${registries.map((r) => `<a href="${r.url}" rel="nofollow noopener">${esc(r.name)}</a>`).join(' and ')} public records.</p>
  <p class="updated">Claims updated ${esc(updated)}</p>

  <div class="map-card"><img src="${mapSvg}" alt="Map of ${esc(iss.company)} mineral claims" loading="eager"></div>
  <div class="map-actions">
    <a class="btn btn-primary" href="/?claims=${encodeURIComponent(iss.ticker)}&amp;company=${encodeURIComponent(iss.company)}&amp;utm_source=companies&amp;utm_campaign=${encodeURIComponent(iss.ticker)}">Open interactive version →</a>
    <a class="btn btn-ghost" href="/?claims=${encodeURIComponent(iss.ticker)}&amp;company=${encodeURIComponent(iss.company)}&amp;utm_source=companies&amp;utm_campaign=${encodeURIComponent(iss.ticker)}-export">${esc(exportCopy)}</a>
  </div>

  <div class="stats">
    <div class="stat"><b>${claims.length}</b><span>Mineral claims</span></div>
    <div class="stat"><b>${totalHaStat}</b><span>Total hectares${allAreasKnown ? '' : ' (known)'}</span></div>
    <div class="stat"><b>${provs.join(', ')}</b><span>Province${provs.length > 1 ? 's' : ''}</span></div>
    <div class="stat"><b>${esc(nextExpiry(claims))}</b><span>Earliest good-to date</span></div>
  </div>

  <div class="claim-cta">
    <div><b>Is this your company?</b><span>Claim this page to correct details and get an editable, branded version of this map.</span></div>
    <a class="btn btn-primary" href="mailto:${PAGES.correctionEmail}?subject=${encodeURIComponent(`Claim page: ${iss.ticker}`)}">Claim this page</a>
  </div>

  <h2>Claim list</h2>
  <div class="tbl-wrap">
  <table>
    <thead><tr><th>Claim ID</th><th>Name</th><th>Area (ha)</th><th>Good-to date</th><th>Province</th></tr></thead>
    <tbody>${claimRows}
    </tbody>
  </table>
  </div>
  ${claims.length > PAGES.claimsTableMax ? `<p class="updated">Showing first ${PAGES.claimsTableMax} of ${claims.length} claims — open the interactive version for the full list.</p>` : ''}

  ${neighHtml}

  <div class="disclaimer">
    Sourced from ${registries.map((r) => esc(r.name)).join(' and ')} public records on ${esc(updated)}. ${esc(SITE_NAME)} is a mapping tool, not the official registry — claim status changes daily. Always verify current ownership, status, and boundaries with the registry.
    <a href="mailto:${PAGES.correctionEmail}?subject=${encodeURIComponent(`Data correction: ${iss.ticker}`)}">Report an error</a>.
  </div>
</div>`;

  return shell({ title, description, canonical: url, ogImage: ogPng, schema, body, noindex: FIXTURE });
}

function hubPage({ slug, title, description, entries }) {
  const url = `${SITE}/companies/${slug ? slug + '/' : ''}`;
  const list = entries.map((e) => `<li><a href="/companies/${e.ticker.toLowerCase()}/">${esc(e.company)}</a> <span style="color:#8b96a5;font-size:12px">(${esc(e.exchange)}: ${esc(e.ticker)})</span></li>`).join('\n    ');
  const body = `
<div class="wrap">
  <p class="crumb"><a href="/">Home</a> › <a href="/companies/">Companies</a>${slug ? ` › ${esc(title)}` : ''}</p>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(description)}</p>
  <p class="sub" style="font-size:13px">Jump to: <a href="/companies/bc/">British Columbia</a> · <a href="/companies/ontario/">Ontario</a> · <a href="/companies/tsxv/">TSXV</a> · <a href="/companies/cse/">CSE</a></p>
  <ul class="hub-list" style="margin-top:20px">
    ${list}
  </ul>
</div>`;
  return shell({ title: `${title} | ${SITE_NAME}`, description, canonical: url, body, noindex: FIXTURE });
}

function nextExpiry(claims) {
  const dates = claims.map((c) => c.good_to_date).filter(Boolean).sort();
  return dates[0] || '—';
}

function main() {
  const issuers = readCsv(PATHS.issuers);
  const matches = readCsv(PATHS.matches);
  const claimsAll = [PATHS.claimsBc, PATHS.claimsOn].filter((f) => fs.existsSync(f)).flatMap((f) => readCsv(f));
  const issuerByTicker = new Map(issuers.map((i) => [i.ticker, i]));
  const updated = todayIso();

  // Publish allowlist (rollout batching). --all / --fixture bypasses.
  let allow = null;
  if (!ALL && !FIXTURE) {
    if (!fs.existsSync(PAGES.batchFile)) {
      throw new Error(`No publish batch file at ${PAGES.batchFile}.\nCreate it (one ticker per line) or run with --all / --fixture.`);
    }
    // Accept Yahoo/TMX-suffixed forms ("GOT.V", "SGD.TO") — matches.csv uses bare tickers.
    const normTicker = (t) => t.toUpperCase().replace(/\.(V|TO|CN|C|NE|VN)$/, '');
    allow = new Set(fs.readFileSync(PAGES.batchFile, 'utf8').split('\n').map((l) => normTicker(l.split('#')[0].trim())).filter(Boolean));
  }

  // Group matched owners per ticker
  const ownersByTicker = new Map();
  for (const m of matches) {
    if (allow && !allow.has(m.ticker.toUpperCase())) continue;
    if (!ownersByTicker.has(m.ticker)) ownersByTicker.set(m.ticker, new Set());
    ownersByTicker.get(m.ticker).add(m.owner_raw);
  }
  // Matched tickers but ZERO claims rows loaded means the (gitignored)
  // claims_bc/claims_on CSVs are missing or empty — a fresh checkout or a
  // standalone 07 run, not a world where every claim vanished. Wiping the
  // tracked pages from that state would be destructive; refuse. (A real
  // all-expired refresh still passes: a full 02/03 pull yields thousands of
  // other owners' rows, so claimsAll is never empty when inputs are intact.)
  if (ownersByTicker.size && !claimsAll.length) {
    throw new Error(`${ownersByTicker.size} matched ticker(s) but no claims data loaded — run 02/03 first (claims CSVs are gitignored); refusing to wipe existing pages.`);
  }

  // Per-ticker live (non-expired) claims — the SAME filter the publish loop
  // applies. The isExpired guard is belt-and-braces (02/03 filter at fetch),
  // and computing it up front means the geometry check below doesn't count a
  // ticker whose claims all expired (nothing for 05 to cache) as publishable.
  const liveClaimsByTicker = new Map([...ownersByTicker].map(([ticker, owners]) => [
    ticker,
    claimsAll.filter((c) => owners.has(c.owner_raw) && !isExpired(c.good_to_date)),
  ]));
  const publishable = [...ownersByTicker.keys()]
    .filter((t) => issuerByTicker.get(t) && liveClaimsByTicker.get(t).length);

  // Zero publishable tickers is a valid outcome, not an error — the wipe and
  // asset prune below must still run so that dropping the LAST live ticker
  // (or its claims all expiring) deletes its page instead of leaving it
  // deployed indefinitely.
  if (!publishable.length) console.warn('  ! no tickers to publish — removing all company pages');

  // …but a publishable ticker without cached geometry means 05 failed for it
  // (registry outage / owner-name drift), not that it dropped out. Wiping
  // would delete its existing page and the publish loop would just skip it —
  // so require geometry for EVERY publishable ticker, not merely one. Escape
  // hatch for a genuinely dead ticker: remove it from publish_batch.txt.
  const missingGeo = publishable.filter((t) => !fs.existsSync(path.join(PATHS.geo, `${t}.geojson`)));
  if (missingGeo.length) {
    throw new Error(`no cached geometry for publishable ticker(s): ${missingGeo.join(', ')} — run 05/06 first; refusing to wipe existing pages.`);
  }

  // All guards passed. This script fully owns pagesOut: wipe and regenerate it
  // every run so a ticker that dropped out (claims all expired, removed from
  // the batch, match lost) has its old page deleted rather than left deploying
  // stale forever.
  fs.rmSync(PATHS.pagesOut, { recursive: true, force: true });
  fs.mkdirSync(PATHS.pagesOut, { recursive: true });

  // Centroids for neighbour computation (only tickers with cached geometry)
  const centroids = new Map();
  for (const ticker of ownersByTicker.keys()) {
    const gf = path.join(PATHS.geo, `${ticker}.geojson`);
    if (!fs.existsSync(gf)) continue;
    try { centroids.set(ticker, centroidOf(JSON.parse(fs.readFileSync(gf, 'utf8')))); } catch { /* skip */ }
  }

  const published = [];
  for (const [ticker, owners] of ownersByTicker) {
    const iss = issuerByTicker.get(ticker);
    if (!iss) { console.warn(`  ! ${ticker}: not in issuers.csv — skipped`); continue; }
    const liveClaims = liveClaimsByTicker.get(ticker);
    if (!liveClaims.length) { console.warn(`  ! ${ticker}: no live claims — skipped`); continue; }
    const gf = path.join(PATHS.geo, `${ticker}.geojson`);
    if (!fs.existsSync(gf)) { console.warn(`  ! ${ticker}: no map render — skipped (run 05+06)`); continue; }

    // Backfill missing areas (Ontario claims carry no hectares in the CSV) from
    // the geometry file, which computes area from the polygon in step 05.
    let geoAreaById = new Map();
    try {
      const gj = JSON.parse(fs.readFileSync(gf, 'utf8'));
      geoAreaById = new Map((gj.features || [])
        .map((f) => [String(f.properties?.claim_id ?? ''), Number(f.properties?.area_ha) || 0])
        .filter(([id, ha]) => id && ha > 0));
    } catch { /* fall back to CSV areas */ }
    const claims = liveClaims.map((c) => (
      Number(c.area_ha) > 0 ? c : { ...c, area_ha: geoAreaById.get(String(c.claim_id)) || c.area_ha }
    ));

    const me = centroids.get(ticker);
    const neighbours = me ? [...centroids.entries()]
      .filter(([t]) => t !== ticker)
      .map(([t, c]) => ({ ticker: t, km: haversineKm(me, c), ...issuerByTicker.get(t) }))
      .filter((n) => n.company)
      .sort((a, b) => a.km - b.km)
      .slice(0, PAGES.neighboursMax) : [];

    const html = companyPage({ iss, claims, geo: gf, neighbours, updated });
    const dir = path.join(PATHS.pagesOut, ticker.toLowerCase());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    // Deploy the claim geometry so the page's "Open interactive version" button
    // can deep-link into the editor (/?claims=TICKER fetches this file).
    fs.mkdirSync(PATHS.assetsOut, { recursive: true });
    fs.copyFileSync(gf, path.join(PATHS.assetsOut, `${ticker}.geojson`));
    published.push({ ...iss, provinces: [...new Set(claims.map((c) => c.province))] });
    console.log(`  ✓ /companies/${ticker.toLowerCase()}/ (${claims.length} claims)`);
  }

  // Hubs
  const hubs = [
    { slug: '', title: 'Mineral Claim Maps by Company', description: `Public mineral-claims map pages for ${published.length} TSXV and CSE mining companies, generated from provincial registry data.`, entries: published },
    { slug: 'bc', title: 'BC Mineral Claim Holders', description: 'TSXV and CSE companies holding mineral claims in British Columbia.', entries: published.filter((p) => p.provinces.includes('BC')) },
    { slug: 'ontario', title: 'Ontario Mining Claim Holders', description: 'TSXV and CSE companies holding mining claims in Ontario.', entries: published.filter((p) => p.provinces.includes('ON')) },
    { slug: 'tsxv', title: 'TSXV Mining Companies — Claim Maps', description: 'Claim maps for TSX Venture Exchange mining issuers.', entries: published.filter((p) => p.exchange === 'TSXV') },
    { slug: 'cse', title: 'CSE Mining Companies — Claim Maps', description: 'Claim maps for Canadian Securities Exchange mining issuers.', entries: published.filter((p) => p.exchange === 'CSE') },
  ];
  for (const hub of hubs) {
    const sorted = [...hub.entries].sort((a, b) => a.company.localeCompare(b.company));
    const dir = hub.slug ? path.join(PATHS.pagesOut, hub.slug) : PATHS.pagesOut;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), hubPage({ ...hub, entries: sorted }));
    console.log(`  ✓ hub /companies/${hub.slug ? hub.slug + '/' : ''} (${sorted.length})`);
  }

  // Prune map assets for tickers that didn't publish this run — an orphaned
  // /companies-assets/[TICKER].svg would otherwise keep deploying with no page.
  if (fs.existsSync(PATHS.assetsOut)) {
    const keep = new Set(published.map((p) => p.ticker));
    for (const f of fs.readdirSync(PATHS.assetsOut)) {
      const ticker = f.replace(/-og\.png$|\.svg$|\.png$|\.geojson$/, '');
      if (!keep.has(ticker)) {
        fs.rmSync(path.join(PATHS.assetsOut, f), { force: true });
        console.log(`  ✂ pruned orphaned asset ${f}`);
      }
    }
  }

  // Sitemap (skipped entirely in fixture mode — fixture pages are noindex)
  if (!FIXTURE) {
    const urls = [
      `${SITE}/companies/`,
      ...hubs.filter((h) => h.slug).map((h) => `${SITE}/companies/${h.slug}/`),
      ...published.map((p) => `${SITE}/companies/${p.ticker.toLowerCase()}/`),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${updated}</lastmod><changefreq>weekly</changefreq></url>`).join('\n')}\n</urlset>\n`;
    fs.writeFileSync(PATHS.sitemap, xml.replace('https://www.sitemaps.org', 'http://www.sitemaps.org'));
    console.log(`  ✓ ${PATHS.sitemap} (${urls.length} urls) — submit in Search Console alongside sitemap.xml`);
  } else {
    console.log('  fixture mode: pages are noindex, sitemap untouched');
  }

  console.log(`\n✓ ${published.length} company pages generated`);
}

try { main(); } catch (err) { console.error(`\n✗ 07_generate_pages failed:\n${err.message}`); process.exit(1); }
