#!/usr/bin/env node
/**
 * Blog generator for explorationmaps.com
 * Run: node scripts/generate-blog.js
 * Outputs static HTML to public/blog/[slug]/index.html
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'public', 'blog');
const SITE = 'https://www.explorationmaps.com';
const SITE_NAME = 'Exploration Maps';

// ─── Load data ────────────────────────────────────────────────────────────────

const howToPosts    = JSON.parse(readFileSync(join(__dirname, 'blog-data', 'how-to-posts.json'), 'utf8'));
const compPosts     = JSON.parse(readFileSync(join(__dirname, 'blog-data', 'comparison-posts.json'), 'utf8'));
const locations     = JSON.parse(readFileSync(join(__dirname, 'blog-data', 'locations.json'), 'utf8'));
const mapTypes      = JSON.parse(readFileSync(join(__dirname, 'blog-data', 'map-types.json'), 'utf8'));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

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
.blog-index-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px;padding:40px 0 80px}
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
/* Footer */
.site-footer{border-top:1px solid #e2e8f0;padding:32px 24px;text-align:center;font-size:13px;color:#94a3b8;margin-top:40px}
.site-footer a{color:#64748b}
`;

// ─── Page shell ───────────────────────────────────────────────────────────────

function pageShell({ title, description, canonical, schema, body, noindex = false }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | ${SITE_NAME}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex,follow">' : ''}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
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
  <p>© ${new Date().getFullYear()} ${esc(SITE_NAME)} · <a href="/">Open the map editor</a> · <a href="/blog/">Blog</a></p>
</footer>
</body>
</html>`;
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function sidebar(relatedHtml = '') {
  return `<aside>
  <div class="cta-card">
    <h3>Create Your Map Now</h3>
    <p>No GIS experience needed. Import your data, choose a theme, and export in minutes.</p>
    <a class="cta-btn" href="/">Open Exploration Maps →</a>
  </div>
  ${relatedHtml ? `<div class="sidebar-card"><h3>Related Guides</h3><ul>${relatedHtml}</ul></div>` : ''}
  <div class="sidebar-card">
    <h3>Map Types</h3>
    <ul>
      ${mapTypes.map(t => `<li><a href="/blog/how-to-create-${t.slug}/">How to Create a ${esc(t.name)}</a></li>`).join('\n')}
    </ul>
  </div>
</aside>`;
}

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

// ─── Sections renderer ────────────────────────────────────────────────────────

function renderSections(sections) {
  return sections.map(s => {
    const body = s.body ? `<p>${esc(s.body)}</p>` : '';
    const items = s.items ? `<ul>${s.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
    return `<h2>${esc(s.h2)}</h2>${body}${items}`;
  }).join('\n');
}

// ─── How-to post page ─────────────────────────────────────────────────────────

function buildHowToPage(post, allPosts) {
  const url = `${SITE}/blog/${post.slug}/`;
  const related = relatedLinks(post.relatedSlugs || [], allPosts);

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: post.title,
        description: post.metaDescription,
        url,
        author: { '@type': 'Organization', name: SITE_NAME, url: SITE },
        publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE },
      },
      {
        '@type': 'HowTo',
        name: post.title,
        description: post.directAnswer,
        step: (post.sections || []).map((s, i) => ({
          '@type': 'HowToStep',
          position: i + 1,
          name: s.h2,
          text: s.body || (s.items || []).join('. '),
        })),
      },
      ...(post.faqs?.length ? [{
        '@type': 'FAQPage',
        mainEntity: post.faqs.map(f => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      }] : []),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog/` },
          { '@type': 'ListItem', position: 3, name: post.title, item: url },
        ],
      },
    ],
  };

  const body = `
<div class="page-wrap">
  <div class="blog-layout">
    <article>
      <p class="breadcrumb"><a href="/">Home</a><span>›</span><a href="/blog/">Blog</a><span>›</span>${esc(post.title)}</p>
      <h1>${esc(post.title)}</h1>
      <p class="direct-answer">${esc(post.directAnswer)}</p>
      ${renderSections(post.sections || [])}
      ${faqBlock(post.faqs)}
    </article>
    ${sidebar(related)}
  </div>
</div>`;

  return pageShell({ title: post.title, description: post.metaDescription, canonical: url, schema, body });
}

// ─── Comparison post page ─────────────────────────────────────────────────────

