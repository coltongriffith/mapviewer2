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
const mapTypes      = JSON.parse(readFileSync(join(__dirname, 'blog-data', 'map-types.json'), 'utf8'));
const seoPages      = JSON.parse(readFileSync(join(__dirname, 'blog-data', 'seo-pages.json'), 'utf8'));
const redirectMap   = JSON.parse(readFileSync(join(__dirname, 'blog-data', 'redirects.json'), 'utf8'));

// The five clusters the site is organised around. Ordered by how close the
// topic sits to what Exploration Maps actually does — mineral claim search and
// tenure monitoring lead because that is where the product is genuinely
// differentiated, not because the terms have the most volume.
const CATEGORIES = [
  {
    id: 'mineral-claims',
    name: 'Mineral Claims',
    tag: 'Claim search',
    blurb: 'Finding and mapping mineral claims from public registry data, jurisdiction by jurisdiction.',
  },
  {
    id: 'tenure-management',
    name: 'Tenure Management',
    tag: 'Tenure',
    blurb: 'Tracking good-to-dates, expiry deadlines and changes to the government record.',
  },
  {
    id: 'exploration-mapping',
    name: 'Exploration Mapping',
    tag: 'Mapping',
    blurb: 'Building maps that hold up in an investor deck, a news release or a technical report.',
  },
  {
    id: 'drill-results',
    name: 'Drill Results',
    tag: 'Drilling',
    blurb: 'Turning collars, assays and intercepts into a figure people can read.',
  },
  {
    id: 'gis-data',
    name: 'GIS & Data',
    tag: 'Data',
    blurb: 'File formats, imports, and where a full desktop GIS is still the right tool.',
  },
];

