#!/usr/bin/env node
/**
 * Blog generator for explorationmaps.com
 * Run: node scripts/generate-blog.js
 * Outputs static HTML to public/blog/[slug]/index.html
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'public', 'blog');
const SITE = 'https://www.explorationmaps.com';
const SITE_NAME = 'Exploration Maps';
const OG_IMAGE = `${SITE}/og-image.png`;
const TODAY = new Date().toISOString().split('T')[0];

// ─── Load data ────────────────────────────────────────────────────────────────

const howToPosts    = JSON.parse(readFileSync(join(__dirname, 'blog-data', 'how-to-posts.json'), 'utf8'));
const compPosts     = JSON.parse(readFileSync(join(__dirname, 'blog-data', 'comparison-posts.json'), 'utf8'));
const locations     = JSON.parse(readFileSync(join(__dirname, 'blog-data', 'locations.json'), 'utf8'));
const mapTypes      = JSON.parse(readFileSync(join(__dirname, 'blog-data', 'map-types.json'), 'utf8'));
const seoPages      = JSON.parse(readFileSync(join(__dirname, 'blog-data', 'seo-pages.json'), 'utf8'));

// Region pages are only generated for map types with real regional search
// intent (mining claims, drill results). Types flagged regionPages:false keep
// their how-to guide but no 28-region template fan-out — those pages were thin
// and near-duplicate. Removed URLs 301 via vercel.json.
const REGION_MAP_TYPES = mapTypes.filter(t => t.regionPages !== false);

// Fully generated output — wipe so removed posts/pages actually disappear.
rmSync(OUT, { recursive: true, force: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function writeFile(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function relatedLinks(slugs, allPosts) {
  return slugs
    .map(s => allPosts.find(p => p.slug === s))
    .filter(Boolean)
    .map(p => `<li><a href="/blog/${p.slug}/">${esc(p.title)}</a></li>`)
    .join('\n');
}

// ─── CSS (inline on every page, small and fast) ───────────────────────────────

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px;-webkit-text-size-adjust:100%}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;color:#1e293b;background:#fff;line-height:1.6}
a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}
img{max-width:100%;height:auto}
/* Nav */
.nav{display:flex;align-items:center;justify-content:space-between;padding:0 24px;height:56px;border-bottom:1px solid #e2e8f0;background:#fff;position:sticky;top:0;z-index:100}
.nav-brand{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:#0f172a;text-decoration:none}
.nav-brand svg{flex-shrink:0}
.nav-cta{background:#2563eb;color:#fff;padding:7px 16px;border-radius:8px;font-size:13px;font-weight:600;white-space:nowrap}
.nav-cta:hover{background:#1d4ed8;text-decoration:none}
/* Layout */
.page-wrap{max-width:1100px;margin:0 auto;padding:0 24px}
.blog-layout{display:grid;grid-template-columns:1fr 280px;gap:48px;padding:48px 0 80px;align-items:start}
@media(max-width:768px){.blog-layout{grid-template-columns:1fr;padding:32px 0 60px}}
/* Article */
article h1{font-size:2rem;font-weight:800;line-height:1.2;color:#0f172a;margin-bottom:16px}
@media(max-width:600px){article h1{font-size:1.5rem}}
.direct-answer{font-size:1.05rem;color:#334155;background:#f0f9ff;border-left:4px solid #2563eb;padding:14px 18px;border-radius:0 8px 8px 0;margin-bottom:32px;line-height:1.65}
.breadcrumb{font-size:13px;color:#64748b;margin-bottom:20px}
.breadcrumb a{color:#64748b}
.breadcrumb span{margin:0 6px}
article h2{font-size:1.35rem;font-weight:700;color:#0f172a;margin:40px 0 12px;padding-bottom:8px;border-bottom:2px solid #e8edf3}
article h2:first-of-type{margin-top:0}
article h3{font-size:1.05rem;font-weight:700;color:#1e293b;margin:28px 0 8px}
article p{margin-bottom:16px;color:#374151;line-height:1.75}
article ul,article ol{padding-left:22px;margin-bottom:16px}
article li{margin-bottom:6px;color:#374151;line-height:1.65}
article strong{color:#0f172a}
/* Steps */
.steps-list{list-style:none;padding:0;counter-reset:step}
.steps-list li{counter-increment:step;display:flex;gap:14px;margin-bottom:16px;align-items:flex-start}
.steps-list li::before{content:counter(step);display:flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;background:#2563eb;color:#fff;border-radius:50%;font-size:13px;font-weight:700;margin-top:2px}
/* Comparison table */
.comparison-table{width:100%;border-collapse:collapse;margin:20px 0;font-size:14px}
.comparison-table th{background:#1e3a5f;color:#fff;padding:10px 14px;text-align:left;font-weight:600}
.comparison-table td{padding:9px 14px;border-bottom:1px solid #e2e8f0;vertical-align:top}
.comparison-table tr:nth-child(even) td{background:#f8fafc}
.comparison-table tr:first-child td:first-child{font-weight:600}
/* FAQ */
.faq-section{margin:48px 0 0}
.faq-section h2{font-size:1.35rem;font-weight:700;color:#0f172a;margin-bottom:20px;padding-bottom:8px;border-bottom:2px solid #e8edf3}
.faq-item{border:1px solid #e2e8f0;border-radius:10px;margin-bottom:12px;overflow:hidden}
.faq-q{font-weight:700;color:#0f172a;padding:14px 18px;font-size:0.95rem;background:#f8fafc}
.faq-a{padding:12px 18px;color:#374151;font-size:0.9rem;line-height:1.7;border-top:1px solid #e2e8f0}
/* Sidebar */
.sidebar-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:24px}
.sidebar-card h3{font-size:14px;font-weight:700;color:#0f172a;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em}
.sidebar-card ul{list-style:none;padding:0}
.sidebar-card li{margin-bottom:8px;font-size:14px}
.sidebar-card a{color:#2563eb}
.cta-card{background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);border-radius:12px;padding:28px 24px;color:#fff;text-align:center;margin-bottom:24px}
.cta-card h3{font-size:1.1rem;font-weight:700;margin-bottom:10px;color:#fff}
.cta-card p{font-size:13px;color:#bfdbfe;margin-bottom:18px;line-height:1.6}
.cta-btn{display:inline-block;background:#fff;color:#1e3a5f;padding:10px 22px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none}
.cta-btn:hover{background:#dbeafe;text-decoration:none}
/* Blog index */
.blog-index-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px;padding:24px 0 40px}
.blog-card{border:1px solid #e2e8f0;border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:8px;transition:border-color .15s,box-shadow .15s}
.blog-card:hover{border-color:#2563eb;box-shadow:0 4px 16px rgba(37,99,235,0.1)}
.blog-card-tag{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#2563eb}
.blog-card h3{font-size:1rem;font-weight:700;color:#0f172a;line-height:1.35}
.blog-card p{font-size:13px;color:#64748b;line-height:1.6;flex:1}
.blog-card a{font-size:13px;font-weight:600;color:#2563eb}
/* Hero */
.page-hero{padding:48px 0 32px;border-bottom:1px solid #e8edf3;margin-bottom:0}
.page-hero-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#2563eb;margin-bottom:10px}
.page-hero h1{font-size:2.2rem;font-weight:800;color:#0f172a;max-width:720px;line-height:1.2;margin-bottom:12px}
@media(max-width:600px){.page-hero h1{font-size:1.6rem}}
.page-hero p{font-size:1.05rem;color:#475569;max-width:580px;line-height:1.65}
/* Index section headers */
.index-section-head{display:flex;align-items:baseline;justify-content:space-between;margin:40px 0 4px;padding-top:8px;border-top:2px solid #e8edf3}
.index-section-head h2{font-size:1.1rem;font-weight:700;color:#0f172a}
.index-section-head a{font-size:13px;color:#2563eb}
/* Index TOC */
.index-toc{display:flex;flex-wrap:wrap;gap:8px;padding:24px 0 8px;border-bottom:1px solid #e8edf3;margin-bottom:8px}
.index-toc a{font-size:13px;font-weight:600;color:#475569;background:#f1f5f9;padding:4px 12px;border-radius:999px;text-decoration:none}
.index-toc a:hover{background:#dbeafe;color:#1d4ed8}
/* Location table */
.location-table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0 32px}
.location-table th{background:#f1f5f9;text-align:left;padding:8px 12px;font-weight:700;color:#374151;border:1px solid #e2e8f0}
.location-table td{padding:7px 12px;border:1px solid #e2e8f0;color:#475569}
.location-table tr:nth-child(even) td{background:#f8fafc}
/* Category hub */
.hub-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;padding:24px 0 48px}
.hub-card{border:1px solid #e2e8f0;border-radius:10px;padding:20px;display:flex;flex-direction:column;gap:6px}
.hub-card h3{font-size:0.95rem;font-weight:700;color:#0f172a}
.hub-card p{font-size:13px;color:#64748b;line-height:1.55;flex:1}
.hub-card a{font-size:13px;font-weight:600;color:#2563eb}
/* Tip box */
.tip-box{background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0;color:#374151;line-height:1.7}
/* Data sources table */
.data-table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0 20px}
.data-table th{background:#f1f5f9;text-align:left;padding:8px 12px;font-weight:700;color:#374151;border:1px solid #e2e8f0}
.data-table td{padding:7px 12px;border:1px solid #e2e8f0;color:#475569;vertical-align:top}
.data-table tr:nth-child(even) td{background:#f8fafc}
/* Post date */
.post-date{color:#94a3b8;font-size:12px}
/* SEO landing page */
.lp-wrap{max-width:820px;margin:0 auto;padding:0 24px}
.lp article h2{font-size:1.45rem}
.lp-intro{font-size:1.15rem;color:#334155;line-height:1.7;margin:0 0 8px}
.lp-cta{background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);border-radius:14px;padding:32px 28px;color:#fff;text-align:center;margin:40px 0}
.lp-cta h2{color:#fff !important;border:none !important;margin:0 0 8px !important;padding:0 !important;font-size:1.3rem}
.lp-cta p{color:#bfdbfe;margin:0 0 18px;font-size:0.98rem}
.lp-cta a{display:inline-block;background:#fff;color:#1e3a5f;padding:12px 26px;border-radius:9px;font-weight:700;font-size:15px;text-decoration:none}
.lp-cta a:hover{background:#dbeafe;text-decoration:none}
.lp-related{border-top:2px solid #e8edf3;margin-top:48px;padding-top:24px}
.lp-related h2{font-size:1.2rem;border:none;padding:0}
.lp-related-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-top:8px}
.lp-related-card{border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;display:block;text-decoration:none}
.lp-related-card:hover{border-color:#2563eb;box-shadow:0 4px 14px rgba(37,99,235,0.1);text-decoration:none}
.lp-related-card strong{display:block;color:#0f172a;font-size:0.98rem;margin-bottom:4px}
.lp-related-card span{color:#64748b;font-size:13px;line-height:1.5}
.disclaimer-box{background:#fffbeb;border-left:4px solid #d97706;padding:14px 18px;border-radius:0 8px 8px 0;margin:24px 0;color:#374151;line-height:1.7;font-size:0.95rem}
/* Inline CTA band */
.inline-cta{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;background:linear-gradient(135deg,#eff6ff 0%,#e0e7ff 100%);border:1px solid #c7d7fe;border-radius:12px;padding:18px 22px;margin:28px 0}
.inline-cta-copy{display:flex;flex-direction:column;gap:2px}
.inline-cta-copy strong{font-size:1.02rem;color:#1e293b;font-weight:700}
.inline-cta-copy span{font-size:0.9rem;color:#475569}
.inline-cta-btn{display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:9px;font-weight:700;font-size:14px;white-space:nowrap;text-decoration:none}
.inline-cta-btn:hover{background:#1d4ed8;text-decoration:none}
/* Screenshot figure placeholder */
.blog-figure{margin:22px 0}
.blog-figure img{display:block;width:100%;border:1px solid #e2e8f0;border-radius:10px}
.screenshot-frame{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:180px;background:repeating-linear-gradient(45deg,#f8fafc,#f8fafc 12px,#f1f5f9 12px,#f1f5f9 24px);border:1.5px dashed #cbd5e1;border-radius:10px;color:#64748b;font-size:0.9rem;font-weight:600;text-align:center;padding:24px}
.screenshot-frame-icon{font-size:28px;color:#94a3b8;line-height:1}
.blog-figure figcaption{margin-top:8px;font-size:13px;color:#64748b;text-align:center;font-style:italic}
/* Checklist */
.checklist{list-style:none;padding:0;margin:16px 0}
.checklist li{position:relative;padding-left:30px;margin-bottom:10px;color:#374151;line-height:1.6}
.checklist li::before{content:'✓';position:absolute;left:0;top:0;display:flex;align-items:center;justify-content:center;width:20px;height:20px;background:#16a34a;color:#fff;border-radius:50%;font-size:12px;font-weight:700}
/* Source / verify / capability boxes */
.box-title{display:block;font-size:0.95rem;font-weight:700;margin-bottom:6px}
.source-box{background:#f1f5f9;border-left:4px solid #475569;padding:14px 18px;border-radius:0 8px 8px 0;margin:24px 0;color:#374151;line-height:1.7;font-size:0.92rem}
.source-box .box-title{color:#334155}
.verify-box{background:#fffbeb;border-left:4px solid #d97706;padding:14px 18px;border-radius:0 8px 8px 0;margin:24px 0;color:#374151;line-height:1.7;font-size:0.92rem}
.verify-box .box-title{color:#b45309}
.capability-box{background:#f0f9ff;border-left:4px solid #2563eb;padding:14px 18px;border-radius:0 8px 8px 0;margin:24px 0;color:#374151;line-height:1.7;font-size:0.92rem}
.capability-box .box-title{color:#1d4ed8}
.capability-box ul{padding-left:20px;margin:6px 0}
.note-box{background:#f8fafc;border-left:4px solid #94a3b8;padding:14px 18px;border-radius:0 8px 8px 0;margin:24px 0;color:#374151;line-height:1.7;font-size:0.92rem}
/* Footer */
.site-footer{border-top:1px solid #e2e8f0;padding:28px 24px;text-align:center;font-size:13px;color:#94a3b8;margin-top:40px}
.site-footer-links{margin-bottom:8px;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px}
.site-footer a{color:#64748b}
.site-footer-sep{color:#cbd5e1}
`;

// ─── Page shell ───────────────────────────────────────────────────────────────

function pageShell({ title, description, canonical, schema, body, noindex = false, fullTitle = null, ogType = 'article', ogImage = OG_IMAGE }) {
  // fullTitle overrides the default "<title> | SITE_NAME" pattern, used by
  // landing pages whose exact title tag is specified verbatim.
  const titleTag = fullTitle || `${title} | ${SITE_NAME}`;
  const ogTitle = fullTitle || title;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titleTag)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex,follow">' : ''}
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:image" content="${ogImage}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogImage}">
${schema ? `<script type="application/ld+json">${JSON.stringify(schema, null, 0)}</script>` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<nav class="nav">
  <a class="nav-brand" href="/">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#2563eb"/>
    </svg>
    ${esc(SITE_NAME)}
  </a>
  <a class="nav-cta" href="/">Open Editor →</a>
</nav>
${body}
<footer class="site-footer">
  <div class="site-footer-links">
    <a href="/mining-map-software/">Mining Map Software</a>
    <span class="site-footer-sep">·</span>
    <a href="/mining-exploration-map-software/">Exploration Map Software</a>
    <span class="site-footer-sep">·</span>
    <a href="/bc-mineral-claims-map/">BC Claims Map</a>
    <span class="site-footer-sep">·</span>
    <a href="/mining-claim-search-by-company-name/">Claim Search by Company</a>
    <span class="site-footer-sep">·</span>
    <a href="/shapefile-to-map/">Shapefile to Map</a>
    <span class="site-footer-sep">·</span>
    <a href="/drill-results-map/">Drill Results Map</a>
  </div>
  <div class="site-footer-links">
    <a href="/">Home</a>
    <span class="site-footer-sep">·</span>
    <a href="/about/">About</a>
    <span class="site-footer-sep">·</span>
    <a href="/blog/">Guides</a>
    <span class="site-footer-sep">·</span>
    <a href="/privacy/">Privacy</a>
  </div>
  <p>© ${new Date().getFullYear()} ${esc(SITE_NAME)}</p>
</footer>
</body>
</html>`;
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function sidebar({ relatedHtml = '', compareHtml = '', howToHtml = '', locationHtml = '', appHref = '/' } = {}) {
  const comparisons = compareHtml ? `<div class="sidebar-card"><h3>Compare Tools</h3><ul>${compareHtml}</ul></div>` : '';
  const howToGuide = howToHtml ? `<div class="sidebar-card"><h3>Step-by-Step Guide</h3><ul>${howToHtml}</ul></div>` : '';
  const relatedCard = relatedHtml ? `<div class="sidebar-card"><h3>Related Guides</h3><ul>${relatedHtml}</ul></div>` : '';
  const locationCard = locationHtml ? `<div class="sidebar-card"><h3>By Region</h3><ul>${locationHtml}</ul></div>` : '';
  return `<aside>
  <div class="cta-card">
    <h3>Create Your Map Now</h3>
    <p>No GIS experience needed. Import your data, choose a theme, and export in minutes.</p>
    <a class="cta-btn" href="${esc(appHref)}">Open Exploration Maps →</a>
  </div>
  ${howToGuide}
  ${relatedCard}
  ${comparisons}
  ${locationCard}
  <div class="sidebar-card">
    <h3>Map Types</h3>
    <ul>
      ${mapTypes.map(t => `<li><a href="/blog/${t.howToSlug || `how-to-create-${t.slug}`}/">${esc(t.name)} Guide</a></li>`).join('\n')}
    </ul>
  </div>
</aside>`;
}

// Fixed comparison sidebar links used on how-to and location pages
const COMP_LINKS = `
<li><a href="/blog/exploration-maps-vs-arcgis/">Exploration Maps vs ArcGIS</a></li>
<li><a href="/blog/exploration-maps-vs-qgis/">Exploration Maps vs QGIS</a></li>
<li><a href="/blog/best-mining-map-software-junior-exploration/">Best Mining Map Software</a></li>`;

// ─── FAQ block ────────────────────────────────────────────────────────────────

function faqBlock(faqs) {
  if (!faqs?.length) return '';
  return `<section class="faq-section" aria-label="Frequently Asked Questions">
  <h2>Frequently Asked Questions</h2>
  ${faqs.map(f => `<div class="faq-item">
    <div class="faq-q">${esc(f.q)}</div>
    <div class="faq-a">${esc(f.a)}</div>
  </div>`).join('\n')}
</section>`;
}

// ─── Inline CTA band (top / middle / bottom conversion prompts) ───────────────

// Renders a product-led call-to-action band. `text` is the headline (approved
// copy like "Search a claimholder and create a map."), `sub` an optional line,
// `href` the destination (defaults to the editor). `label` is the button text.
// Location slugs the app has a live claims registry for (RegistrySearch:
// BC, ON, QC, SK, MB, NL, YT). Only these get a region-scoped registry deep
// link; every other region opens the upload path instead of silently
// defaulting the registry search to BC.
const REGISTRY_REGION_SLUGS = new Set([
  'british-columbia', 'ontario', 'quebec', 'saskatchewan',
  'manitoba', 'newfoundland-labrador', 'yukon',
  // U.S. federal (BLM MLRS) states — deep links open the US registry search.
  // Keep in sync with REGION_TO_PROVINCE (App.jsx) + US_JURISDICTIONS (api).
  'nevada', 'arizona', 'utah', 'idaho', 'montana', 'wyoming',
  'colorado', 'new-mexico', 'california', 'oregon', 'washington',
]);

// Deep link into the app with intent/region so SEO visitors land in a
// purposeful editor (registry pre-selected, upload prompt, or demo) instead of
// a blank one. Consumed by the ?intent/?region/?demo effect in src/App.jsx.
function appLink({ intent = null, region = null, demo = null, campaign = '' } = {}) {
  const p = new URLSearchParams();
  if (demo) p.set('demo', demo);
  if (intent) p.set('intent', intent);
  if (region) p.set('region', region);
  p.set('utm_source', 'blog');
  p.set('utm_medium', 'cta');
  if (campaign) p.set('utm_campaign', campaign);
  return `/?${p.toString()}`;
}

function inlineCta({ text, sub = '', href = '/', label = 'Open Exploration Maps →' } = {}) {
  if (!text) return '';
  return `<div class="inline-cta">
  <div class="inline-cta-copy">
    <strong>${esc(text)}</strong>
    ${sub ? `<span>${esc(sub)}</span>` : ''}
  </div>
  <a class="inline-cta-btn" href="${esc(href)}">${esc(label)}</a>
</div>`;
}

// ─── Typed content blocks ─────────────────────────────────────────────────────

// A styled screenshot placeholder. No real asset is required — it shows the
// caption inside a framed "screenshot" box, so the page is useful now and a real
// PNG can be dropped in later (set `src` to a /blog-img path to swap it in).
// `eager: true` for above-the-fold hero images (the LCP candidate) — loads
// immediately at high fetch priority instead of the default lazy, which would
// defer the main visual's fetch. Inline screenshots keep the lazy default.
function figureBlock({ alt = '', caption = '', src = '', eager = false } = {}) {
  const label = caption || alt || 'App screenshot';
  const loadAttrs = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  const inner = src
    ? `<img src="${esc(src)}" alt="${esc(alt || caption)}" ${loadAttrs}>`
    : `<div class="screenshot-frame"><span class="screenshot-frame-icon">▦</span><span>${esc(label)}</span></div>`;
  return `<figure class="blog-figure">${inner}${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
}

function checklistBlock(items) {
  if (!items?.length) return '';
  return `<ul class="checklist">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

function tableBlock({ headers = [], rows = [] } = {}) {
  if (!headers.length && !rows.length) return '';
  const head = headers.length ? `<thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : '';
  const body = `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<table class="data-table">${head}${body}</table>`;
}

// Callout boxes. `kind` selects the style/semantics:
//   source     → public-registry data-source disclaimer
//   verify     → "verify with the official registry" warning
//   capability → what the app can / cannot verify
//   tip        → helpful tip   note → neutral note
// `html` is trusted (allows internal links); `title` is escaped.
function boxBlock({ kind = 'note', title = '', html = '' } = {}) {
  const cls = { source: 'source-box', verify: 'verify-box', capability: 'capability-box', tip: 'tip-box', note: 'note-box' }[kind] || 'note-box';
  const heading = title ? `<strong class="box-title">${esc(title)}</strong>` : '';
  return `<div class="${cls}">${heading}${html ? `<div>${html}</div>` : ''}</div>`;
}

// ─── Sections renderer ────────────────────────────────────────────────────────

// Each section may combine any of: h2, h3, body/html, items, checklist, table,
// image, cta, box. h2 is optional so a section can be a standalone CTA/figure/box
// with no heading. Existing posts (h2 + body/html + items) render unchanged.
function renderSections(sections) {
  return sections.map(s => {
    const h2 = s.h2 ? `<h2>${esc(s.h2)}</h2>` : '';
    const h3 = s.h3 ? `<h3>${esc(s.h3)}</h3>` : '';
    // s.body is plain text and gets escaped; s.html is raw (trusted,
    // author-controlled) and allows inline internal links. A section may use
    // either or both — when both are present, the escaped body renders first,
    // then the raw HTML paragraph.
    const bodyP = s.body ? `<p>${esc(s.body)}</p>` : '';
    const htmlP = s.html ? `<p>${s.html}</p>` : '';
    const body = `${bodyP}${htmlP}`;
    const items = s.items ? `<ul>${s.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
    const checklist = s.checklist ? checklistBlock(s.checklist) : '';
    const table = s.table ? tableBlock(s.table) : '';
    const image = s.image ? figureBlock(s.image) : '';
    const box = s.box ? boxBlock(s.box) : '';
    const cta = s.cta ? inlineCta(s.cta) : '';
    return `${h2}${h3}${body}${items}${checklist}${table}${image}${box}${cta}`;
  }).join('\n');
}

// ─── Article schema builder ───────────────────────────────────────────────────

function articleSchema(title, description, url, publishedDate) {
  return {
    '@type': 'Article',
    headline: title,
    description,
    url,
    datePublished: publishedDate || TODAY,
    dateModified: TODAY,
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE },
  };
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function faqSchema(faqs) {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['.direct-answer', '.faq-a'],
    },
  };
}

function breadcrumbSchema(title, url) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog/` },
      { '@type': 'ListItem', position: 3, name: title, item: url },
    ],
  };
}

// ─── How-to post page ─────────────────────────────────────────────────────────

function buildHowToPage(post, allPosts) {
  const url = `${SITE}/blog/${post.slug}/`;
  const related = relatedLinks(post.relatedSlugs || [], allPosts);

  // Location cross-links for posts that map to a specific map type — only for
  // types that still have region pages (pruned types would link to redirects).
  let locationHtml = '';
  if (post.mapTypeId && REGION_MAP_TYPES.some(t => t.slug === post.mapTypeId)) {
    const topLocations = ['british-columbia', 'nevada', 'ontario'];
    locationHtml = topLocations
      .map(locSlug => {
        const loc = locations.find(l => l.slug === locSlug);
        return loc ? `<li><a href="/blog/${post.mapTypeId}-${loc.slug}/">${loc.name}</a></li>` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      articleSchema(post.title, post.metaDescription, url, post.publishedDate),
      {
        '@type': 'HowTo',
        name: post.title,
        description: post.directAnswer,
        // Only textual sections become HowTo steps — image/cta/box-only sections
        // carry no instruction text and would otherwise emit empty steps.
        step: (post.sections || [])
          .map(s => ({ s, text: s.body || (s.items || []).join('. ') }))
          .filter(({ text }) => text)
          .map(({ s, text }, i) => ({
            '@type': 'HowToStep',
            position: i + 1,
            name: s.h2 || `Step ${i + 1}`,
            text,
          })),
      },
      ...(post.faqs?.length ? [faqSchema(post.faqs)] : []),
      breadcrumbSchema(post.title, url),
    ],
  };

  const pubDate = post.publishedDate ? `<span class="post-date">· <time datetime="${esc(post.publishedDate)}">${formatDate(post.publishedDate)}</time></span>` : '';

  // Product-led CTAs at the top (right after the direct answer) and bottom
  // (before the FAQs). Posts may override the copy via post.ctaTop/post.ctaBottom;
  // both default to approved language. Mid-page CTAs come from `cta` section
  // blocks, so every priority page gets top / middle / bottom prompts.
  // Deep-link CTAs: registry guides open the right province's search; drill/CSV
  // guides open the upload prompt; claims guides open registry search.
  const searchRegion = (post.slug.match(/search-([a-z-]+?)-(?:mining|mineral)-claims/) || [])[1] || null;
  const postApp = appLink({
    intent: post.mapTypeId === 'drill-results-map' ? 'drill-results'
      : (post.mapTypeId === 'mining-claims-map' || searchRegion) ? 'claims' : null,
    region: searchRegion,
    campaign: post.slug,
  });
  const topCta = inlineCta({ href: postApp, ...(post.ctaTop || { text: 'Turn public claim data into a clean map.', sub: 'No GIS experience needed — import, style, and export in minutes.' }) });
  const bottomCta = inlineCta({ href: postApp, ...(post.ctaBottom || { text: 'Import your file and export an investor-ready map.', sub: 'Open the editor and have a shareable map in minutes.' }) });

  const body = `
<div class="page-wrap">
  <div class="blog-layout">
    <article>
      <p class="breadcrumb"><a href="/">Home</a><span>›</span><a href="/blog/">Blog</a><span>›</span><a href="/blog/how-to/">How-to Guides</a><span>›</span>${esc(post.title)} ${pubDate}</p>
      <h1>${esc(post.title)}</h1>
      <p class="direct-answer">${esc(post.directAnswer)}</p>
      ${heroFigureForPost(post)}
      ${topCta}
      ${renderSections(post.sections || [])}
      ${bottomCta}
      ${faqBlock(post.faqs)}
    </article>
    ${sidebar({ relatedHtml: related, compareHtml: COMP_LINKS, locationHtml, appHref: postApp })}
  </div>
</div>`;

  return pageShell({ title: post.title, description: post.metaDescription, canonical: url, schema, body });
}

// ─── Comparison post page ─────────────────────────────────────────────────────

function buildCompPage(post, allPosts) {
  const url = `${SITE}/blog/${post.slug}/`;
  const related = relatedLinks(post.relatedSlugs || [], allPosts);

  // Top location pages for the comparison sidebar
  const topLocationHtml = ['mining-claims-map-british-columbia', 'drill-results-map-nevada', 'mining-claims-map-ontario']
    .map(s => {
      const [mtSlug, ...locParts] = s.split('-');
      const locSlug = locParts.join('-');
      // Rebuild properly from known slugs
      return null;
    })
    .filter(Boolean).join('');

  // Build location links properly
  const locLinksHtml = [
    { mt: 'mining-claims-map', loc: 'british-columbia', label: 'Mining Claims Map — BC' },
    { mt: 'drill-results-map', loc: 'nevada', label: 'Drill Results Map — Nevada' },
    { mt: 'mining-claims-map', loc: 'ontario', label: 'Mining Claims Map — Ontario' },
  ].map(({ mt, loc, label }) => `<li><a href="/blog/${mt}-${loc}/">${label}</a></li>`).join('\n');

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      articleSchema(post.title, post.metaDescription, url, post.publishedDate),
      ...(post.faqs?.length ? [faqSchema(post.faqs)] : []),
      breadcrumbSchema(post.title, url),
    ],
  };

  const tableHtml = post.comparisonTable ? `
<h2>Side-by-Side Comparison</h2>
<div style="overflow-x:auto">
<table class="comparison-table">
  <thead><tr>${post.comparisonTable.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${post.comparisonTable.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
</table>
</div>` : '';

  const compPubDate = post.publishedDate ? `<span class="post-date">· <time datetime="${esc(post.publishedDate)}">${formatDate(post.publishedDate)}</time></span>` : '';

  const body = `
<div class="page-wrap">
  <div class="blog-layout">
    <article>
      <p class="breadcrumb"><a href="/">Home</a><span>›</span><a href="/blog/">Blog</a><span>›</span><a href="/blog/comparisons/">Comparisons</a><span>›</span>${esc(post.title)} ${compPubDate}</p>
      <h1>${esc(post.title)}</h1>
      <p class="direct-answer">${esc(post.directAnswer)}</p>
      ${heroFigureForPost(post)}
      ${renderSections(post.sections || [])}
      ${tableHtml}
      ${faqBlock(post.faqs)}
    </article>
    ${sidebar({ relatedHtml: related, locationHtml: locLinksHtml, appHref: appLink({ demo: 'aurora_demo', campaign: post.slug }) })}
  </div>
</div>`;

  return pageShell({ title: post.title, description: post.metaDescription, canonical: url, schema, body });
}

// ─── Location × map-type page ─────────────────────────────────────────────────

// Real finished-map exports (public/gallery/) shown as the hero on each
// location page, keyed by map-type slug — so a "Drill Results Map — Alaska"
// page actually shows a drill results map instead of being a wall of text.
const HERO_BY_MAPTYPE = {
  'mining-claims-map': '/gallery/claims.png',
  'drill-results-map': '/gallery/drill-results.png',
  'location-map': '/gallery/regional.png',
  'target-generation-map': '/gallery/target.png',
  'infrastructure-map': '/gallery/infrastructure.png',
};
// A secondary in-workflow screenshot per map type (real product UI/output).
const INLINE_BY_MAPTYPE = {
  'mining-claims-map': { src: '/blog-img/map-claims.png', alt: 'Mineral claims styled on a map in Exploration Maps' },
  'drill-results-map': { src: '/blog-img/badge-editor.png', alt: 'Labelling a drillhole with its best intercept in Exploration Maps' },
  'location-map': { src: '/blog-img/title-block.png', alt: 'Branded title block on an exported map' },
  'target-generation-map': { src: '/blog-img/title-block.png', alt: 'Styled target areas with a branded title block' },
  'infrastructure-map': { src: '/blog-img/title-block.png', alt: 'Infrastructure map with a branded title block' },
};

// Hero figure for a how-to / comparison post that carries no image section of
// its own — uses the post's map-type export when known, else a polished
// finished-map default. Returns '' for posts that already embed screenshots,
// so the top-10 rewritten guides aren't double-imaged.
function heroFigureForPost(post) {
  const hasOwnImage = (post.sections || []).some(s => s.image || s.type === 'image');
  if (hasOwnImage) return '';
  const src = (post.mapTypeId && HERO_BY_MAPTYPE[post.mapTypeId]) || '/gallery/ba-after.png';
  return figureBlock({
    src,
    alt: 'Example mining map created in Exploration Maps',
    caption: 'A finished map exported from Exploration Maps — the kind of output this guide walks you to.',
    eager: true,
  });
}

function buildLocationPage(location, mapType) {
  const pageSlug = `${mapType.slug}-${location.slug}`;
  const url = `${SITE}/blog/${pageSlug}/`;
  const title = `${mapType.name} — ${location.name}`;
  const reportingStandard = location.reportingStandard || 'NI 43-101';

  const description = location.country === 'Canada'
    ? `Create a ${mapType.primaryKeyword} for ${location.name} — includes ${reportingStandard} compliance, step-by-step data import, and export guide. No GIS experience needed.`
    : `Professional ${mapType.primaryKeyword} for ${location.name} exploration projects. Import CSV or GeoJSON, style automatically, export presentation-ready PNG or PDF.`;

  const mineralList = location.minerals.slice(0, 4).join(', ');
  const depositList = location.famousDeposits.slice(0, 3).join(', ');
  const districtList = location.miningDistricts.slice(0, 3).join(', ');

  const contextLine = location.contextLine || `one of the most active junior mining jurisdictions`;
  const directAnswer = `${location.name} — ${contextLine} — is a prime target for junior exploration companies. Here's how to create a professional ${mapType.primaryKeyword} using Exploration Maps in 15–30 minutes.`;

  const steps = mapType.steps.map(step => `<li>${esc(step)}</li>`).join('');

  const faqs = [
    {
      q: `What file format do I need for ${location.name} mineral claims data?`,
      a: `${location.name} mineral claims boundaries are available from ${location.claimsPortal} and can typically be downloaded as Shapefiles or KML. Convert these to GeoJSON at mapshaper.org before importing into Exploration Maps.`,
    },
    {
      q: `Who regulates mineral claims in ${location.name}?`,
      a: `Mineral claims in ${location.name} are regulated by the ${location.regulatoryBody}. All tenure and claims data can be queried through ${location.claimsPortal}.`,
    },
    {
      q: `What minerals are typically mapped in ${location.name}?`,
      a: `${location.name} is known for its ${mineralList} deposits. Key producing and exploration-stage properties include ${depositList}. The main mining districts are ${districtList}.`,
    },
    {
      q: `Can I export a ${location.name} ${mapType.primaryKeyword} for a ${reportingStandard} report?`,
      a: `Yes. Exploration Maps exports PNG and PDF at 2–3× pixel ratio, suitable for inclusion in ${reportingStandard} technical reports as required figures. The export includes north arrow, scale bar, legend, and title block — all standard map elements required for ${reportingStandard} compliance.`,
    },
  ];

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      articleSchema(title, description, url, location.publishedDate),
      {
        '@type': 'HowTo',
        name: `How to Create a ${mapType.name} for ${location.name}`,
        description: directAnswer,
        step: mapType.steps.map((step, i) => ({
          '@type': 'HowToStep',
          position: i + 1,
          name: `Step ${i + 1}`,
          text: step,
        })),
      },
      faqSchema(faqs),
      breadcrumbSchema(title, url),
    ],
  };

  // Sidebar: same location, other map types
  const sameLocationLinks = REGION_MAP_TYPES
    .filter(t => t.id !== mapType.id)
    .slice(0, 4)
    .map(t => `<li><a href="/blog/${t.slug}-${location.slug}/">${esc(t.name)} — ${esc(location.name)}</a></li>`)
    .join('\n');

  // Sidebar: same map type, nearby locations (same country)
  const sameTypeLinks = locations
    .filter(l => l.slug !== location.slug && l.country === location.country)
    .slice(0, 4)
    .map(l => `<li><a href="/blog/${mapType.slug}-${l.slug}/">${esc(mapType.name)} — ${esc(l.name)}</a></li>`)
    .join('\n');

  const relatedHtml = sameLocationLinks + sameTypeLinks;

  // Sidebar: link back to parent how-to guide
  const howToHtml = mapType.howToSlug
    ? `<li><a href="/blog/${mapType.howToSlug}/">How to Make a ${esc(mapType.name)}</a></li>`
    : '';

  // Data sources section
  const dataSourcesHtml = location.dataSourceUrl ? `
      <h2>Getting Mining Data for ${esc(location.name)}</h2>
      <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr><th>Portal</th><th>Formats</th><th>Notes</th></tr></thead>
        <tbody><tr>
          <td><a href="${esc(location.dataSourceUrl)}" rel="nofollow noopener noreferrer" target="_blank">${esc(location.claimsPortal)}</a></td>
          <td>${esc(location.dataFormats || 'Shapefile, KML')}</td>
          <td>${esc(location.dataNote || 'Convert to WGS84 (EPSG:4326) before importing into Exploration Maps.')}</td>
        </tr></tbody>
      </table>
      </div>` : '';

  // Workflow tip
  const tipHtml = location.workflowTip
    ? `<p class="tip-box"><strong>Tip for ${esc(location.name)}:</strong> ${esc(location.workflowTip)}</p>`
    : '';

  const locPubDate = location.publishedDate ? `<span class="post-date">· <time datetime="${esc(location.publishedDate)}">${formatDate(location.publishedDate)}</time></span>` : '';

  const body = `
<div class="page-wrap">
  <div class="blog-layout">
    <article>
      <p class="breadcrumb"><a href="/">Home</a><span>›</span><a href="/blog/">Blog</a><span>›</span><a href="/blog/locations/">By Region</a><span>›</span>${esc(title)} ${locPubDate}</p>
      <h1>${esc(title)}</h1>
      <p class="direct-answer">${esc(directAnswer)}</p>
      ${HERO_BY_MAPTYPE[mapType.slug] ? figureBlock({
        src: HERO_BY_MAPTYPE[mapType.slug],
        alt: `Example ${mapType.name.toLowerCase()} created in Exploration Maps`,
        caption: `Example ${mapType.name.toLowerCase()} exported from Exploration Maps — style your ${location.name} data the same way.`,
        eager: true,
      }) : ''}

      <h2>About Mining in ${esc(location.name)}</h2>
      <p>${esc(location.description)}</p>
      <p><strong>Key minerals:</strong> ${esc(location.minerals.join(', '))}. <strong>Notable deposits:</strong> ${esc(location.famousDeposits.join(', '))}. <strong>Mining districts:</strong> ${esc(location.miningDistricts.join(', '))}.</p>
      <p>The ${esc(location.regulatoryBody)} administers mineral rights in ${esc(location.name)}. Claim data is accessible through ${esc(location.claimsPortal)}.</p>

      ${dataSourcesHtml}

      <h2>How to Create a ${esc(mapType.name)} for ${esc(location.name)}</h2>
      <p>For a full step-by-step guide to ${esc(mapType.name.toLowerCase())}s, see <a href="/blog/${esc(mapType.howToSlug)}/">How to Make a ${esc(mapType.name)}</a>.</p>
      <ol class="steps-list">${steps}</ol>
      ${INLINE_BY_MAPTYPE[mapType.slug] ? figureBlock({ ...INLINE_BY_MAPTYPE[mapType.slug], caption: `${INLINE_BY_MAPTYPE[mapType.slug].alt}.` }) : ''}
      ${tipHtml}

      <h2>Recommended Settings for ${esc(location.name)}</h2>
      <ul>
        <li><strong>Basemap:</strong> ${esc(mapType.recommendedBasemap)}</li>
        <li><strong>Design theme:</strong> ${esc(mapType.recommendedTheme)}</li>
        <li><strong>Export format:</strong> PNG at 2× for investor presentations, PDF (Letter or A4) for ${esc(reportingStandard)} reports</li>
        <li><strong>Coordinate system:</strong> Ensure source data is in WGS84 (EPSG:4326)</li>
      </ul>

      <h2>Common Use Cases in ${esc(location.name)}</h2>
      <ul>${mapType.useCases.map(u => `<li>${esc(u)}</li>`).join('')}</ul>

      ${faqBlock(faqs)}
    </article>
    ${sidebar({ relatedHtml, howToHtml, compareHtml: COMP_LINKS, appHref: appLink(
      mapType.slug === 'drill-results-map'
        ? { intent: 'drill-results', campaign: pageSlug }
        : REGISTRY_REGION_SLUGS.has(location.slug)
          ? { intent: 'claims', region: location.slug, campaign: pageSlug }
          : { intent: 'claims-upload', campaign: pageSlug }
    ) })}
  </div>
</div>`;

  return { pageSlug, html: pageShell({ title, description, canonical: url, schema, body }) };
}

// ─── Category hub pages ───────────────────────────────────────────────────────

function buildCategoryPage({ slug: pageSlug, title, description, label, body: contentBody }) {
  const url = `${SITE}/blog/${pageSlug}/`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url,
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE },
  };
  const body = `
<div class="page-wrap">
  <div class="page-hero">
    <p class="page-hero-label">${esc(label)}</p>
    <h1>${esc(title)}</h1>
    <p>${esc(description)}</p>
  </div>
  ${contentBody}
</div>`;
  return { slug: pageSlug, html: pageShell({ title, description, canonical: url, schema, body }) };
}

// ─── Blog index page ──────────────────────────────────────────────────────────

function buildBlogIndex(allUrls) {
  const url = `${SITE}/blog/`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Exploration Mapping Blog',
    description: 'Guides, tutorials, and resources for creating professional mining exploration maps.',
    url,
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE },
  };

  const howToCards = howToPosts.map(p => `
<div class="blog-card">
  <span class="blog-card-tag">How-to Guide</span>
  <h3>${esc(p.title)}</h3>
  <p>${esc(p.directAnswer.slice(0, 110))}…</p>
  <a href="/blog/${p.slug}/">Read guide →</a>
</div>`).join('\n');

  const compCards = compPosts.map(p => `
<div class="blog-card">
  <span class="blog-card-tag">Comparison</span>
  <h3>${esc(p.title)}</h3>
  <p>${esc(p.metaDescription.slice(0, 110))}…</p>
  <a href="/blog/${p.slug}/">Read comparison →</a>
</div>`).join('\n');

  // All location pages, grouped by map type with anchor IDs
  const locationSections = REGION_MAP_TYPES.map(mt => {
    const cards = locations.map(loc => `
<div class="blog-card">
  <span class="blog-card-tag">Location Guide</span>
  <h3>${esc(mt.name)} — ${esc(loc.name)}</h3>
  <p>Create a professional ${esc(mt.primaryKeyword)} for exploration projects in ${esc(loc.name)}.</p>
  <a href="/blog/${mt.slug}-${loc.slug}/">Read guide →</a>
</div>`).join('\n');
    return `<div class="index-section-head" id="${mt.slug}"><h2>${esc(mt.name)} (${locations.length} regions)</h2><a href="/blog/locations/">View all →</a></div>
<div class="blog-index-grid">${cards}</div>`;
  }).join('\n');

  const toc = `<nav class="index-toc" aria-label="Jump to section">
  <a href="#how-to">How-to Guides</a>
  <a href="#comparisons">Comparisons</a>
  ${REGION_MAP_TYPES.map(mt => `<a href="#${mt.slug}">${esc(mt.name)}</a>`).join('\n  ')}
</nav>`;

  const body = `
<div class="page-wrap">
  <div class="page-hero">
    <p class="page-hero-label">Resources</p>
    <h1>Exploration Mapping Guides</h1>
    <p>Step-by-step tutorials, software comparisons, and location-specific guides for creating professional mining exploration maps.</p>
  </div>
  ${toc}
  <div class="index-section-head" id="how-to"><h2>How-to Guides</h2><a href="/blog/how-to/">View all →</a></div>
  <div class="blog-index-grid">${howToCards}</div>
  <div class="index-section-head" id="comparisons"><h2>Software Comparisons</h2><a href="/blog/comparisons/">View all →</a></div>
  <div class="blog-index-grid">${compCards}</div>
  ${locationSections}
  <p style="text-align:center;color:#64748b;font-size:14px;padding-bottom:48px">${allUrls.length} guides published · <a href="/sitemap.xml">Sitemap</a></p>
</div>`;

  return pageShell({ title: 'Exploration Mapping Guides & Tutorials', description: 'Guides, tutorials, and comparisons for creating professional mining exploration maps — investor presentations, NI 43-101 figures, and news release maps.', canonical: url, schema, body });
}

// ─── SEO landing pages (top-level, e.g. /mining-map-software/) ─────────────────

function softwareAppSchema(name, description, url) {
  return {
    '@type': 'SoftwareApplication',
    name,
    description,
    url,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web browser',
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE },
  };
}

function buildSeoLandingPage(page, allLandingPages) {
  const url = `${SITE}/${page.slug}/`;

  const graph = [];
  if (page.softwareApp) {
    graph.push(softwareAppSchema(page.h1, page.metaDescription, url));
  }
  if (page.faqs?.length) graph.push(faqSchema(page.faqs));
  graph.push({
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: page.h1, item: url },
    ],
  });
  const schema = { '@context': 'https://schema.org', '@graph': graph };

  const disclaimerHtml = page.disclaimer
    ? `<p class="disclaimer-box"><strong>Verify with the official registry:</strong> ${esc(page.disclaimer)}</p>`
    : '';

  // Related internal links resolved against the other landing pages.
  const relatedCards = (page.related || [])
    .map(slug => allLandingPages.find(p => p.slug === slug))
    .filter(Boolean)
    .map(p => `<a class="lp-related-card" href="/${p.slug}/"><strong>${esc(p.h1)}</strong><span>${esc(p.metaDescription)}</span></a>`)
    .join('\n');
  const relatedHtml = relatedCards
    ? `<section class="lp-related"><h2>Related tools and guides</h2><div class="lp-related-grid">${relatedCards}</div></section>`
    : '';

  const body = `
<div class="lp-wrap lp">
  <div class="page-hero">
    <p class="page-hero-label">${esc(page.label)}</p>
    <h1>${esc(page.h1)}</h1>
  </div>
  <article>
    <p class="lp-intro">${esc(page.intro)}</p>
    ${renderSections(page.sections || [])}
    ${disclaimerHtml}
    <div class="lp-cta">
      <h2>Start a map</h2>
      <p>Import your data, style it, and export a clean map. No GIS experience needed.</p>
      <a href="/">Open Exploration Maps →</a>
    </div>
    ${faqBlock(page.faqs)}
    ${relatedHtml}
  </article>
</div>`;

  return pageShell({
    title: page.h1,
    fullTitle: page.fullTitle,
    description: page.metaDescription,
    canonical: url,
    schema,
    body,
    ogType: 'website',
    ogImage: `${SITE}/og/${page.slug}.png`,
  });
}

// ─── Sitemap ──────────────────────────────────────────────────────────────────

function buildSitemap(allUrls, landingUrls = []) {
  const today = new Date().toISOString().split('T')[0];
  const homepage = `  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`;
  // Top-level SEO landing pages — high priority money pages.
  const landingEntries = landingUrls
    .map(u => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`)
    .join('\n');
  const blogEntries = allUrls.map(u => {
    const isBlogIndex = u === `${SITE}/blog/`;
    const isHub = /\/blog\/(how-to|comparisons|locations)\/$/.test(u);
    const priority = isBlogIndex ? '0.9' : isHub ? '0.8' : '0.7';
    const freq = isBlogIndex || isHub ? 'weekly' : 'monthly';
    return `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`;
  }).join('\n');
  const staticEntries = [
    `  <url><loc>${SITE}/about/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`,
    `  <url><loc>${SITE}/contact/</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.5</priority></url>`,
  ].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${homepage}\n${landingEntries}\n${blogEntries}\n${staticEntries}\n</urlset>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const allUrls = [`${SITE}/blog/`];
  const allPosts = [...howToPosts, ...compPosts];

  console.log('🗺  Generating blog...');

  // How-to posts
  for (const post of howToPosts) {
    const html = buildHowToPage(post, allPosts);
    writeFile(join(OUT, post.slug, 'index.html'), html);
    allUrls.push(`${SITE}/blog/${post.slug}/`);
    console.log(`  ✓ how-to: ${post.slug}`);
  }

  // Comparison posts
  for (const post of compPosts) {
    const html = buildCompPage(post, allPosts);
    writeFile(join(OUT, post.slug, 'index.html'), html);
    allUrls.push(`${SITE}/blog/${post.slug}/`);
    console.log(`  ✓ comparison: ${post.slug}`);
  }

  // Location × map-type pages
  let locationCount = 0;
  for (const location of locations) {
    for (const mapType of REGION_MAP_TYPES) {
      const { pageSlug, html } = buildLocationPage(location, mapType);
      writeFile(join(OUT, pageSlug, 'index.html'), html);
      allUrls.push(`${SITE}/blog/${pageSlug}/`);
      locationCount++;
    }
  }
  console.log(`  ✓ location pages: ${locationCount}`);

  // Category hub pages
  const howToHub = buildCategoryPage({
    slug: 'how-to',
    label: 'How-to Guides',
    title: 'Mining Map How-to Guides',
    description: 'Step-by-step guides for creating professional mining exploration maps — claims maps, drill results maps, investor presentations, and more.',
    body: `<div class="hub-grid">${howToPosts.map(p => `
<div class="hub-card">
  <h3>${esc(p.title)}</h3>
  <p>${esc(p.metaDescription)}</p>
  <a href="/blog/${p.slug}/">Read guide →</a>
</div>`).join('')}</div>`,
  });
  writeFile(join(OUT, 'how-to', 'index.html'), howToHub.html);
  allUrls.push(`${SITE}/blog/how-to/`);
  console.log('  ✓ hub: how-to');

  const compHub = buildCategoryPage({
    slug: 'comparisons',
    label: 'Software Comparisons',
    title: 'Mining Map Software Comparisons',
    description: 'Side-by-side comparisons of Exploration Maps vs ArcGIS, QGIS, and other tools for junior mining exploration companies.',
    body: `<div class="hub-grid">${compPosts.map(p => `
<div class="hub-card">
  <h3>${esc(p.title)}</h3>
  <p>${esc(p.metaDescription)}</p>
  <a href="/blog/${p.slug}/">Read comparison →</a>
</div>`).join('')}</div>`,
  });
  writeFile(join(OUT, 'comparisons', 'index.html'), compHub.html);
  allUrls.push(`${SITE}/blog/comparisons/`);
  console.log('  ✓ hub: comparisons');

  const locTableRows = locations.map(loc => {
    const links = REGION_MAP_TYPES.map(mt => `<a href="/blog/${mt.slug}-${loc.slug}/">${esc(mt.name)}</a>`).join(' · ');
    return `<tr><td><strong>${esc(loc.name)}</strong></td><td>${links}</td></tr>`;
  }).join('');

  const locHub = buildCategoryPage({
    slug: 'locations',
    label: 'By Region',
    title: 'Mining Map Guides by Region',
    description: 'Location-specific guides for creating professional exploration maps in Canadian provinces and US mining states.',
    body: `<div style="overflow-x:auto"><table class="location-table"><thead><tr><th>Region</th><th>Map Guides</th></tr></thead><tbody>${locTableRows}</tbody></table></div>`,
  });
  writeFile(join(OUT, 'locations', 'index.html'), locHub.html);
  allUrls.push(`${SITE}/blog/locations/`);
  console.log('  ✓ hub: locations');

  // Blog index
  writeFile(join(OUT, 'index.html'), buildBlogIndex(allUrls));
  console.log('  ✓ blog index');

  // Top-level SEO landing pages (output to public/<slug>/, not public/blog/)
  const landingUrls = [];
  for (const page of seoPages) {
    const html = buildSeoLandingPage(page, seoPages);
    writeFile(join(ROOT, 'public', page.slug, 'index.html'), html);
    landingUrls.push(`${SITE}/${page.slug}/`);
    console.log(`  ✓ landing: ${page.slug}`);
  }

  // Sitemap
  writeFile(join(ROOT, 'public', 'sitemap.xml'), buildSitemap(allUrls, landingUrls));
  console.log('  ✓ sitemap.xml');

  // robots.txt
  const robots = `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`;
  writeFile(join(ROOT, 'public', 'robots.txt'), robots);
  console.log('  ✓ robots.txt');

  console.log(`\n✅ Done — ${allUrls.length} pages generated in public/blog/`);
}

main().catch(err => { console.error(err); process.exit(1); });