function buildCompPage(post, allPosts) {
  const url = `${SITE}/blog/${post.slug}/`;
  const related = relatedLinks(post.relatedSlugs || [], allPosts);

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: post.title,
        description: post.metaDescription,
        url,
        author: { '@type': 'Organization', name: SITE_NAME, url: SITE },
        publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE },
      },
      ...(post.faqs?.length ? [{
        '@type': 'FAQPage',
        mainEntity: post.faqs.map(f => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      }] : []),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog/` },
          { '@type': 'ListItem', position: 3, name: post.title, item: url },
        ],
      },
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

  const body = `
<div class="page-wrap">
  <div class="blog-layout">
    <article>
      <p class="breadcrumb"><a href="/">Home</a><span>›</span><a href="/blog/">Blog</a><span>›</span>${esc(post.title)}</p>
      <h1>${esc(post.title)}</h1>
      <p class="direct-answer">${esc(post.directAnswer)}</p>
      ${renderSections(post.sections || [])}
      ${tableHtml}
      ${faqBlock(post.faqs)}
    </article>
    ${sidebar(related)}
  </div>
</div>`;

  return pageShell({ title: post.title, description: post.metaDescription, canonical: url, schema, body });
}

// ─── Location × map-type page ─────────────────────────────────────────────────

function buildLocationPage(location, mapType) {
  const pageSlug = `${mapType.slug}-${location.slug}`;
  const url = `${SITE}/blog/${pageSlug}/`;
  const title = `${mapType.name} — ${location.name}`;
  const description = `Create a professional ${mapType.primaryKeyword} for ${location.name}. Step-by-step guide for ${location.country === 'Canada' ? 'Canadian' : 'US'} exploration companies using Exploration Maps.`;

  const mineralList = location.minerals.slice(0, 4).join(', ');
  const depositList = location.famousDeposits.slice(0, 3).join(', ');
  const districtList = location.miningDistricts.slice(0, 3).join(', ');

  const directAnswer = `To create a ${mapType.primaryKeyword} for ${location.name}, import your ${location.abbreviation} claims or data as GeoJSON, assign the appropriate layer role for automatic styling, set the ${mapType.recommendedBasemap} basemap, and export as PNG or PDF. The entire process takes 15–30 minutes with no GIS experience required.`;

  const steps = mapType.steps.map((step, i) => `<li>${esc(step)}</li>`).join('');

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
      q: `Can I export a ${location.name} ${mapType.primaryKeyword} for an NI 43-101 report?`,
      a: `Yes. Exploration Maps exports PNG and PDF at 2–3× pixel ratio, suitable for inclusion in NI 43-101 technical reports as required figures. The export includes north arrow, scale bar, legend, and title block — all elements required for NI 43-101 compliance.`,
    },
  ];

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: title,
        description,
        url,
        author: { '@type': 'Organization', name: SITE_NAME, url: SITE },
        publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE },
      },
      {
        '@type': 'HowTo',
        name: `How to Create a ${mapType.name} for ${location.name}`,
        description: directAnswer,
        step: mapType.steps.map((step, i) => ({
          '@type': 'HowToStep',
          position: i + 1,
          name: step,
          text: step,
        })),
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map(f => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog/` },
          { '@type': 'ListItem', position: 3, name: title, item: url },
        ],
      },
    ],
  };

  // Related: same location, other map types + same map type, nearby locations
  const sameLocationLinks = mapTypes
    .filter(t => t.id !== mapType.id)
    .slice(0, 3)
    .map(t => `<li><a href="/blog/${t.slug}-${location.slug}/">${esc(t.name)} — ${esc(location.name)}</a></li>`)
    .join('\n');

  const sameTypeLinks = locations
    .filter(l => l.slug !== location.slug && l.country === location.country)
    .slice(0, 3)
    .map(l => `<li><a href="/blog/${mapType.slug}-${l.slug}/">${esc(mapType.name)} — ${esc(l.name)}</a></li>`)
    .join('\n');

  const relatedHtml = sameLocationLinks + sameTypeLinks;

  const body = `
<div class="page-wrap">
  <div class="blog-layout">
    <article>
      <p class="breadcrumb"><a href="/">Home</a><span>›</span><a href="/blog/">Blog</a><span>›</span>${esc(title)}</p>
      <h1>${esc(title)}</h1>
      <p class="direct-answer">${esc(directAnswer)}</p>

      <h2>About Mining in ${esc(location.name)}</h2>
      <p>${esc(location.description)}</p>
      <p><strong>Key minerals:</strong> ${esc(location.minerals.join(', '))}. <strong>Notable deposits:</strong> ${esc(location.famousDeposits.join(', '))}. <strong>Mining districts:</strong> ${esc(location.miningDistricts.join(', '))}.</p>
      <p>The ${esc(location.regulatoryBody)} administers mineral rights in ${esc(location.name)}. Claim data is accessible through ${esc(location.claimsPortal)}.</p>

      <h2>What is a ${esc(mapType.name)}?</h2>
      <p>${esc(mapType.intro)}</p>

      <h2>How to Create a ${esc(mapType.name)} for ${esc(location.name)}</h2>
      <ol class="steps-list">${steps}</ol>

      <h2>Recommended Settings for ${esc(location.name)}</h2>
      <ul>
        <li><strong>Basemap:</strong> ${esc(mapType.recommendedBasemap)}</li>
        <li><strong>Design theme:</strong> ${esc(mapType.recommendedTheme)}</li>
        <li><strong>Export format:</strong> PNG at 2× for investor presentations, PDF (Letter or A4) for NI 43-101 reports</li>
        <li><strong>Coordinate system:</strong> Ensure source data is in WGS84 (EPSG:4326)</li>
      </ul>

      <h2>Common Use Cases in ${esc(location.name)}</h2>
      <ul>${mapType.useCases.map(u => `<li>${esc(u)}</li>`).join('')}</ul>

      ${faqBlock(faqs)}
    </article>
    ${sidebar(relatedHtml)}
  </div>
</div>`;

  return { pageSlug, html: pageShell({ title, description, canonical: url, schema, body }) };
}