// Region pages are only generated for map types with real regional search
// intent (mining claims, drill results). Types flagged regionPages:false keep
// their how-to guide but no 28-region template fan-out — those pages were thin
// and near-duplicate. Removed URLs 301 via vercel.json.

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
body{font-family:'Source Sans 3','Segoe UI',system-ui,-apple-system,sans-serif;color:#142126;background:#fff;line-height:1.6}
a{color:#142126;text-decoration:underline;text-decoration-color:#c6cecf;text-underline-offset:3px}a:hover{text-decoration-color:#c65322}
img{max-width:100%;height:auto}
/* Nav */
.nav{display:flex;align-items:center;justify-content:space-between;padding:0 24px;height:56px;border-bottom:1px solid #dde3e3;background:#fff;position:sticky;top:0;z-index:100}
.nav-brand{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:#142126;text-decoration:none}
.nav-brand svg{flex-shrink:0}
.nav-cta{background:#142126;color:#fff;padding:7px 16px;border-radius:8px;font-size:13px;font-weight:600;white-space:nowrap}
.nav-cta:hover{background:#2c3d42;text-decoration:none}
/* Layout */
.page-wrap{max-width:1100px;margin:0 auto;padding:0 24px}
.blog-layout{display:grid;grid-template-columns:1fr 280px;gap:48px;padding:48px 0 80px;align-items:start}
/* Grid items default to min-width:auto, so a wide child sizes the column
   instead of scrolling inside it — which is how one six-column table set
   the page width on a phone and dragged every paragraph out with it. */
.blog-layout>*{min-width:0}
@media(max-width:768px){.blog-layout{grid-template-columns:1fr;padding:32px 0 60px}}
/* Article */
article h1{font-size:2rem;font-weight:800;line-height:1.2;color:#142126;margin-bottom:16px}
@media(max-width:600px){article h1{font-size:1.5rem}}
.direct-answer{font-size:1.05rem;color:#5f6e72;background:#f6f8f7;border-left:4px solid #142126;padding:14px 18px;border-radius:0 8px 8px 0;margin-bottom:32px;line-height:1.65}
.breadcrumb{font-size:13px;color:#5f6e72;margin-bottom:20px}
.breadcrumb a{color:#5f6e72}
.breadcrumb span{margin:0 6px}
article h2{font-size:1.35rem;font-weight:700;color:#142126;margin:40px 0 12px;padding-bottom:8px;border-bottom:2px solid #dde3e3}
article h2:first-of-type{margin-top:0}
article h3{font-size:1.05rem;font-weight:700;color:#142126;margin:28px 0 8px}
article p{margin-bottom:16px;color:#5f6e72;line-height:1.75}
article ul,article ol{padding-left:22px;margin-bottom:16px}
article li{margin-bottom:6px;color:#5f6e72;line-height:1.65}
article strong{color:#142126}
/* Steps */
.steps-list{list-style:none;padding:0;counter-reset:step}
.steps-list li{counter-increment:step;display:flex;gap:14px;margin-bottom:16px;align-items:flex-start}
.steps-list li::before{content:counter(step);display:flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;background:#142126;color:#fff;border-radius:50%;font-size:13px;font-weight:700;margin-top:2px}
/* Comparison table */
.comparison-table{width:100%;border-collapse:collapse;margin:20px 0;font-size:14px}
.comparison-table th{background:#142126;color:#fff;padding:10px 14px;text-align:left;font-weight:600}
.comparison-table td{padding:9px 14px;border-bottom:1px solid #dde3e3;vertical-align:top}
.comparison-table tr:nth-child(even) td{background:#f6f8f7}
.comparison-table tr:first-child td:first-child{font-weight:600}
/* FAQ */
.faq-section{margin:48px 0 0}
.faq-section h2{font-size:1.35rem;font-weight:700;color:#142126;margin-bottom:20px;padding-bottom:8px;border-bottom:2px solid #dde3e3}
.faq-item{border:1px solid #dde3e3;border-radius:10px;margin-bottom:12px;overflow:hidden}
.faq-q{font-weight:700;color:#142126;padding:14px 18px;font-size:0.95rem;background:#f6f8f7}
.faq-a{padding:12px 18px;color:#5f6e72;font-size:0.9rem;line-height:1.7;border-top:1px solid #dde3e3}
/* Sidebar */
.sidebar-card{background:#f6f8f7;border:1px solid #dde3e3;border-radius:12px;padding:24px;margin-bottom:24px}
.sidebar-card h3{font-size:14px;font-weight:700;color:#142126;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em}
.sidebar-card ul{list-style:none;padding:0}
.sidebar-card li{margin-bottom:8px;font-size:14px}
.sidebar-card a{color:#142126}
.cta-card{background:#142126;border-radius:12px;padding:28px 24px;color:#fff;text-align:center;margin-bottom:24px}
.cta-card h3{font-size:1.1rem;font-weight:700;margin-bottom:10px;color:#fff}
.cta-card p{font-size:13px;color:#dde3e3;margin-bottom:18px;line-height:1.6}
.cta-btn{display:inline-block;background:#fff;color:#142126;padding:10px 22px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none}
.cta-btn:hover{background:#f6f8f7;text-decoration:none}
/* Blog index */
.blog-index-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px;padding:24px 0 40px}
.blog-card{border:1px solid #dde3e3;border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:8px;transition:border-color .15s,box-shadow .15s}
.blog-card:hover{border-color:#142126;box-shadow:0 4px 16px rgba(37,99,235,0.1)}
.blog-card-tag{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#142126}
.blog-card h3{font-size:1rem;font-weight:700;color:#142126;line-height:1.35}
.blog-card p{font-size:13px;color:#5f6e72;line-height:1.6;flex:1}
.blog-card a{font-size:13px;font-weight:600;color:#142126}
/* Hero */
.page-hero{padding:48px 0 32px;border-bottom:1px solid #dde3e3;margin-bottom:0}
.page-hero-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#142126;margin-bottom:10px}
.page-hero h1{font-size:2.2rem;font-weight:800;color:#142126;max-width:720px;line-height:1.2;margin-bottom:12px}
@media(max-width:600px){.page-hero h1{font-size:1.6rem}}
.page-hero p{font-size:1.05rem;color:#5f6e72;max-width:580px;line-height:1.65}
/* Index section headers */
.index-section-head{display:flex;align-items:baseline;justify-content:space-between;margin:40px 0 4px;padding-top:8px;border-top:2px solid #dde3e3}
.index-section-head h2{font-size:1.1rem;font-weight:700;color:#142126}
.index-section-head a{font-size:13px;color:#142126}
.table-scroll{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch;margin:16px 0}
.table-scroll .data-table{margin:0;min-width:520px}
.index-count{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:#eef2f7;color:#5f6e72;font-size:12px;font-weight:600;vertical-align:middle}
.index-section-intro{margin:0 0 16px;color:#5f6e72;font-size:14px;max-width:60ch}
.index-foot{text-align:center;color:#5f6e72;font-size:14px;padding:48px 0}
.index-foot a{color:#142126}
/* Index TOC */
.index-toc{display:flex;flex-wrap:wrap;gap:8px;padding:24px 0 8px;border-bottom:1px solid #dde3e3;margin-bottom:8px}
.index-toc a{font-size:13px;font-weight:600;color:#5f6e72;background:#f6f8f7;padding:4px 12px;border-radius:999px;text-decoration:none}
.index-toc a:hover{background:#f6f8f7;color:#2c3d42}
/* Location table */
.location-table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0 32px}
.location-table th{background:#f6f8f7;text-align:left;padding:8px 12px;font-weight:700;color:#5f6e72;border:1px solid #dde3e3}
.location-table td{padding:7px 12px;border:1px solid #dde3e3;color:#5f6e72}
.location-table tr:nth-child(even) td{background:#f6f8f7}
/* Category hub */
.hub-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;padding:24px 0 48px}
.hub-card{border:1px solid #dde3e3;border-radius:10px;padding:20px;display:flex;flex-direction:column;gap:6px}
.hub-card h3{font-size:0.95rem;font-weight:700;color:#142126}
.hub-card p{font-size:13px;color:#5f6e72;line-height:1.55;flex:1}
.hub-card a{font-size:13px;font-weight:600;color:#142126}
/* Tip box */
.tip-box{background:#f0fdf4;border-left:4px solid #287454;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0;color:#5f6e72;line-height:1.7}
/* Data sources table */
.data-table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0 20px}
.data-table th{background:#f6f8f7;text-align:left;padding:8px 12px;font-weight:700;color:#5f6e72;border:1px solid #dde3e3}
.data-table td{padding:7px 12px;border:1px solid #dde3e3;color:#5f6e72;vertical-align:top}
.data-table tr:nth-child(even) td{background:#f6f8f7}
/* Post date */
.post-date{color:#5f6e72;font-size:12px}
/* SEO landing page */
.lp-wrap{max-width:820px;margin:0 auto;padding:0 24px}
.lp article h2{font-size:1.45rem}
.lp-intro{font-size:1.15rem;color:#5f6e72;line-height:1.7;margin:0 0 8px}
.lp-cta{background:#142126;border-radius:14px;padding:32px 28px;color:#fff;text-align:center;margin:40px 0}
.lp-cta h2{color:#fff !important;border:none !important;margin:0 0 8px !important;padding:0 !important;font-size:1.3rem}
.lp-cta p{color:#dde3e3;margin:0 0 18px;font-size:0.98rem}
.lp-cta a{display:inline-block;background:#fff;color:#142126;padding:12px 26px;border-radius:9px;font-weight:700;font-size:15px;text-decoration:none}
.lp-cta a:hover{background:#f6f8f7;text-decoration:none}
.lp-related{border-top:2px solid #dde3e3;margin-top:48px;padding-top:24px}
.lp-related h2{font-size:1.2rem;border:none;padding:0}
.lp-related-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-top:8px}
.lp-related-card{border:1px solid #dde3e3;border-radius:10px;padding:16px 18px;display:block;text-decoration:none}
.lp-related-card:hover{border-color:#142126;box-shadow:0 4px 14px rgba(37,99,235,0.1);text-decoration:none}
.lp-related-card strong{display:block;color:#142126;font-size:0.98rem;margin-bottom:4px}
.lp-related-card span{color:#5f6e72;font-size:13px;line-height:1.5}
.disclaimer-box{background:#faf5ea;border-left:4px solid #9a6715;padding:14px 18px;border-radius:0 8px 8px 0;margin:24px 0;color:#5f6e72;line-height:1.7;font-size:0.95rem}
/* Inline CTA band */
.inline-cta{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;background:#f6f8f7;border:1px solid #c7d7fe;border-radius:12px;padding:18px 22px;margin:28px 0}
.inline-cta-copy{display:flex;flex-direction:column;gap:2px}
.inline-cta-copy strong{font-size:1.02rem;color:#142126;font-weight:700}
.inline-cta-copy span{font-size:0.9rem;color:#5f6e72}
.inline-cta-btn{display:inline-block;background:#142126;color:#fff;padding:10px 20px;border-radius:9px;font-weight:700;font-size:14px;white-space:nowrap;text-decoration:none}
.inline-cta-btn:hover{background:#2c3d42;text-decoration:none}
/* Screenshot figure placeholder */
.blog-figure{margin:22px 0}
.blog-figure img{display:block;width:100%;border:1px solid #dde3e3;border-radius:10px}
.screenshot-frame{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:180px;background:repeating-linear-gradient(45deg,#f6f8f7,#f6f8f7 12px,#f6f8f7 12px,#f6f8f7 24px);border:1.5px dashed #c6cecf;border-radius:10px;color:#5f6e72;font-size:0.9rem;font-weight:600;text-align:center;padding:24px}
.screenshot-frame-icon{font-size:28px;color:#5f6e72;line-height:1}
.blog-figure figcaption{margin-top:8px;font-size:13px;color:#5f6e72;text-align:center;font-style:italic}
/* Checklist */
.checklist{list-style:none;padding:0;margin:16px 0}
.checklist li{position:relative;padding-left:30px;margin-bottom:10px;color:#5f6e72;line-height:1.6}
.checklist li::before{content:'✓';position:absolute;left:0;top:0;display:flex;align-items:center;justify-content:center;width:20px;height:20px;background:#287454;color:#fff;border-radius:50%;font-size:12px;font-weight:700}
/* Source / verify / capability boxes */
.box-title{display:block;font-size:0.95rem;font-weight:700;margin-bottom:6px}
.source-box{background:#f6f8f7;border-left:4px solid #5f6e72;padding:14px 18px;border-radius:0 8px 8px 0;margin:24px 0;color:#5f6e72;line-height:1.7;font-size:0.92rem}
.source-box .box-title{color:#5f6e72}
.verify-box{background:#faf5ea;border-left:4px solid #9a6715;padding:14px 18px;border-radius:0 8px 8px 0;margin:24px 0;color:#5f6e72;line-height:1.7;font-size:0.92rem}
.verify-box .box-title{color:#9a6715}
.capability-box{background:#f6f8f7;border-left:4px solid #142126;padding:14px 18px;border-radius:0 8px 8px 0;margin:24px 0;color:#5f6e72;line-height:1.7;font-size:0.92rem}
.capability-box .box-title{color:#2c3d42}
.capability-box ul{padding-left:20px;margin:6px 0}
.note-box{background:#f6f8f7;border-left:4px solid #5f6e72;padding:14px 18px;border-radius:0 8px 8px 0;margin:24px 0;color:#5f6e72;line-height:1.7;font-size:0.92rem}
/* Footer */
.site-footer{border-top:1px solid #dde3e3;padding:28px 24px;text-align:center;font-size:13px;color:#5f6e72;margin-top:40px}
.site-footer-links{margin-bottom:8px;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px}
.site-footer a{color:#5f6e72}
.site-footer-sep{color:#c6cecf}
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
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Source+Sans+3:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<nav class="nav">
  <a class="nav-brand" href="/">
    <svg width="20" height="20" viewBox="0 0 480 520" fill="none" aria-hidden="true"><path fill="#142126" d="M60 40H180V85H410V250H445V480H30V385H60Z"/><path fill="none" stroke="#ffffff" stroke-width="22" d="M18 180H132L205 250H240V325L320 400V490"/><path fill="none" stroke="#ffffff" stroke-width="22" d="M205 250L260 195"/><rect x="250" y="145" width="90" height="90" fill="#ffffff"/><rect x="273" y="168" width="44" height="44" fill="#c65322"/></svg>
    ${esc(SITE_NAME)}
  </a>
  <a class="nav-cta" href="/">Open editor →</a>
</nav>
${body}
<footer class="site-footer">
  <div class="site-footer-links">
    <a href="/mining-map-software/">Mining Map Software</a>
    <span class="site-footer-sep">·</span>
    <a href="/mineral-tenure-monitoring/">Tenure Monitoring</a>
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
  // Wrapped so a wide table scrolls inside its own container. Without this a
  // six-column table sets the page width on a phone and every paragraph on the
  // page starts overflowing with it — the registry comparison table did exactly
  // that at 390px.
  return `<div class="table-scroll"><table class="data-table">${head}${body}</table></div>`;
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

// faqSchema was removed deliberately. Google restricted FAQ rich results to
// authoritative government and health sites in August 2023, so FAQPage markup
// on a commercial site earns no treatment and is simply a second copy of the
// visible content to keep in sync. The visible FAQ blocks remain.

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

  // No region cross-links. The 56 "[map type] — [region]" pages they pointed at
  // were geographic permutations of two templates and have been retired; the
  // jurisdiction pages that survive are the ones where the product actually
  // does something different, and those are linked from the article body.
  const locationHtml = '';

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

  return pageShell({
    title: post.title, fullTitle: post.fullTitle, description: post.metaDescription,
    canonical: url, schema, body,
  });
}

// ─── Comparison post page ─────────────────────────────────────────────────────

function buildCompPage(post, allPosts) {
  const url = `${SITE}/blog/${post.slug}/`;
  const related = relatedLinks(post.relatedSlugs || [], allPosts);

  // Sidebar links for a comparison post. These used to point at three region
  // pages ("Mining Claims Map — BC", "— Nevada", "— Ontario") that no longer
  // exist; a reader comparing GIS tools is better served by the guides that
  // show what the alternative actually does.
  const locLinksHtml = [
    { href: '/blog/how-to-make-a-mining-claims-map/', label: 'How to make a mining claims map' },
    { href: '/blog/how-to-make-a-drill-results-map/', label: 'How to make a drill results map' },
    { href: '/blog/canadian-mineral-claim-registries/', label: 'Canadian claim registries' },
  ].map(({ href, label }) => `<li><a href="${href}">${label}</a></li>`).join('\n');

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      articleSchema(post.title, post.metaDescription, url, post.publishedDate),
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

  return pageShell({
    title: post.title, fullTitle: post.fullTitle, description: post.metaDescription,
    canonical: url, schema, body,
  });
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

// Hero figure for a how-to / comparison post that carries no image section of
// its own — uses the post's map-type export when known, else a polished
// finished-map default. Returns '' for posts that already embed screenshots,
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

// ─── Blog index page ──────────────────────────────────────────────────────────

function buildBlogIndex() {
  const url = `${SITE}/blog/`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Exploration Mapping Blog',
    description: 'Guides, tutorials, and resources for creating professional mining exploration maps.',
    url,
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE },
  };

  // Category order is editorial: what the product is strongest at comes first.
  // Every article declares a `category`; CATEGORIES is the single place the
  // set is defined, so a post with an unknown category fails the build loudly
  // rather than quietly disappearing from the index.
  const articles = [...howToPosts, ...compPosts];
  const uncategorised = articles.filter(a => !CATEGORIES.some(c => c.id === a.category));
  if (uncategorised.length) {
    throw new Error(`Articles with no known category: ${uncategorised.map(a => a.slug).join(', ')}`);
  }

  const card = (a, tag) => `
<div class="blog-card">
  <span class="blog-card-tag">${esc(tag)}</span>
  <h3>${esc(a.title)}</h3>
  <p>${esc((a.cardSummary || a.metaDescription).slice(0, 130))}…</p>
  <a href="/blog/${a.slug}/">Read guide →</a>
</div>`;

  const sections = CATEGORIES.map(c => {
    const inCategory = articles.filter(a => a.category === c.id);
    if (!inCategory.length) return '';
    const cards = inCategory.map(a => card(a, c.tag)).join('\n');
    // The count is derived from the rendered set, so it cannot drift from what
    // is actually on the page — the previous index advertised "86 guides" by
    // counting hub pages and the index itself alongside real articles.
    return `<div class="index-section-head" id="${c.id}">
  <h2>${esc(c.name)} <span class="index-count">${inCategory.length}</span></h2>
</div>
<p class="index-section-intro">${esc(c.blurb)}</p>
<div class="blog-index-grid">${cards}</div>`;
  }).filter(Boolean).join('\n');

  const toc = `<nav class="index-toc" aria-label="Jump to section">
  ${CATEGORIES.filter(c => articles.some(a => a.category === c.id))
    .map(c => `<a href="#${c.id}">${esc(c.name)}</a>`).join('\n  ')}
</nav>`;

  const body = `
<div class="page-wrap">
  <div class="page-hero">
    <p class="page-hero-label">Guides</p>
    <h1>Exploration Mapping &amp; Mineral Tenure Guides</h1>
    <p>Practical guides for finding mineral claims, tracking tenure deadlines, and turning
       exploration data into maps people can actually read.</p>
  </div>
  ${toc}
  ${sections}
  <p class="index-foot">${articles.length} guides · <a href="/blog/how-to/">How-to guides</a> ·
     <a href="/blog/comparisons/">Software comparisons</a> · <a href="/sitemap.xml">Sitemap</a></p>
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
    const isHub = /\/blog\/(how-to|comparisons)\/$/.test(u);
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

// ─── Redirects ────────────────────────────────────────────────────────────────

// Retired URLs live in blog-data/redirects.json and are written into
// vercel.json by this script, so the redirect table and the pages that no
// longer exist cannot drift apart by hand-editing one of them.
//
// `_`-prefixed keys are section comments in the JSON and are skipped.
function retiredExactPaths() {
  return Object.entries(redirectMap.exact)
    .filter(([k, v]) => !k.startsWith('_') && v)
    .map(([from, to]) => ({ from, to }));
}

function buildRedirects() {
  const out = [];
  for (const { from, to } of retiredExactPaths()) {
    // `{/}?` makes the trailing slash optional, matching the existing entries.
    out.push({ source: `${from}{/}?`, destination: to, permanent: true });
  }
  for (const p of redirectMap.patterns) {
    out.push({ source: `${p.source}{/}?`, destination: p.destination, permanent: true });
  }
  return out;
}

// A generated page must never share a URL with a retired one. Without this,
// re-adding a slug to a data file would produce a page that Vercel redirects
// away from — live in the sitemap, unreachable in a browser, and invisible
// until somebody clicked it.
function assertNoRetiredCollisions(allUrls) {
  const retired = new Set(retiredExactPaths().map(({ from }) => `${SITE}${from}/`));
  const patterns = redirectMap.patterns.map(p => new RegExp(
    `^${SITE}${p.source.replace(/:[A-Za-z]+/, '[^/]+')}/$`));
  const clashes = allUrls.filter(u => retired.has(u) || patterns.some(re => re.test(u)));
  if (clashes.length) {
    throw new Error(
      `These generated pages collide with a 301 in blog-data/redirects.json, so they would be `
      + `live in the sitemap and unreachable in a browser:\n  ${clashes.join('\n  ')}`);
  }
}

// vercel.json's `redirects` array is REPLACED, not merged.
//
// It used to be merged, with a filter that tried to tell generated rules from
// hand-written ones by comparing sources. That filter could not see a rule
// whose source had been DELETED from redirects.json: it was no longer in the
// generated set, so it looked hand-written and was preserved forever. Restoring
// a retired page would then add it to the sitemap while Vercel kept redirecting
// visitors away from it — and assertNoRetiredCollisions could not catch that,
// because it reads redirects.json rather than the config.
//
// Replacing wholesale removes the guessing. blog-data/redirects.json is the
// complete set, including the five rules that predate it, so deleting an entry
// there deletes the rule here. The rest of vercel.json — functions, rewrites,
// headers — is untouched.
function writeRedirectsToVercelConfig() {
  const path = join(ROOT, 'vercel.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.redirects = buildRedirects();
  writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return config.redirects.length;
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

  // Blog index
  writeFile(join(OUT, 'index.html'), buildBlogIndex());
  console.log('  ✓ blog index');

  // Top-level SEO landing pages (output to public/<slug>/, not public/blog/)
  const landingUrls = [];
  for (const page of seoPages) {
    const html = buildSeoLandingPage(page, seoPages);
    writeFile(join(ROOT, 'public', page.slug, 'index.html'), html);
    landingUrls.push(`${SITE}/${page.slug}/`);
    console.log(`  ✓ landing: ${page.slug}`);
  }

  // Nothing generated may sit on a retired URL. Checked before the sitemap is
  // written so a collision fails the build rather than shipping a bad sitemap.
  assertNoRetiredCollisions([...allUrls, ...landingUrls]);

  // Sitemap
  writeFile(join(ROOT, 'public', 'sitemap.xml'), buildSitemap(allUrls, landingUrls));
  console.log('  ✓ sitemap.xml');

  const redirectCount = writeRedirectsToVercelConfig();
  console.log(`  ✓ vercel.json redirects (${redirectCount})`);

  // robots.txt
  // Both sitemaps are declared. sitemap-companies.xml is written by the pSEO
  // pipeline (scripts/pseo/07_generate_pages.mjs) and held 35 URLs that robots
  // .txt never referenced — real per-issuer claim maps that no crawler was
  // being told about. They are not linked from the blog either; the only path
  // in is the landing page, so the sitemap is how they get found.
  const robots = [
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${SITE}/sitemap.xml`,
    `Sitemap: ${SITE}/sitemap-companies.xml`,
    '',
  ].join('\n');
  writeFile(join(ROOT, 'public', 'robots.txt'), robots);
  console.log('  ✓ robots.txt');

  console.log(`\n✅ Done — ${allUrls.length} pages generated in public/blog/`);
}

main().catch(err => { console.error(err); process.exit(1); });
