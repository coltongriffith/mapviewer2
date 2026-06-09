import React, { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';

const GALLERY_STYLES = [
  { id: 'drill_plan',   label: 'Drill Results',    desc: 'Collars, assays & target rings',        accent: '#2563eb', bg: '#1a2535', water: '#0f172a', img: '/gallery/drill-results.png' },
  { id: 'claims',       label: 'Claims Overview',  desc: 'Mineral tenures & land packages',       accent: '#16a34a', bg: '#f0fdf4', water: '#dcfce7', img: '/gallery/claims.png' },
  { id: 'target',       label: 'Target Generation',desc: 'Anomaly areas & priority zones',        accent: '#dc2626', bg: '#fef2f2', water: '#fee2e2', img: '/gallery/target.png' },
  { id: 'regional',     label: 'Regional Location',desc: 'Project context in the district',       accent: '#b87333', bg: '#fef9ee', water: '#fde68a', img: '/gallery/regional.png' },
  { id: 'infrastructure', label: 'Infrastructure', desc: 'Roads, power lines & access routes',    accent: '#7c3aed', bg: '#f5f3ff', water: '#ede9fe', img: '/gallery/infrastructure.png' },
  { id: 'dark',         label: 'Dark Satellite',   desc: 'Satellite basemap, high contrast',      accent: '#60a5fa', bg: '#0f172a', water: '#1e3a5f', img: '/gallery/dark.png' },
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
    // Prefer explicit data-track label; fall back to button/link text; then section name
    const tracked = e.target.closest('[data-track]');
    const interactive = e.target.closest('button, a');
    let element = null;
    if (tracked) {
      element = tracked.dataset.track;
    } else if (interactive) {
      // Use aria-label or first meaningful child text (first strong/span child)
      const firstStrong = interactive.querySelector('strong');
      element = interactive.getAttribute('aria-label')
        || (firstStrong ? firstStrong.textContent.trim() : null)
        || interactive.textContent.trim().slice(0, 50);
    } else {
      // Record the landing section so background clicks still have context
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
      <div className="landing-hero">
        <div className="landing-card modern">
          <div className="landing-copy">
            <div className="landing-badge">Built for junior mining &amp; exploration</div>
            <h1>Professional mining maps in minutes — no GIS software required</h1>
            <p>
              Import a shapefile, search live claims registries across Canada, or start with sample data. Pick a template.
              Export a print-ready PNG, SVG, or PDF — completely free, no account required.
            </p>

            <div className="landing-hero-ctas" data-section="hero-ctas">
              {onSearchBCClaims && (
                <button className="landing-cta-btn landing-cta-primary landing-cta-dominant" type="button" onClick={onSearchBCClaims} data-track="CTA: Search Claims Registry">
                  <span className="landing-cta-icon">🔍</span>
                  <span>
                    <strong>Search Mineral Claims Registries</strong>
                    <span className="landing-cta-sub">BC · Ontario · Saskatchewan · Yukon — free, no signup</span>
                  </span>
                </button>
              )}
              <div className="landing-cta-secondary-row">
                {onUploadFile && (
                  <button className="landing-cta-btn" type="button" onClick={onUploadFile} data-track="CTA: Upload a File">
                    <span className="landing-cta-icon">📁</span>
                    <span><strong>Upload a File</strong></span>
                  </button>
                )}
                <button className="landing-cta-btn" type="button" onClick={() => { if (onLoadSampleStyle) onLoadSampleStyle('drill_plan'); else onOpenEditor(); }} data-track="CTA: Try sample">
                  <span className="landing-cta-icon">▶</span>
                  <span><strong>Try with sample data</strong></span>
                </button>
              </div>
              <p className="landing-trust-strip">Free to use · No account required · Works in your browser · Export PNG, SVG, PDF</p>
            </div>

            <div className="landing-pain-grid">
              <div className="landing-pain-card">
                <div className="landing-pain-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h10" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
                <strong>No GIS software needed</strong>
                <span>Import a shapefile or GeoJSON — claims, drillholes, and faults render instantly. No QGIS, no Illustrator round-trips.</span>
              </div>
              <div className="landing-pain-card">
                <div className="landing-pain-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4v16l4-4 4 4 4-4 4 4V4" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <strong>Update in seconds, not hours</strong>
                <span>Drop in a revised shapefile. Title block, legend, north arrow, and callouts all stay in place.</span>
              </div>
              <div className="landing-pain-card">
                <div className="landing-pain-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="#2563eb" strokeWidth="2"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="#2563eb" strokeWidth="2"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="#2563eb" strokeWidth="2"/><rect x="14" y="14" width="7" height="7" rx="1.5" stroke="#2563eb" strokeWidth="2"/></svg>
                </div>
                <strong>Looks right the first time</strong>
                <span>5 mining-specific templates and themes designed for investor decks and technical reports.</span>
              </div>
            </div>
          </div>

          <div className="landing-visuals">
            <div className="landing-window main">
              <div className="landing-window-bar">
                <span />
                <span />
                <span />
                <div className="landing-window-url">explorationmaps.com</div>
              </div>
              <img
                src="/gallery/drill-results.png"
                alt="Drill results map with callouts and target rings — made with Exploration Maps"
                className="landing-hero-screenshot"
              />
            </div>

            <div className="landing-gallery-thumbs">
              {['claims', 'target', 'dark'].map(id => {
                const s = GALLERY_STYLES.find(g => g.id === id);
                return (
                  <button key={id} type="button" className="landing-thumb-btn"
                    onClick={() => onLoadSampleStyle?.(id)}
                    data-track={`Hero thumb: ${s.label}`}>
                    <img src={s.img} alt={s.label} className="landing-thumb-img" />
                    <span className="landing-thumb-label">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Example map gallery — moved above "How it works" */}
      <section className="landing-gallery">
        <div className="landing-gallery-heading">Real maps made with Exploration Maps</div>
        <p className="landing-gallery-sub">Click any style to try it free — no account needed.</p>
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

      {/* How it works */}
      <section className="landing-steps">
        <div className="landing-steps-heading">How it works</div>
        <div className="landing-steps-row">
          <div className="landing-step">
            <div className="landing-step-num">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v16M4 12h16" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round"/><path d="M4 8l4-4m-4 4l4 4" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div className="landing-step-title">1 · Import</div>
            <div className="landing-step-desc">Drop in a shapefile, GeoJSON, or load the built-in sample. Claims, drillholes, faults, and roads all auto-detect their role.</div>
          </div>
          <div className="landing-step-connector" />
          <div className="landing-step">
            <div className="landing-step-num">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="#2563eb" strokeWidth="2"/><path d="M9 12l2 2 4-4" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div className="landing-step-title">2 · Style &amp; Annotate</div>
            <div className="landing-step-desc">Pick a template and theme. Add drillhole callouts with assay data, distance rings, a locator inset, and your company logo.</div>
          </div>
          <div className="landing-step-connector" />
          <div className="landing-step">
            <div className="landing-step-num">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v12m0 0l-4-4m4 4l4-4" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 20h16" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/></svg>
            </div>
            <div className="landing-step-title">3 · Export</div>
            <div className="landing-step-desc">Export PNG, SVG, or PDF at up to 3× resolution. Watermark-free exports ask for your email — no password, no subscription, remembered for next time.</div>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="landing-features">
        <div className="landing-features-heading">Everything a field geologist needs</div>
        <div className="landing-features-grid">
          <div className="landing-feature-card">
            <div className="landing-feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" stroke="#2563eb" strokeWidth="2"/><path d="M3 9h18M9 21V9" stroke="#2563eb" strokeWidth="2"/></svg>
            </div>
            <div className="landing-feature-title">5 Mining Templates</div>
            <div className="landing-feature-desc">Regional Location, Claims, Drill Results, Target Generation, and Infrastructure — ready to go out of the box.</div>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#2563eb"/></svg>
            </div>
            <div className="landing-feature-title">Drillhole Callouts</div>
            <div className="landing-feature-desc">Click any drill point to add a leader label or badge callout with assay data — "Au 4.2 g/t · 18m" — exactly as it should look in the deck.</div>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2a9 9 0 100 18A9 9 0 0012 2z" stroke="#2563eb" strokeWidth="2"/><path d="M12 8v4l3 3" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/></svg>
            </div>
            <div className="landing-feature-title">Cloud Save &amp; Templates</div>
            <div className="landing-feature-desc">Sign in to save projects to the cloud and store a company template that's applied to every new map your team creates.</div>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v12m0 0l-4-4m4 4l4-4" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 20h16" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/></svg>
            </div>
            <div className="landing-feature-title">Multi-format Export</div>
            <div className="landing-feature-desc">PNG, SVG, and PDF at 1×, 2×, or 3× resolution. Print-ready for technical reports or pixel-perfect for investor decks.</div>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" stroke="#2563eb" strokeWidth="2"/><path d="M3 9h18" stroke="#2563eb" strokeWidth="2"/></svg>
            </div>
            <div className="landing-feature-title">Logo &amp; Branding</div>
            <div className="landing-feature-desc">Upload your company logo once and it auto-populates on every map. Adjust size, corner placement, and theme colors to match your brand.</div>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="#2563eb" strokeWidth="2"/><circle cx="12" cy="12" r="9" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="4 3"/></svg>
            </div>
            <div className="landing-feature-title">Distance Rings &amp; Regions</div>
            <div className="landing-feature-desc">Draw geo-accurate distance rings from a target, highlight provinces, and layer on reference roads, labels, and railways.</div>
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
          <div className="landing-bottom-cta-headline">Ready to make your first map?</div>
          <div className="landing-bottom-cta-sub">Free · No account required · Works in your browser</div>
          <div className="landing-bottom-cta-actions">
            {onSearchBCClaims && (
              <button className="landing-bottom-primary" onClick={onSearchBCClaims} data-track="Bottom CTA: Search Claims">
                Search Mineral Claims Registries
              </button>
            )}
            <button className="landing-bottom-ghost" onClick={onOpenEditor} data-track="Bottom CTA: Open Editor">
              Open Editor with Sample Data →
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