// ─── Blog index page ──────────────────────────────────────────────────────────

function buildBlogIndex(allPosts) {
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

  const locationSample = [];
  for (const loc of locations.slice(0, 6)) {
    for (const mt of mapTypes.slice(0, 2)) {
      locationSample.push(`
<div class="blog-card">
  <span class="blog-card-tag">Location Guide</span>
  <h3>${esc(mt.name)} — ${esc(loc.name)}</h3>
  <p>Create a professional ${esc(mt.primaryKeyword)} for exploration projects in ${esc(loc.name)}.</p>
  <a href="/blog/${mt.slug}-${loc.slug}/">Read guide →</a>
</div>`);
    }
  }

  const body = `
<div class="page-wrap">
  <div class="page-hero">
    <p class="page-hero-label">Resources</p>
    <h1>Exploration Mapping Guides</h1>
    <p>Step-by-step tutorials, software comparisons, and location-specific guides for creating professional mining exploration maps.</p>
  </div>
  <h2 style="margin:40px 0 8px;font-size:1.1rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">How-to Guides</h2>
  <div class="blog-index-grid">${howToCards}</div>
  <h2 style="margin:0 0 8px;font-size:1.1rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Software Comparisons</h2>
  <div class="blog-index-grid">${compCards}</div>
  <h2 style="margin:0 0 8px;font-size:1.1rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Location Guides</h2>
  <div class="blog-index-grid">${locationSample.join('\n')}</div>
  <p style="text-align:center;color:#64748b;font-size:14px;padding-bottom:48px">${allPosts.length} guides published. More added regularly.</p>
</div>`;

  return pageShell({ title: 'Exploration Mapping Guides & Tutorials', description: 'Guides, tutorials, and comparisons for creating professional mining exploration maps — investor presentations, NI 43-101 figures, and news release maps.', canonical: url, schema, body });
}

// ─── Sitemap ──────────────────────────────────────────────────────────────────

function buildSitemap(allUrls) {
  const today = new Date().toISOString().split('T')[0];
  const entries = allUrls.map(u => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;
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
    for (const mapType of mapTypes) {
      const { pageSlug, html } = buildLocationPage(location, mapType);
      writeFile(join(OUT, pageSlug, 'index.html'), html);
      allUrls.push(`${SITE}/blog/${pageSlug}/`);
      locationCount++;
    }
  }
  console.log(`  ✓ location pages: ${locationCount}`);

  // Blog index
  writeFile(join(OUT, 'index.html'), buildBlogIndex(allUrls));
  console.log('  ✓ blog index');

  // Sitemap
  writeFile(join(ROOT, 'public', 'sitemap.xml'), buildSitemap(allUrls));
  console.log('  ✓ sitemap.xml');

  // robots.txt
  const robots = `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`;
  writeFile(join(ROOT, 'public', 'robots.txt'), robots);
  console.log('  ✓ robots.txt');

  console.log(`\n✅ Done — ${allUrls.length} pages generated in public/blog/`);
}

main().catch(err => { console.error(err); process.exit(1); });
