import React, { useEffect, useRef, useState } from 'react';
import { trackLandingClick } from '../utils/track';
import { US_CLAIMS_ENABLED, US_COVERAGE_COPY } from '../utils/jurisdictions';
import { PRICING, FREE_FEATURES, PRO_FEATURES } from '../utils/pricing';
import { useAuth } from '../hooks/useAuth.jsx';
import AuthModal from './AuthModal';
import BrandMark from './BrandMark';

const SHOWCASE = [
  {
    id: 'regional',
    label: 'Regional project location map',
    desc: 'Property location in district context — neighbouring operators, district roads, and the town down the valley.',
    img: '/gallery/regional.png',
    webp: '/gallery/regional.webp',
    webp2x: '/gallery/regional@2x.webp',
    tags: ['Project boundary', 'Nearby operators', 'District roads'],
  },
  {
    id: 'target',
    label: 'Claims & drill target map',
    desc: 'The claim block with priority target areas and collar locations, labelled with headline intercepts.',
    img: '/gallery/target.png',
    webp: '/gallery/target.webp',
    webp2x: '/gallery/target@2x.webp',
    tags: ['Claims', 'Target areas', 'Drill collars'],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure & access map',
    desc: 'Access roads and the powerline corridor around the claims — the access story at a glance.',
    img: '/gallery/infrastructure.png',
    webp: '/gallery/infrastructure.webp',
    webp2x: '/gallery/infrastructure@2x.webp',
    tags: ['Access roads', 'Powerline corridor', 'Drill collars'],
  },
];

// Social proof under the hero. OFF by default: flip to true only once the named
// companies have agreed to be listed publicly — don't ship customer names to a
// live marketing page without their sign-off. Both maps below were made in the
// product (Star Copper published 2; Discovery Energy Metals' Crystal Lake map).
const SHOW_SOCIAL_PROOF = false;
const SOCIAL_PROOF_COMPANIES = ['Star Copper', 'Discovery Energy Metals'];

// A handful of recognizable TSXV juniors whose claim-map pages are pre-built
// (public/companies/*). The "claim your company map" wedge for the first-10
// push — a visitor who recognizes their own ticker converts far better than one
// imagining a blank map. Full directory lives at /companies/.
const COMPANY_PAGES = [
  { ticker: 'DV', name: 'Dolly Varden Silver' },
  { ticker: 'GOT', name: 'Goliath Resources' },
  { ticker: 'ESK', name: 'Eskay Mining' },
  { ticker: 'BBB', name: 'Brixton Metals' },
  { ticker: 'SCOT', name: 'Scottie Resources' },
  { ticker: 'TUD', name: 'Tudor Gold' },
];

// What actually goes on these maps. Stated as capabilities with the nouns a
// geologist would use, not as feature-card headlines.
const CAPABILITIES = [
  ['Claims and tenure', 'Search the provincial registries by tenure number, claim name or registered owner, and drop the polygons straight onto the map.'],
  ['Drill collars and intercepts', 'Import a collar table as CSV and label the holes that matter with their intercepts.'],
  ['Targets and anomalies', 'Draw target outlines, geochemical anomalies and structural trends over the claim block.'],
  ['Infrastructure and access', 'Roads, rail, transmission corridors, ports and the nearest town — the access story a financier asks about first.'],
  ['Your own data', 'CSV, KML, KMZ, GeoJSON and shapefiles, including the multi-file kind, with coordinates in the projection they came in.'],
  ['Report-grade output', 'PNG, SVG, an Illustrator bundle and PDF, from the same layout you edited — including an NI 43-101 figure with a coordinate frame and title block.'],
];

const AUDIENCES = [
  ['Investor decks and news releases', 'A property map that matches the deck it sits in, re-exported when the claims change.'],
  ['Technical reports', 'Figures with a coordinate grid, scale, projection and a title block that names the qualified person.'],
  ['Website project pages', 'The same map at web resolution, updated without going back to a contractor.'],
  ['Exploration planning', 'Claims, targets, collars and access in one view while you decide where the next holes go.'],
];

