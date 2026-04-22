import React from 'react';

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
  return (
    <div className="landing-shell">
      <nav className="landing-nav">
        <div className="landing-wordmark">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#2563eb" />
          </svg>
          Exploration Maps
        </div>
        <button className="btn primary" type="button" onClick={onOpenEditor}>
          Open Editor
        </button>
      </nav>

      <div className="landing-hero">
        <div className="landing-card modern">
          <div className="landing-copy">
            <div className="landing-badge">Mining map production tool</div>
            <h1>Turn shapefiles into clean, presentation-ready mining maps in minutes</h1>
            <p>
              Upload your claims, drillholes, and target areas and get a polished, export-ready map — without
              touching QGIS, Illustrator, or spending an afternoon on formatting.
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
                <strong>Skip the GIS cleanup loop</strong>
                <span>No more exporting to Illustrator to fix labels and spacing. Legends, callouts, and layout stay clean inside the editor.</span>
              </div>
              <div className="landing-pain-card">
                <div className="landing-pain-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4v16l4-4 4 4 4-4 4 4V4" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <strong>Update claims in seconds</strong>
                <span>Drop in a revised shapefile and your map layout — title, inset, north arrow, scale bar — stays intact. No rebuild required.</span>
              </div>
              <div className="landing-pain-card">
                <div className="landing-pain-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3" stroke="#2563eb" strokeWidth="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
                <strong>Make the target area obvious</strong>
                <span>Add callouts, highlight zones, and a locator inset so reviewers and investors immediately understand the project area.</span>
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
                  <div className="mock-callout mock-callout-b">Au 2.4 g/t · 18m</div>
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
                <div className="mini-title">Import</div>
                <div className="mini-line" />
                <div className="mini-line short" />
              </div>
              <div className="landing-mini-card">
                <div className="mini-title">Annotate</div>
                <div className="mini-color-row">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
              <div className="landing-mini-card">
                <div className="mini-title">Export PNG / SVG</div>
                <div className="mini-button" />
              </div>
            </div>
          </div>
        </div>
      </div>

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
        © {new Date().getFullYear()} Exploration Maps · Built for junior mining and exploration companies
      </footer>
    </div>
  );
}
