import React, { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';

const GALLERY_STYLES = [
  { id: 'drill_plan',   label: 'Drill Results',    desc: 'Collars, intercepts & target rings',     accent: '#2563eb', bg: '#1a2535', water: '#0f172a', img: '/gallery/drill-results.png' },
  { id: 'claims',       label: 'Claims Package',   desc: 'Mineral tenures & land position',        accent: '#16a34a', bg: '#f0fdf4', water: '#dcfce7', img: '/gallery/claims.png' },
  { id: 'target',       label: 'Target Generation',desc: 'Anomaly areas & priority zones',         accent: '#dc2626', bg: '#fef2f2', water: '#fee2e2', img: '/gallery/target.png' },
  { id: 'regional',     label: 'Regional Context', desc: 'Property location in the district',      accent: '#b87333', bg: '#fef9ee', water: '#fde68a', img: '/gallery/regional.png' },
  { id: 'infrastructure', label: 'Infrastructure', desc: 'Access routes, roads & power lines',     accent: '#7c3aed', bg: '#f5f3ff', water: '#ede9fe', img: '/gallery/infrastructure.png' },
  { id: 'dark',         label: 'Dark Satellite',   desc: 'Satellite basemap, high contrast',       accent: '#60a5fa', bg: '#0f172a', water: '#1e3a5f', img: '/gallery/dark.png' },
];
import { useAuth } from '../hooks/useAuth.jsx';
import AuthModal from './AuthModal';

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

export default function LandingPage({ onOpenEditor, onLoadSample, onLoadSampleStyle, recentProjects = [], onOpenProject, onShowHelp, onSearchBCClaims, onUploadFile }) {
  const { user } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [dataSourcesOpen, setDataSourcesOpen] = useState(false);
  const clickThrottleRef = useRef(0);

  function handleLandingClick(e) {
    const now = Date.now();
    if (now - clickThrottleRef.current < 500) return;
    clickThrottleRef.current = now;
    if (!supabase) return;
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
    const viewport_w = window.innerWidth;
    const page_h = document.body.scrollHeight;
    supabase.from('landing_clicks').insert({ x_pct, y_pct, element, viewport_w, page_h }).then(() => {});
  }

  return (
    <div className="landing-shell" onClick={handleLandingClick}>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      <nav className="landing-nav">
        <div className="landing-wordmark">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#2563eb" />
          </svg>
          Exploration Maps
        </div>
        <div className="landing-nav-actions">
          {onShowHelp && (
            <button className="landing-how-to-link" type="button" onClick={onShowHelp} data-track="Nav: How to use">
              How to use →
            </button>
          )}
          {user ? (
            <span className="landing-nav-user">
              <span className="landing-nav-avatar">{user.email?.slice(0, 2).toUpperCase() ?? '??'}</span>
              {user.email}
            </span>
          ) : (
            <button className="landing-nav-signin" type="button" onClick={() => setShowAuth(true)} data-track="Nav: Sign in">
              Sign in
            </button>
          )}
          <button className="btn primary" type="button" onClick={onOpenEditor} data-track="Nav: Try for Free">
            Try for Free
          </button>
        </div>
      </nav>

      <main>

      {/* Hero — centered, simple */}
      <div className="landing-hero2" data-section="hero">
        <div className="landing-hero2-tagline">Raw data in. Investor map out.</div>
        <h1 className="landing-hero2-h1">Turn raw exploration data into clean investor maps.</h1>
        <p className="landing-hero2-sub">
          Search the registry or import your files, then export a presentation-ready map
          in under five minutes — no GIS required.
        </p>

        <div className="landing-hero2-ctas" data-section="hero-ctas">
          {onSearchBCClaims && (
            <button className="landing-hero2-primary" type="button" onClick={onSearchBCClaims} data-track="CTA: Search Claims Registry">
              Search the Claims Registry
              <span className="landing-hero2-primary-sub">By name or claim number · BC · Ontario · Saskatchewan · Yukon</span>
            </button>
          )}
          <div className="landing-hero2-secondary-row">
            {onUploadFile && (
              <button className="landing-hero2-secondary" type="button" onClick={onUploadFile} data-track="CTA: Upload a File">
                Upload a Shapefile
              </button>
            )}
            <button className="landing-hero2-secondary" type="button" onClick={() => { if (onLoadSampleStyle) onLoadSampleStyle('drill_plan'); else onOpenEditor(); }} data-track="CTA: Try sample">
              See an Example
            </button>
          </div>
          <p className="landing-trust-strip">Free · No account · Works in your browser</p>
        </div>
      </div>

      {/* Before / After */}
      <div className="landing-ba" data-section="before-after">
        <div className="landing-ba-panel landing-ba-before">
          <div className="landing-ba-tag">Raw export</div>
          <img src="/gallery/ba-before.png" alt="Raw GIS export — unstyled claims outline on topo basemap" className="landing-ba-img" />
        </div>

        <div className="landing-ba-arrow" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14m0 0l-5-5m5 5l-5 5" stroke="#2563eb" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <div className="landing-ba-panel landing-ba-after">
          <div className="landing-ba-tag landing-ba-tag-after">Investor map</div>
          <button type="button" className="landing-ba-map-btn" onClick={() => onLoadSampleStyle?.('claims')} data-track="Before/After: open sample">
            <img src="/gallery/ba-after.png" alt="Cedar Ridge Project — professional investor map with logo, callouts, and legend" className="landing-ba-img" />
          </button>
        </div>
      </div>

      {/* Three steps, one line each */}
      <section className="landing-flow-section" data-section="flow">
        <div className="landing-flow-heading">Three steps. Under five minutes.</div>
        <div className="landing-flow">
          <div className="landing-flow-item">
            <span className="landing-flow-num">1</span>
            <strong>Find</strong>
            <span>Search claims by name or claim number, or upload your own files.</span>
          </div>
          <div className="landing-flow-item">
            <span className="landing-flow-num">2</span>
            <strong>Style</strong>
            <span>Pick a template. Add callouts, rings, and your logo.</span>
          </div>
          <div className="landing-flow-item">
            <span className="landing-flow-num">3</span>
            <strong>Export</strong>
            <span>PNG, SVG, or PDF — ready for the deck or the report.</span>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="landing-who" data-section="who">
        <p>
          Built for <strong>geologists</strong>, <strong>IR teams</strong>, and <strong>consultants</strong> who
          need a clean map today — not another GIS project.
        </p>
      </section>

      {/* Map gallery */}
      <section className="landing-gallery">
        <div className="landing-gallery-heading">Six map styles. One click.</div>
        <p className="landing-gallery-sub">Click any style to try it with sample data.</p>
        <div className="landing-gallery-grid">
          {GALLERY_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              className="landing-gallery-card"
              onClick={() => onLoadSampleStyle ? onLoadSampleStyle(style.id) : onLoadSample?.()}
              data-track={`Gallery: ${style.label}`}
            >
              <div className="landing-gallery-mock" style={style.img ? undefined : { background: style.bg }}>
                {style.img
                  ? <img src={style.img} alt={style.label} className="landing-gallery-preview-img" />
                  : <>
                      <div className="landing-gallery-mock-claim" style={{ borderColor: style.accent }} />
                      <div className="landing-gallery-mock-ring" style={{ borderColor: style.accent }} />
                      <div className="landing-gallery-mock-dot" style={{ background: style.accent }} />
                      <div className="landing-gallery-mock-title" style={{ background: style.accent + '22', borderLeft: `3px solid ${style.accent}` }} />
                    </>
                }
              </div>
              <div className="landing-gallery-card-body">
                <div className="landing-gallery-card-label">{style.label}</div>
                <div className="landing-gallery-card-desc">{style.desc}</div>
                <div className="landing-gallery-card-cta" style={{ color: style.accent }}>Try this style →</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* What's included — compact checklist */}
      <section className="landing-included" data-section="included">
        <div className="landing-included-heading">What's included</div>
        <ul className="landing-included-list">
          <li>Live claim search — BC, Ontario, Saskatchewan, Yukon</li>
          <li>Shapefile, GeoJSON, KML &amp; CSV import</li>
          <li>Drillhole callouts with assay labels</li>
          <li>Distance rings, inset map, scale bar, north arrow</li>
          <li>Your logo and colors on every map</li>
          <li>PNG, SVG &amp; PDF export up to 3× resolution</li>
        </ul>
      </section>

      {/* FAQ */}
      <section className="landing-faq" data-section="faq">
        <div className="landing-faq-heading">Common questions</div>
        <div className="landing-faq-grid">
          <div className="landing-faq-item">
            <strong>Is it free?</strong>
            <span>Yes. Search, style, and export — all free. Watermark-free exports just ask for your email.</span>
          </div>
          <div className="landing-faq-item">
            <strong>Do I need an account?</strong>
            <span>No. Sign in only if you want cloud saves and a reusable company template.</span>
          </div>
          <div className="landing-faq-item">
            <strong>Where does the claims data come from?</strong>
            <span>Live from each government registry the moment you search. Nothing cached or out of date.</span>
          </div>
          <div className="landing-faq-item">
            <strong>Is my data private?</strong>
            <span>Uploaded files stay in your browser unless you choose to save to the cloud.</span>
          </div>
        </div>
      </section>

      {/* Data sources guide */}
      <section className="landing-data-sources">
        <button
          type="button"
          className="landing-ds-toggle"
          onClick={() => setDataSourcesOpen((o) => !o)}
          aria-expanded={dataSourcesOpen}
        >
          <span>Where to find mining map data</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ transform: dataSourcesOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {dataSourcesOpen && (
          <div className="landing-ds-body">
            <div className="landing-ds-intro">
              Exploration Maps accepts <strong>GeoJSON</strong>, <strong>Shapefile (.zip or .shp+.dbf)</strong>, <strong>KML/KMZ</strong>, and <strong>CSV</strong> drillhole tables. Here are the best free sources by jurisdiction.
            </div>
            <div className="landing-ds-grid">
              <div className="landing-ds-region">
                <div className="landing-ds-region-name">🇨🇦 Canada</div>
                <ul className="landing-ds-list">
                  <li><strong>BC Mineral Titles Online (MTO)</strong> — mineral claims, coal licenses. Export as Shapefile. <a href="https://www.mtonline.gov.bc.ca" target="_blank" rel="noopener noreferrer">mtonline.gov.bc.ca</a></li>
                  <li><strong>Ontario MLAS</strong> — mining claims, mining lands. <a href="https://www.ontario.ca/page/mining-lands-administration-system" target="_blank" rel="noopener noreferrer">ontario.ca/MLAS</a></li>
                  <li><strong>Saskatchewan MARS</strong> — mineral dispositions. <a href="https://mars.isc.ca" target="_blank" rel="noopener noreferrer">mars.isc.ca</a></li>
                  <li><strong>GeoYukon</strong> — quartz &amp; placer claims. <a href="https://mapservices.gov.yk.ca/GeoYukon/" target="_blank" rel="noopener noreferrer">mapservices.gov.yk.ca</a></li>
                  <li><strong>NRCan Open Government</strong> — geology, roads, boundaries. <a href="https://open.canada.ca/en/open-data" target="_blank" rel="noopener noreferrer">open.canada.ca</a></li>
                </ul>
              </div>
              <div className="landing-ds-region">
                <div className="landing-ds-region-name">🇦🇺 Australia</div>
                <ul className="landing-ds-list">
                  <li><strong>Geoscience Australia</strong> — national geology, mineral deposits. <a href="https://www.ga.gov.au" target="_blank" rel="noopener noreferrer">ga.gov.au</a></li>
                  <li><strong>MineralMap.ga.gov.au</strong> — interactive, export GeoJSON.</li>
                  <li><strong>State Surveys</strong> — GSWA (WA), DPIR (NT), GSNSW (NSW) each have open-data portals for tenements and geology.</li>
                </ul>
              </div>
              <div className="landing-ds-region">
                <div className="landing-ds-region-name">🌍 Global / Other</div>
                <ul className="landing-ds-list">
                  <li><strong>OpenStreetMap</strong> via <a href="https://overpass-turbo.eu" target="_blank" rel="noopener noreferrer">Overpass Turbo</a> — roads, settlements, railways as GeoJSON.</li>
                  <li><strong>USGS National Map</strong> — US geology, boundaries. <a href="https://nationalmap.gov" target="_blank" rel="noopener noreferrer">nationalmap.gov</a></li>
                  <li><strong>Natural Earth</strong> — country/province boundaries, rivers, roads. <a href="https://naturalearthdata.com" target="_blank" rel="noopener noreferrer">naturalearthdata.com</a></li>
                </ul>
              </div>
            </div>
            <div className="landing-ds-tip">
              <strong>Pro tip:</strong> Export claims as Shapefile, then drag all 4 files (<code>.shp</code>, <code>.dbf</code>, <code>.prj</code>, <code>.shx</code>) onto the upload area at once — no zipping needed.
            </div>
          </div>
        )}
      </section>

      {recentProjects.length > 0 && (
        <div className="landing-recent">
          <div className="landing-recent-heading">Recent projects</div>
          <div className="landing-recent-grid">
            {recentProjects.slice(0, 3).map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="landing-recent-card"
                onClick={() => onOpenProject(entry)}
              >
                <div className="landing-recent-name">{entry.name || 'Untitled map'}</div>
                <div className="landing-recent-date">{formatRelativeDate(entry.updatedAt)}</div>
                <div className="landing-recent-continue">Continue →</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <section className="landing-bottom-cta" data-section="bottom-cta">
        <div className="landing-bottom-cta-inner">
          <div className="landing-bottom-cta-headline">Raw data in. Investor map out.</div>
          <div className="landing-bottom-cta-sub">Free · No account · Works in your browser</div>
          <div className="landing-bottom-cta-actions">
            {onSearchBCClaims && (
              <button className="landing-bottom-primary" onClick={onSearchBCClaims} data-track="Bottom CTA: Search Claims">
                Search the Claims Registry →
              </button>
            )}
            <button className="landing-bottom-ghost" onClick={onOpenEditor} data-track="Bottom CTA: Open Editor">
              Open the Editor
            </button>
          </div>
        </div>
      </section>

      </main>
      <footer className="landing-footer">
        <div className="landing-footer-links">
          <a href="/" className="landing-footer-link">Home</a>
          <span className="landing-footer-sep">·</span>
          <a href="/about/" className="landing-footer-link">About</a>
          <span className="landing-footer-sep">·</span>
          <a href="/blog/" className="landing-footer-link">Guides</a>
          <span className="landing-footer-sep">·</span>
          <a href="/privacy/" className="landing-footer-link">Privacy</a>
        </div>
        © {new Date().getFullYear()} Exploration Maps · Sign in to save projects to the cloud and access company templates.
      </footer>
    </div>
  );
}
