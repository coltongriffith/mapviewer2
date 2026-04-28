import React, { useState } from 'react';
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

export default function LandingPage({ onOpenEditor, onLoadSample, recentProjects = [], onOpenProject }) {
  const { user } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  return (
    <div className="landing-shell">
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      <nav className="landing-nav">
        <div className="landing-wordmark">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#2563eb" />
          </svg>
          Exploration Maps
        </div>
        <div className="landing-nav-actions">
          {user ? (
            <span className="landing-nav-user">
              <span className="landing-nav-avatar">{user.email?.slice(0, 2).toUpperCase() ?? '??'}</span>
              {user.email}
            </span>
          ) : (
            <button className="landing-nav-signin" type="button" onClick={() => setShowAuth(true)}>
              Sign in
            </button>
          )}
          <button className="btn primary" type="button" onClick={onOpenEditor}>
            Open Editor
          </button>
        </div>
      </nav>

      <div className="landing-hero">
        <div className="landing-card modern">
          <div className="landing-copy">
            <div className="landing-badge">Built for junior mining &amp; exploration</div>
            <h1>Investor-ready exploration maps — without the GIS headache</h1>
            <p>
              Upload your claims, drillholes, and targets. Pick a template. Export a polished
              PNG, SVG, or PDF — in minutes, not an afternoon.
            </p>

            <div className="landing-actions landing-actions-sticky">
              <button className="btn primary large" type="button" onClick={onOpenEditor}>
                Open Map Editor
              </button>
              {onLoadSample && (
                <button className="btn sample-btn" type="button" onClick={onLoadSample}>
                  Try with sample data →
                </button>
              )}
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
              <div className="landing-map-mock">
                <div className="mock-sidebar">
                  <div className="mock-sb-logo" />
                  <div className="mock-sb-line" />
                  <div className="mock-sb-line short" />
                  <div className="mock-sb-divider" />
                  <div className="mock-sb-line" />
                  <div className="mock-sb-line med" />
                  <div className="mock-sb-line short" />
                  <div className="mock-sb-divider" />
                  <div className="mock-sb-line med" />
                  <div className="mock-sb-line short" />
                </div>
                <div className="mock-map-area">
                  <div className="mock-claim claim-a" />
                  <div className="mock-claim claim-b" />
                  <div className="mock-ellipse" />
                  <div className="mock-drillhole dh-a" />
                  <div className="mock-drillhole dh-b" />
                  <div className="mock-drillhole dh-c" />
                  <div className="mock-drillhole dh-d" />
                  <div className="mock-callout mock-callout-a">Target Area</div>
                  <div className="mock-badge-callout">
                    <span className="mock-badge-chip">Au 4.2</span>
                    <span className="mock-badge-text">Hole DH-07</span>
                  </div>
                  <div className="mock-inset" />
                  <div className="mock-north-arrow">N</div>
                  <div className="mock-title-block">
                    <div className="mock-tb-line title" />
                    <div className="mock-tb-line subtitle" />
                  </div>
                  <div className="mock-legend">
                    <div className="mock-legend-row">
                      <span className="mock-legend-swatch claims" />
                      <span className="mock-legend-label" />
                    </div>
                    <div className="mock-legend-row">
                      <span className="mock-legend-swatch drillholes" />
                      <span className="mock-legend-label short" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="landing-mini-grid">
              <div className="landing-mini-card">
                <div className="mini-title">5 Templates</div>
                <div className="mini-line" />
                <div className="mini-line short" />
              </div>
              <div className="landing-mini-card">
                <div className="mini-title">Badge Callouts</div>
                <div className="mini-color-row">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
              <div className="landing-mini-card">
                <div className="mini-title">PDF Export</div>
                <div className="mini-button" />
              </div>
            </div>
          </div>
        </div>
      </div>

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
            <div className="landing-step-desc">Export PNG, SVG, or PDF at up to 3× resolution. Deck-ready in one click — no post-processing in Illustrator.</div>
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

      <footer className="landing-footer">
        © {new Date().getFullYear()} Exploration Maps · Sign in to save projects to the cloud and access company templates.
      </footer>
    </div>
  );
}