function formatRelativeDate(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


export default function LandingPage({ onOpenEditor, onLoadSample, onLoadSampleStyle, recentProjects = [], onOpenProject, onShowHelp, onSearchBCClaims, onUploadFile, onOpenAccount, onOpenTenureMonitor }) {
  const { user } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [lookup, setLookup] = useState('');
  const clickThrottleRef = useRef(0);
  const rootRef = useRef(null);

  // Gentle fade-in on scroll for sections tagged with .lm-reveal
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !('IntersectionObserver' in window)) return undefined;
    const els = root.querySelectorAll('.lm-reveal');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('lm-vis'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  function handleLandingClick(e) {
    const now = Date.now();
    if (now - clickThrottleRef.current < 500) return;
    clickThrottleRef.current = now;
    const tracked = e.target.closest('[data-track]');
    const interactive = e.target.closest('button, a');
    let element = null;
    if (tracked) {
      element = tracked.dataset.track;
    } else if (interactive) {
      const firstStrong = interactive.querySelector('strong');
      element = interactive.getAttribute('aria-label')
        || (firstStrong ? firstStrong.textContent.trim() : null)
        || interactive.textContent.trim().slice(0, 50);
    } else {
      const section = e.target.closest('[data-section]');
      element = section ? section.dataset.section : null;
    }
    const x_pct = Math.round((e.clientX / window.innerWidth) * 100);
    const y_pct = Math.round(((e.clientY + window.scrollY) / Math.max(document.body.scrollHeight, 1)) * 100);
    trackLandingClick({ xPct: x_pct, yPct: y_pct, element, viewportW: window.innerWidth, pageH: document.body.scrollHeight });
  }

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // The hero's primary action is a lookup, so it hands the editor the term the
  // visitor typed instead of dropping them at an empty search box.
  const submitLookup = (e) => {
    e.preventDefault();
    onSearchBCClaims?.(lookup);
  };

  return (
    <div className="lm-shell" ref={rootRef} onClick={handleLandingClick}>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="lm-nav">
        <div className="lm-nav-inner">
          <div className="lm-wordmark">
            <BrandMark size={26} />
            <span className="em-wordmark">Exploration&nbsp;<b>Maps</b></span>
          </div>
          <nav className="lm-nav-links" aria-label="Main">
            <button type="button" onClick={() => scrollTo('features')} data-track="Nav: Features">Features</button>
            <button type="button" onClick={() => scrollTo('use-cases')} data-track="Nav: Use Cases">Use Cases</button>
            <button type="button" onClick={() => scrollTo('examples')} data-track="Nav: Examples">Examples</button>
            <button type="button" onClick={() => scrollTo('pricing')} data-track="Nav: Pricing">Pricing</button>
            {onOpenTenureMonitor && (
              <button type="button" onClick={onOpenTenureMonitor} data-track="Nav: Tenure Monitor">
                Tenure Monitor
              </button>
            )}
            {user ? (
              <button type="button" onClick={onOpenAccount} data-track="Nav: Dashboard">Dashboard</button>
            ) : (
              <button type="button" onClick={() => setShowAuth(true)} data-track="Nav: Sign up free">Sign in / Sign up free</button>
            )}
          </nav>
          <button className="lm-btn lm-btn-primary lm-nav-cta" type="button" onClick={onOpenEditor} data-track="Nav: Start Mapping">
            Start Mapping
          </button>
        </div>
      </header>

      <main>
        {/* ── Hero ───────────────────────────────────────────────── */}
        <section className="lm-hero" data-section="hero">
          <div className="lm-hero-copy">
            <p className="lm-eyebrow"><span className="lm-eyebrow-tick" aria-hidden="true" />Mapping for mineral exploration</p>
            <h1 className="lm-h1">
              Claim maps, drill plans and report figures — drawn from the public registries.
            </h1>
            <p className="lm-hero-sub">
              Look up mineral claims by tenure number, claim name or registered owner. Put them on a
              map with your collars, targets, roads and power, and export the figure for a deck, a
              news release or an NI 43-101 report.
            </p>

            {/* Lead with the lookup: the thing most visitors arrive wanting. */}
            <form className="lm-lookup" onSubmit={submitLookup}>
              <label className="lm-lookup-label" htmlFor="lm-lookup-input">
                Look up a claim, tenure number or company
              </label>
              <div className="lm-lookup-row">
                <input
                  id="lm-lookup-input"
                  className="lm-lookup-input"
                  type="search"
                  value={lookup}
                  onChange={(e) => setLookup(e.target.value)}
                  placeholder="e.g. 1078412, Dolly Varden Silver, Cedar Ridge"
                  autoComplete="off"
                />
                <button className="lm-btn lm-btn-primary" type="submit" data-track="Hero: Search BC Claims">
                  Search claims
                </button>
              </div>
              <p className="lm-lookup-note">
                B.C., plus Ontario, Saskatchewan, Manitoba, Newfoundland, Yukon and Quebec
                {US_CLAIMS_ENABLED ? `. ${US_COVERAGE_COPY}` : '.'}
              </p>
            </form>

            <div className="lm-hero-ctas">
              <button className="lm-btn lm-btn-ghost" type="button" onClick={onOpenEditor} data-track="Hero: Start Mapping">
                Start Mapping
              </button>
              <button className="lm-btn lm-btn-quiet" type="button" onClick={onUploadFile} data-track="Hero: Upload data">
                Upload a CSV or shapefile
              </button>
            </div>
          </div>

          {/* ── A real export from the product, shown as a figure ── */}
          <figure className="lm-mock-wrap" data-section="hero-mockup">
            <button
              type="button"
              className="lm-mock-body"
              onClick={() => (onLoadSampleStyle ? onLoadSampleStyle('aurora_demo') : onOpenEditor())}
              data-track="Hero mockup: open live demo"
              aria-label="Open this map as a live demo"
            >
              {/* The LCP element, and it was 2.7 MB of PNG — 78% of the whole
                  page — shipped at 1448px into an 870px box. WebP at the size
                  it is actually drawn is 136 kB.

                  width/height are the intrinsic 1x dimensions: they give the
                  browser the aspect ratio up front so the hero does not
                  reflow when the image lands. fetchPriority raises it above
                  the other subresources, since this is the thing the page is
                  judged on. No loading="lazy" — lazy-loading your own LCP
                  element delays the only paint that matters. */}
              <picture>
                <source
                  type="image/webp"
                  srcSet="/gallery/ba-after.webp 870w, /gallery/ba-after@2x.webp 1448w"
                  sizes="(max-width: 900px) 100vw, 870px"
                />
                <img
                  className="lm-mock-img"
                  src="/gallery/ba-after.png"
                  width="870"
                  height="653"
                  fetchPriority="high"
                  decoding="async"
                  alt="Cedar Ridge Project investor map — claims boundary, drill collars, target areas with assay callouts, legend, location inset, north arrow, and scale bar"
                />
              </picture>
            </button>
            <figcaption className="lm-mock-caption">
              <span>Cedar Ridge Project · investor map created in Exploration Maps</span>
              <span className="lm-mock-live">Open live example →</span>
            </figcaption>
          </figure>
        </section>

        {/* ── Workflow, as a strip under the hero ────────────────── */}
        <section className="lm-flow lm-reveal" data-section="workflow">
          <ol className="lm-flow-inner">
            <li>
              <span className="lm-flow-n">1</span>
              <div>
                <h2>Search or upload</h2>
                <p>Claims by tenure number, name or owner. CSV, KML, GeoJSON and shapefiles.</p>
              </div>
            </li>
            <li>
              <span className="lm-flow-n">2</span>
              <div>
                <h2>Style the map</h2>
                <p>Layers, labels, legend, locator, scale bar and your project branding.</p>
              </div>
            </li>
            <li>
              <span className="lm-flow-n">3</span>
              <div>
                <h2>Export and share</h2>
                <p>PNG, SVG, Illustrator and PDF — or a link that opens the same map.</p>
              </div>
            </li>
          </ol>
        </section>

        {/* ── Company proof, immediately under the hero ─────────── */}
        <section className="lm-proof-strip lm-reveal" id="companies" data-section="companies">
          <div className="lm-section-inner">
            <p className="lm-proof-lead">
              Claim maps are already built from registry data for TSXV and CSE issuers —
              open yours, then claim it to get the editable version.
            </p>
            <ul className="lm-ticker-list">
              {COMPANY_PAGES.map((c) => (
                <li key={c.ticker}>
                  <a href={`/companies/${c.ticker.toLowerCase()}/`} data-track={`Company: ${c.ticker}`}>
                    <span className="lm-ticker">{c.ticker}</span>
                    <span className="lm-ticker-name">{c.name}</span>
                  </a>
                </li>
              ))}
              <li className="lm-ticker-all">
                <a href="/companies/" data-track="Company: See all">All mapped companies →</a>
              </li>
            </ul>
          </div>
        </section>

        {SHOW_SOCIAL_PROOF && (
          <section className="lm-proof lm-reveal" data-section="social-proof">
            <div className="lm-proof-inner">
              <span className="lm-proof-label">Maps built here have been published in junior-mining investor materials</span>
              <div className="lm-proof-names">
                {SOCIAL_PROOF_COMPANIES.map((name) => (
                  <span className="lm-proof-name" key={name}>{name}</span>
                ))}
              </div>
            </div>
          </section>
        )}

        {recentProjects.length > 0 && (
          <section className="lm-section lm-reveal" data-section="recent">
            <div className="lm-section-inner">
              <p className="lm-eyebrow"><span className="lm-eyebrow-tick" aria-hidden="true" />Your maps</p>
              <ul className="lm-recent">
                {recentProjects.slice(0, 3).map((entry) => (
                  <li key={entry.id}>
                    <button type="button" onClick={() => onOpenProject(entry)}>
                      <span>{entry.name || 'Untitled map'}</span>
                      <span className="lm-recent-date">{formatRelativeDate(entry.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ── Capabilities ───────────────────────────────────────── */}
        <section className="lm-section lm-reveal" id="features" data-section="features">
          <div className="lm-section-inner">
            <p className="lm-eyebrow"><span className="lm-eyebrow-tick" aria-hidden="true" />What goes on the map</p>
            <h2 className="lm-h2">Registry data, your data, and the furniture a figure needs.</h2>
            <dl className="lm-deflist">
              {CAPABILITIES.map(([term, desc]) => (
                <div className="lm-def" key={term}>
                  <dt>{term}</dt>
                  <dd>{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Use cases ──────────────────────────────────────────── */}
        <section className="lm-section lm-section-rule lm-reveal" id="use-cases" data-section="use-cases">
          <div className="lm-section-inner">
            <p className="lm-eyebrow"><span className="lm-eyebrow-tick" aria-hidden="true" />Where these maps end up</p>
            <h2 className="lm-h2">Built for the documents exploration teams actually ship.</h2>
            <dl className="lm-deflist lm-deflist-2">
              {AUDIENCES.map(([term, desc]) => (
                <div className="lm-def" key={term}>
                  <dt>{term}</dt>
                  <dd>{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Example showcase ───────────────────────────────────── */}
        <section className="lm-section lm-section-rule lm-reveal" id="examples" data-section="examples">
          <div className="lm-section-inner">
            <p className="lm-eyebrow"><span className="lm-eyebrow-tick" aria-hidden="true" />Examples</p>
            <h2 className="lm-h2">Three maps, exported from this app.</h2>
            <p className="lm-section-sub">Open one to load it with sample data and take it apart.</p>
            <div className="lm-showcase">
              {SHOWCASE.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  className="lm-show-card"
                  onClick={() => (onLoadSampleStyle ? onLoadSampleStyle(ex.id) : onLoadSample?.())}
                  data-track={`Showcase: ${ex.label}`}
                >
                  <div className="lm-show-img">
                    {/* Below the fold, so these stay lazy — but they were still
                        640 kB–1 MB PNGs each, which is real money on mobile
                        data whether or not it moves the score. */}
                    <picture>
                      <source
                        type="image/webp"
                        srcSet={`${ex.webp} 640w, ${ex.webp2x} 1000w`}
                        sizes="(max-width: 900px) 100vw, 640px"
                      />
                      <img src={ex.img} alt={ex.label} loading="lazy" decoding="async" width="640" height="400" />
                    </picture>
                  </div>
                  <div className="lm-show-body">
                    <h3>{ex.label}</h3>
                    <p>{ex.desc}</p>
                    <p className="lm-show-tags">{ex.tags.join(' · ')}</p>
                    <span className="lm-show-cta">Open this example →</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── Comparison ─────────────────────────────────────────── */}
        <section className="lm-section lm-section-rule lm-reveal" data-section="comparison">
          <div className="lm-section-inner">
            <p className="lm-eyebrow"><span className="lm-eyebrow-tick" aria-hidden="true" />Why teams switch</p>
            <h2 className="lm-h2">The revision cycle is the whole problem.</h2>
            <div className="lm-compare">
              <div className="lm-compare-col">
                <h3>Sending it out</h3>
                <ol>
                  <li>Send data to a GIS or design contractor</li>
                  <li>Wait for a draft</li>
                  <li>Mark up the draft</li>
                  <li>Wait again, then re-export static files</li>
                  <li>Repeat when the claims or the collars change</li>
                </ol>
              </div>
              <div className="lm-compare-col lm-compare-col-new">
                <h3>Doing it here</h3>
                <ol>
                  <li>Search the registry or upload the file</li>
                  <li>Edit the layers and the layout directly</li>
                  <li>Export PNG, SVG, AI or PDF</li>
                  <li>Reopen the same project when the data moves</li>
                  <li>Share a link instead of emailing an image</li>
                </ol>
                <button className="lm-btn lm-btn-primary" type="button" onClick={onOpenEditor} data-track="Comparison: Start Mapping">
                  Start Mapping
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Pricing ────────────────────────────────────────────── */}
        <section className="lm-section lm-section-rule lm-reveal" id="pricing" data-section="pricing">
          <div className="lm-section-inner">
            <p className="lm-eyebrow"><span className="lm-eyebrow-tick" aria-hidden="true" />Pricing</p>
            <h2 className="lm-h2">Free to make a map. Pro to publish it at full size.</h2>
            <div className="lm-pricing-grid">
              <div className="lm-price-col">
                <h3>Free</h3>
                <p className="lm-price-amount">$0</p>
                <ul>
                  {FREE_FEATURES.map((f) => <li key={f}>{f}</li>)}
                </ul>
                <button className="lm-btn lm-btn-ghost" type="button" onClick={onOpenEditor} data-track="Pricing: Start Free">
                  Start free
                </button>
              </div>
              <div className="lm-price-col lm-price-col-pro">
                <h3>Pro</h3>
                <p className="lm-price-amount">
                  ${PRICING.monthly}<span className="lm-price-per">/month</span>
                </p>
                <p className="lm-price-alt">or ${PRICING.yearly}/year — two months free</p>
                <ul>
                  {PRO_FEATURES.map((f) => <li key={f}>{f}</li>)}
                </ul>
                <button className="lm-btn lm-btn-primary" type="button" onClick={onOpenEditor} data-track="Pricing: Go Pro">
                  Start free, upgrade in-app
                </button>
              </div>
            </div>
            <p className="lm-cta-pricing">
              Every account created before paid plans launched keeps full Pro access, permanently.
              Checkout by Stripe; cancel anytime.
            </p>
          </div>
        </section>

        {/* ── Final CTA ──────────────────────────────────────────── */}
        <section className="lm-cta lm-reveal" data-section="bottom-cta">
          <div className="lm-section-inner">
            <h2 className="lm-h2">Put your claims on a map.</h2>
            <div className="lm-hero-ctas">
              <button className="lm-btn lm-btn-primary" type="button" onClick={onOpenEditor} data-track="Bottom CTA: Start Mapping">
                Start Mapping
              </button>
              <button className="lm-btn lm-btn-ghost" type="button" onClick={() => scrollTo('examples')} data-track="Bottom CTA: View Example Maps">
                View example maps
              </button>
            </div>
            <p className="lm-cta-pricing">
              A free account saves your projects and your brand kit. Pro removes the watermark and
              unlocks HD, SVG and PDF export.
            </p>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="lm-footer" data-section="footer">
        <div className="lm-footer-inner">
          <div className="lm-footer-brand">
            <div className="lm-wordmark">
              <BrandMark size={24} />
              <span className="em-wordmark">Exploration&nbsp;<b>Maps</b></span>
            </div>
            <p>Claim, drill and infrastructure maps for mineral exploration teams.</p>
          </div>
          <div className="lm-footer-col">
            <h3>Product</h3>
            <button type="button" onClick={() => scrollTo('features')}>Features</button>
            <button type="button" onClick={() => scrollTo('examples')}>Examples</button>
            <button type="button" onClick={() => scrollTo('pricing')}>Pricing</button>
            {onShowHelp && <button type="button" onClick={onShowHelp}>How to use</button>}
          </div>
          <div className="lm-footer-col">
            <h3>Popular tools</h3>
            <a href="/mining-map-software/">Mining map software</a>
            <a href="/bc-mineral-claims-map/">BC claims map</a>
            <a href="/mining-claim-search-by-company-name/">Claim search by company</a>
            <a href="/drill-results-map/">Drill results map</a>
          </div>
          <div className="lm-footer-col">
            <h3>Company</h3>
            <a href="/about/">About</a>
            <a href="/blog/">Guides</a>
            <a href="/contact/">Contact</a>
            {onOpenTenureMonitor && (
              <button type="button" onClick={onOpenTenureMonitor}>Tenure Monitor</button>
            )}
            {user ? (
              <button type="button" onClick={onOpenAccount}>Dashboard</button>
            ) : (
              <button type="button" onClick={() => setShowAuth(true)}>Sign in / Sign up free</button>
            )}
          </div>
        </div>
        <div className="lm-footer-base">
          © {new Date().getFullYear()} Exploration Maps · <a href="/privacy/">Privacy</a>
        </div>
      </footer>
    </div>
  );
}
