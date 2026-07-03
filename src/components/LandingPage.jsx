import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getSessionId } from '../utils/session';
import { useAuth } from '../hooks/useAuth.jsx';
import AuthModal from './AuthModal';

const SHOWCASE = [
  {
    id: 'regional',
    label: 'Regional project location map',
    desc: 'Property location in district context — nearby deposits, towns, and access.',
    img: '/gallery/regional.png',
    tags: ['Project boundary', 'Nearby deposits', 'Roads'],
  },
  {
    id: 'claims',
    label: 'Claims & tenure map',
    desc: 'Mineral tenures and land position, styled for decks and filings.',
    img: '/gallery/claims.png',
    tags: ['Claims', 'Project boundary', 'Labels'],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure & access map',
    desc: 'Roads, rail, and power around the project — the access story at a glance.',
    img: '/gallery/infrastructure.png',
    tags: ['Roads', 'Rail', 'Power'],
  },
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

/* Decorative hero map — a stylized product canvas: terrain, lake, contours,
   claim blocks, road/rail/power lines, and drill targets. Purely visual. */
function HeroMapArt() {
  return (
    <svg className="lm-map-art" viewBox="0 0 860 430" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="lmTerrain" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef3ec" />
          <stop offset="0.55" stopColor="#e7eee4" />
          <stop offset="1" stopColor="#e9ede8" />
        </linearGradient>
        <linearGradient id="lmLake" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d3e5f4" />
          <stop offset="1" stopColor="#c2d9ee" />
        </linearGradient>
      </defs>

      <rect width="860" height="430" fill="url(#lmTerrain)" />

      {/* contours */}
      <g fill="none" stroke="#c7d2c3" strokeWidth="1">
        <path d="M-20 96 C 140 40, 300 150, 470 100 S 760 40, 890 96" />
        <path d="M-20 150 C 150 96, 310 205, 480 152 S 770 92, 890 148" opacity="0.8" />
        <path d="M-20 320 C 130 268, 260 372, 430 330 S 700 260, 890 330" opacity="0.75" />
        <path d="M-20 375 C 150 322, 290 420, 470 378 S 720 320, 890 385" opacity="0.6" />
      </g>

      {/* lake */}
      <path d="M600 288 C 640 260, 720 262, 762 286 C 806 310, 812 352, 768 372 C 720 394, 640 390, 606 360 C 576 334, 568 310, 600 288 Z" fill="url(#lmLake)" stroke="#a9c6e2" strokeWidth="1.4" />
      <text x="686" y="334" fontSize="11.5" fill="#5c7ea0" fontStyle="italic" textAnchor="middle">Trout Lake</text>

      {/* road */}
      <path d="M-10 404 C 150 358, 250 320, 340 250 C 420 188, 520 160, 640 148 C 730 140, 800 118, 872 84" fill="none" stroke="#a8b0ba" strokeWidth="3.4" />
      <path d="M-10 404 C 150 358, 250 320, 340 250 C 420 188, 520 160, 640 148 C 730 140, 800 118, 872 84" fill="none" stroke="#fdfefe" strokeWidth="1.1" strokeDasharray="7 7" />
      <g transform="translate(196,340) rotate(-22)"><rect x="-26" y="-9" width="52" height="16" rx="3.5" fill="#ffffff" stroke="#c3cbd4" strokeWidth="0.8" /><text x="0" y="3.4" fontSize="9" fill="#4a5768" textAnchor="middle" fontWeight="600">Hwy 37</text></g>

      {/* rail */}
      <path d="M-10 246 C 130 236, 260 258, 380 300 C 470 332, 560 350, 700 352 L 872 350" fill="none" stroke="#7d8b99" strokeWidth="2" />
      <path d="M-10 246 C 130 236, 260 258, 380 300 C 470 332, 560 350, 700 352 L 872 350" fill="none" stroke="#7d8b99" strokeWidth="7" strokeDasharray="1.6 16" opacity="0.85" />
      <g transform="translate(560,364)"><rect x="-20" y="-8" width="40" height="15" rx="3.5" fill="#ffffff" stroke="#c3cbd4" strokeWidth="0.8" /><text x="0" y="3.4" fontSize="8.6" fill="#4a5768" textAnchor="middle" fontWeight="600">CN Rail</text></g>

      {/* power line */}
      <path d="M60 -8 L 140 92 L 232 176 L 330 236 L 440 280 L 566 306" fill="none" stroke="#3f9860" strokeWidth="1.8" strokeDasharray="10 4" />
      {[[140, 92], [232, 176], [330, 236], [440, 280]].map(([x, y], i) => (
        <g key={i}><line x1={x - 5} y1={y - 7} x2={x + 5} y2={y + 7} stroke="#3f9860" strokeWidth="1.6" /><line x1={x + 5} y1={y - 7} x2={x - 5} y2={y + 7} stroke="#3f9860" strokeWidth="1.6" /></g>
      ))}
      <g transform="translate(120,138)"><rect x="-28" y="-8" width="56" height="15" rx="3.5" fill="#ffffff" stroke="#bfd8c6" strokeWidth="0.8" /><text x="0" y="3.4" fontSize="8.6" fill="#2f7a4c" textAnchor="middle" fontWeight="600">138 kV line</text></g>

      {/* claim blocks */}
      <g stroke="#c2703d" strokeWidth="1.7" fill="#c2703d" fillOpacity="0.10">
        <rect x="332" y="118" width="86" height="66" />
        <rect x="418" y="118" width="86" height="66" />
        <rect x="332" y="184" width="86" height="66" />
        <rect x="418" y="184" width="86" height="66" />
        <rect x="504" y="151" width="86" height="66" />
        <rect x="270" y="151" width="62" height="66" />
      </g>
      <rect x="332" y="118" width="172" height="132" fill="none" stroke="#a4552a" strokeWidth="2.4" />
      <g transform="translate(418,106)"><rect x="-62" y="-11" width="124" height="18" rx="4" fill="#ffffff" stroke="#d9b9a2" strokeWidth="0.9" /><text x="0" y="2.8" fontSize="10" fill="#8a4a22" textAnchor="middle" fontWeight="700">CARIBOO RIDGE CLAIMS</text></g>

      {/* drill targets */}
      {[[398, 176], [452, 206], [478, 158]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="10" fill="none" stroke="#d33d3d" strokeWidth="1.6" strokeDasharray="3 2.4" />
          <circle cx={x} cy={y} r="3.2" fill="#d33d3d" />
        </g>
      ))}
      <g transform="translate(474,232)"><rect x="-38" y="-8" width="76" height="15" rx="3.5" fill="#ffffff" stroke="#e4b9b9" strokeWidth="0.8" /><text x="0" y="3.4" fontSize="8.6" fill="#b03030" textAnchor="middle" fontWeight="600">Drill targets</text></g>

      {/* project marker */}
      <g transform="translate(376,148)">
        <path d="M0 -16 C -7 -16 -12 -11 -12 -5 C -12 3 0 14 0 14 C 0 14 12 3 12 -5 C 12 -11 7 -16 0 -16 Z" fill="#2563eb" stroke="#ffffff" strokeWidth="1.6" />
        <circle cx="0" cy="-5.5" r="4" fill="#ffffff" />
      </g>

      {/* north + scale */}
      <g transform="translate(822,44)" opacity="0.9">
        <circle r="15" fill="#ffffff" stroke="#c9d2dc" strokeWidth="1" />
        <path d="M0 -9 L 4 5 L 0 2 L -4 5 Z" fill="#37475c" />
        <text x="0" y="12.6" fontSize="7.4" fill="#37475c" textAnchor="middle" fontWeight="700">N</text>
      </g>
      <g transform="translate(760,408)">
        <rect x="0" y="0" width="34" height="5" fill="#37475c" /><rect x="34" y="0" width="34" height="5" fill="#ffffff" stroke="#37475c" strokeWidth="0.9" />
        <text x="34" y="-4" fontSize="8.4" fill="#4a5768" textAnchor="middle">5 km</text>
      </g>
    </svg>
  );
}

export default function LandingPage({ onOpenEditor, onLoadSample, onLoadSampleStyle, recentProjects = [], onOpenProject, onShowHelp, onSearchBCClaims, onUploadFile, onOpenAccount }) {
  const { user } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
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
    supabase.from('landing_clicks').insert({ session_id: getSessionId(), x_pct, y_pct, element, viewport_w, page_h }).then(() => {});
  }

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="lm-shell" ref={rootRef} onClick={handleLandingClick}>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="lm-nav">
        <div className="lm-nav-inner">
          <div className="lm-wordmark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#2563eb" />
            </svg>
            Exploration Maps
          </div>
          <nav className="lm-nav-links" aria-label="Main">
            <button type="button" onClick={() => scrollTo('features')} data-track="Nav: Features">Features</button>
            <button type="button" onClick={() => scrollTo('use-cases')} data-track="Nav: Use Cases">Use Cases</button>
            <button type="button" onClick={() => scrollTo('examples')} data-track="Nav: Examples">Examples</button>
            <button type="button" onClick={() => scrollTo('pricing')} data-track="Nav: Pricing">Pricing</button>
            {user ? (
              <button type="button" onClick={onOpenAccount} data-track="Nav: Dashboard">Dashboard</button>
            ) : (
              <button type="button" onClick={() => setShowAuth(true)} data-track="Nav: Login">Login</button>
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
            <div className="lm-pill">
              <span className="lm-pill-dot" aria-hidden="true" />
              Mapping platform for mineral exploration
            </div>
            <h1 className="lm-h1">
              Exploration maps without the <span className="lm-h1-accent">GIS bottleneck.</span>
            </h1>
            <p className="lm-hero-sub">
              Search claims, plot projects, add infrastructure, style layers, and export
              polished maps for decks, websites, and investor updates.
            </p>
            <div className="lm-hero-ctas">
              <button className="lm-btn lm-btn-primary lm-btn-lg" type="button" onClick={onOpenEditor} data-track="Hero: Start Mapping">
                Start Mapping
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m0 0l-6-6m6 6l-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button className="lm-btn lm-btn-ghost lm-btn-lg" type="button" onClick={() => scrollTo('examples')} data-track="Hero: View Example Maps">
                View Example Maps
              </button>
            </div>
            <p className="lm-hero-trust">
              Built for mineral exploration teams, IR professionals, geologists, consultants, and mining executives.
            </p>
          </div>

          {/* ── Hero product mockup ─────────────────────────────── */}
          <div className="lm-mock-wrap" data-section="hero-mockup">
            <div className="lm-mock">
              <div className="lm-mock-chrome">
                <span className="lm-mock-dots" aria-hidden="true"><i /><i /><i /></span>
                <div className="lm-mock-url">explorationmaps.com — Cariboo Ridge Project</div>
                <div className="lm-mock-chrome-actions">
                  <span className="lm-mock-chip-btn">Share</span>
                  <span className="lm-mock-chip-btn lm-mock-chip-primary">Export</span>
                </div>
              </div>

              <div className="lm-mock-body">
                <HeroMapArt />

                {/* floating layer panel */}
                <div className="lm-float lm-layers-card">
                  <div className="lm-float-title">Layers</div>
                  {[
                    ['Claims', '#c2703d'],
                    ['Drill targets', '#d33d3d'],
                    ['Roads', '#8b95a1'],
                    ['Rail', '#66717e'],
                    ['Power', '#3f9860'],
                  ].map(([name, color]) => (
                    <div className="lm-layer-row" key={name}>
                      <span className="lm-layer-check" aria-hidden="true">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5 5L20 6.5" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                      <span className="lm-layer-swatch" style={{ background: color }} aria-hidden="true" />
                      {name}
                    </div>
                  ))}
                </div>

                {/* floating action chips */}
                <div className="lm-float lm-chip lm-chip-1">
                  <span className="lm-chip-ico" aria-hidden="true">⌕</span> Search claims
                </div>
                <div className="lm-float lm-chip lm-chip-2">
                  <span className="lm-chip-ico" aria-hidden="true">＋</span> Add infrastructure
                </div>
                <div className="lm-float lm-chip lm-chip-3">
                  <span className="lm-chip-ico" aria-hidden="true">◧</span> Style layers
                </div>
                <div className="lm-float lm-chip lm-chip-4 lm-chip-accent">
                  <span className="lm-chip-ico" aria-hidden="true">↧</span> Export investor-ready map
                </div>
              </div>

              {/* workflow / prompt bar */}
              <div className="lm-prompt">
                <div className="lm-prompt-line">
                  <svg className="lm-prompt-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="#64748b" strokeWidth="2"/><path d="M20 20l-3.5-3.5" stroke="#64748b" strokeWidth="2" strokeLinecap="round"/></svg>
                  <span className="lm-prompt-text">Map a rare earth project with nearby roads, rail, power, claims, and drill targets…</span>
                </div>
                <div className="lm-prompt-actions">
                  <button type="button" className="lm-prompt-chip" onClick={onUploadFile} data-track="Prompt: Attach CSV">Attach CSV</button>
                  <button type="button" className="lm-prompt-chip" onClick={onOpenEditor} data-track="Prompt: Select region">Select region</button>
                  <button type="button" className="lm-prompt-chip" onClick={onSearchBCClaims} data-track="Prompt: Add claims">Add claims</button>
                  <button type="button" className="lm-prompt-chip lm-prompt-chip-go" onClick={onOpenEditor} data-track="Prompt: Export map">
                    Export map
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m0 0l-6-6m6 6l-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {recentProjects.length > 0 && (
            <div className="lm-recent" data-section="recent">
              <span className="lm-recent-label">Pick up where you left off:</span>
              {recentProjects.slice(0, 3).map((entry) => (
                <button key={entry.id} type="button" className="lm-recent-chip" onClick={() => onOpenProject(entry)}>
                  {entry.name || 'Untitled map'}
                  <span>{formatRelativeDate(entry.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Problem ────────────────────────────────────────────── */}
        <section className="lm-section lm-reveal" data-section="problem">
          <div className="lm-section-inner">
            <p className="lm-eyebrow">The problem</p>
            <h2 className="lm-h2">Mining maps should not take days to make.</h2>
            <p className="lm-section-sub">
              Exploration teams often need maps quickly — for presentations, news releases, websites,
              investor calls, and internal planning. Traditional GIS workflows can be slow, technical,
              and dependent on external support.
            </p>
            <div className="lm-grid-3">
              <div className="lm-card">
                <div className="lm-card-ico" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#2563eb" strokeWidth="1.8"/><path d="M12 7v5l3.5 2" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round"/></svg>
                </div>
                <h3>Slow GIS turnaround</h3>
                <p>Waiting on map edits can delay decks, updates, and investor materials.</p>
              </div>
              <div className="lm-card">
                <div className="lm-card-ico" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="8" height="7" rx="1.5" stroke="#2563eb" strokeWidth="1.8"/><rect x="13" y="9" width="8" height="7" rx="1.5" stroke="#2563eb" strokeWidth="1.8"/><rect x="6" y="15" width="8" height="6" rx="1.5" stroke="#2563eb" strokeWidth="1.8"/></svg>
                </div>
                <h3>Messy public data</h3>
                <p>Claims, infrastructure, coordinates, and project data are scattered across different sources.</p>
              </div>
              <div className="lm-card">
                <div className="lm-card-ico" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="14" rx="2" stroke="#2563eb" strokeWidth="1.8"/><path d="M3 13l5-4 4 3 4-5 5 6" stroke="#2563eb" strokeWidth="1.8" strokeLinejoin="round"/><path d="M8 21h8" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round"/></svg>
                </div>
                <h3>Hard-to-edit visuals</h3>
                <p>Static map images are difficult to update when project data changes.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Workflow ───────────────────────────────────────────── */}
        <section className="lm-section lm-section-tint lm-reveal" data-section="workflow">
          <div className="lm-section-inner">
            <p className="lm-eyebrow">How it works</p>
            <h2 className="lm-h2">From project data to polished map in one workflow.</h2>
            <div className="lm-steps">
              <div className="lm-step">
                <div className="lm-step-num">1</div>
                <div className="lm-step-preview" aria-hidden="true">
                  <div className="lm-sp-search">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#94a3b8" strokeWidth="2.4"/><path d="M20 20l-3.5-3.5" stroke="#94a3b8" strokeWidth="2.4" strokeLinecap="round"/></svg>
                    <i style={{ width: '62%' }} />
                  </div>
                  <div className="lm-sp-row"><i style={{ width: '78%' }} /></div>
                  <div className="lm-sp-row"><i style={{ width: '54%' }} /></div>
                  <div className="lm-sp-file">CSV · KML · GeoJSON · SHP</div>
                </div>
                <h3>Search or upload</h3>
                <p>Search claims, companies, projects, or coordinates. Upload CSV, KML, GeoJSON, shapefiles, and more.</p>
              </div>
              <div className="lm-step">
                <div className="lm-step-num">2</div>
                <div className="lm-step-preview" aria-hidden="true">
                  <div className="lm-sp-layers">
                    <span style={{ background: '#c2703d' }} /><i style={{ width: '48%' }} />
                  </div>
                  <div className="lm-sp-layers">
                    <span style={{ background: '#3f9860' }} /><i style={{ width: '62%' }} />
                  </div>
                  <div className="lm-sp-layers">
                    <span style={{ background: '#d33d3d' }} /><i style={{ width: '40%' }} />
                  </div>
                  <div className="lm-sp-swatches"><b style={{ background: '#2563eb' }} /><b style={{ background: '#c2703d' }} /><b style={{ background: '#3f9860' }} /><b style={{ background: '#0f1b2d' }} /></div>
                </div>
                <h3>Style and layer</h3>
                <p>Add claim blocks, infrastructure, targets, labels, roads, rail, power, terrain, and more.</p>
              </div>
              <div className="lm-step">
                <div className="lm-step-num">3</div>
                <div className="lm-step-preview" aria-hidden="true">
                  <div className="lm-sp-doc">
                    <div className="lm-sp-doc-title" />
                    <div className="lm-sp-doc-map" />
                  </div>
                  <div className="lm-sp-formats"><b>PNG</b><b>SVG</b><b>PDF</b></div>
                </div>
                <h3>Export and share</h3>
                <p>Create clean visuals for presentations, websites, reports, social posts, and investor updates.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ───────────────────────────────────────────── */}
        <section className="lm-section lm-reveal" id="features" data-section="features">
          <div className="lm-section-inner">
            <p className="lm-eyebrow">Features</p>
            <h2 className="lm-h2">Everything a project map needs. Nothing you have to install.</h2>
            <div className="lm-grid-3 lm-feature-grid">
              {[
                ['Claim & tenure search', 'Quickly search and map mineral claims by company, region, or project.', <svg key="i" width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><rect x="8" y="8" width="6" height="6" stroke="currentColor" strokeWidth="1.5"/></svg>],
                ['Project location maps', 'Build polished location maps for decks, fact sheets, websites, and investor materials.', <svg key="i" width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-6.1 7-11a7 7 0 10-14 0c0 4.9 7 11 7 11z" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.8"/></svg>],
                ['Infrastructure layers', 'Add roads, rail, power, ports, airports, towns, and nearby projects.', <svg key="i" width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M4 19L19 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="4 3"/><path d="M4 8l6 6M14 4l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>],
                ['Data upload support', 'Import CSV, KML, KMZ, GeoJSON, shapefile, and coordinate-based data.', <svg key="i" width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0l-4.5 4.5M12 4l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>],
                ['Editable map styling', 'Adjust colours, labels, markers, layers, boundaries, and layout elements.', <svg key="i" width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 21a9 9 0 110-18c4.97 0 9 3.2 9 7.2 0 2.65-2.15 4.3-4.8 4.3H14a2 2 0 00-1.5 3.3c.32.37.5.8.5 1.2 0 1.1-.9 2-1 2z" stroke="currentColor" strokeWidth="1.8"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="11" cy="7.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/></svg>],
                ['Investor-ready exports', 'Export clean visuals for presentations, websites, reports, and news release graphics.', <svg key="i" width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.8"/><path d="M12 15V8m0 7l-3-3m3 3l3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 18h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>],
              ].map(([title, desc, icon]) => (
                <div className="lm-card lm-feature" key={title}>
                  <div className="lm-card-ico">{icon}</div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Use cases ──────────────────────────────────────────── */}
        <section className="lm-section lm-section-tint lm-reveal" id="use-cases" data-section="use-cases">
          <div className="lm-section-inner">
            <p className="lm-eyebrow">Use cases</p>
            <h2 className="lm-h2">Built for the way exploration teams actually use maps.</h2>
            <div className="lm-grid-2">
              {[
                ['Investor presentations', 'Create clean project maps for decks, financing materials, and investor calls.'],
                ['Website project pages', 'Build polished maps showing claims, access, infrastructure, and regional context.'],
                ['Exploration planning', 'Review targets, infrastructure, claim boundaries, and project data in one place.'],
                ['Consultant & IR workflows', 'Reduce back-and-forth between technical teams, designers, and GIS contractors.'],
              ].map(([title, desc], i) => (
                <div className="lm-card lm-usecase" key={title}>
                  <span className="lm-usecase-marker" aria-hidden="true">{['◈', '▣', '◎', '⇄'][i]}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Example showcase ───────────────────────────────────── */}
        <section className="lm-section lm-reveal" id="examples" data-section="examples">
          <div className="lm-section-inner">
            <p className="lm-eyebrow">Examples</p>
            <h2 className="lm-h2">Clean maps for real exploration workflows.</h2>
            <p className="lm-section-sub">Every example below was exported from Exploration Maps. Click one to open it with sample data.</p>
            <div className="lm-grid-3 lm-showcase">
              {SHOWCASE.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  className="lm-show-card"
                  onClick={() => (onLoadSampleStyle ? onLoadSampleStyle(ex.id) : onLoadSample?.())}
                  data-track={`Showcase: ${ex.label}`}
                >
                  <div className="lm-show-img"><img src={ex.img} alt={ex.label} loading="lazy" /></div>
                  <div className="lm-show-body">
                    <h3>{ex.label}</h3>
                    <p>{ex.desc}</p>
                    <div className="lm-show-tags">
                      {ex.tags.map((t) => <span key={t}>{t}</span>)}
                    </div>
                    <span className="lm-show-cta">Open this example →</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── Comparison ─────────────────────────────────────────── */}
        <section className="lm-section lm-section-tint lm-reveal" data-section="comparison">
          <div className="lm-section-inner">
            <p className="lm-eyebrow">Why switch</p>
            <h2 className="lm-h2">A faster alternative to the usual mapping workflow.</h2>
            <div className="lm-compare">
              <div className="lm-compare-col lm-compare-old">
                <h3>Traditional GIS workflow</h3>
                <ul>
                  <li>Send data to GIS or design support</li>
                  <li>Wait for map drafts</li>
                  <li>Request revisions</li>
                  <li>Re-export static files</li>
                  <li>Repeat whenever data changes</li>
                </ul>
              </div>
              <div className="lm-compare-col lm-compare-new">
                <div className="lm-compare-badge">Exploration Maps</div>
                <h3>One tool, in your browser</h3>
                <ul>
                  <li>Search or upload data</li>
                  <li>Edit layers directly</li>
                  <li>Update labels and styling</li>
                  <li>Export clean visuals</li>
                  <li>Share or revise anytime</li>
                </ul>
                <button className="lm-btn lm-btn-primary" type="button" onClick={onOpenEditor} data-track="Comparison: Start Mapping">
                  Start Mapping
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Final CTA ──────────────────────────────────────────── */}
        <section className="lm-cta lm-reveal" id="pricing" data-section="bottom-cta">
          <div className="lm-cta-inner">
            <h2 className="lm-h2">Start building cleaner exploration maps.</h2>
            <p className="lm-section-sub lm-cta-sub">
              Create project maps, claim maps, infrastructure maps, and investor-ready visuals from one simple platform.
            </p>
            <div className="lm-hero-ctas lm-cta-actions">
              <button className="lm-btn lm-btn-primary lm-btn-lg" type="button" onClick={onOpenEditor} data-track="Bottom CTA: Start Mapping">
                Start Mapping
              </button>
              <button className="lm-btn lm-btn-ghost-light lm-btn-lg" type="button" onClick={() => scrollTo('examples')} data-track="Bottom CTA: View Example Maps">
                View Example Maps
              </button>
            </div>
            <p className="lm-cta-pricing">Free during early access — no account needed to make your first map. Team plans coming soon.</p>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="lm-footer" data-section="footer">
        <div className="lm-footer-inner">
          <div className="lm-footer-brand">
            <div className="lm-wordmark">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#2563eb" />
              </svg>
              Exploration Maps
            </div>
            <p>Clean, editable, investor-ready maps for mineral exploration teams.</p>
          </div>
          <div className="lm-footer-col">
            <h4>Product</h4>
            <button type="button" onClick={() => scrollTo('features')}>Features</button>
            <button type="button" onClick={() => scrollTo('examples')}>Examples</button>
            <button type="button" onClick={() => scrollTo('pricing')}>Pricing</button>
            {onShowHelp && <button type="button" onClick={onShowHelp}>How to use</button>}
          </div>
          <div className="lm-footer-col">
            <h4>Popular tools</h4>
            <a href="/mining-map-software/">Mining map software</a>
            <a href="/bc-mineral-claims-map/">BC claims map</a>
            <a href="/mining-claim-search-by-company-name/">Claim search by company</a>
            <a href="/drill-results-map/">Drill results map</a>
          </div>
          <div className="lm-footer-col">
            <h4>Company</h4>
            <a href="/about/">About</a>
            <a href="/blog/">Guides</a>
            <a href="/contact/">Contact</a>
            {user ? (
              <button type="button" onClick={onOpenAccount}>Dashboard</button>
            ) : (
              <button type="button" onClick={() => setShowAuth(true)}>Login</button>
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
