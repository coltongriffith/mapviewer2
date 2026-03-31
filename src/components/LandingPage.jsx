import React from 'react';

export default function LandingPage({ onOpenEditor }) {
  return (
    <div className="landing-shell">
      <div className="landing-card modern">
        <div className="landing-copy">
          <div className="landing-badge">Fast map production for exploration teams</div>
          <h1>Turn shapefiles into polished project maps without a slow GIS workflow.</h1>
          <p>
            Build cleaner maps for presentations, technical summaries, websites, and financing materials.
            Upload claims and drillholes, add callouts and highlight zones, then export a map that is ready to show.
          </p>

          <div className="landing-pain-grid">
            <div className="landing-pain-card">
              <strong>Too much manual cleanup</strong>
              <span>Fix inconsistent labels, spacing, legends, and callouts in one editor.</span>
            </div>
            <div className="landing-pain-card">
              <strong>Maps are hard to update quickly</strong>
              <span>Drop in fresh claims or drillholes and keep the layout presentation-ready.</span>
            </div>
            <div className="landing-pain-card">
              <strong>Technical data is hard to present clearly</strong>
              <span>Use markers, ellipses, inset maps, and editable styling to make the story obvious.</span>
            </div>
          </div>

          <div className="landing-actions">
            <button className="btn primary large" type="button" onClick={onOpenEditor}>
              Open Map Editor
            </button>
          </div>
        </div>

        <div className="landing-visuals">
          <div className="landing-window main">
            <div className="landing-window-bar">
              <span />
              <span />
              <span />
            </div>
            <div className="landing-map-mock">
              <div className="mock-sidebar" />
              <div className="mock-map-area">
                <div className="mock-claim claim-a" />
                <div className="mock-claim claim-b" />
                <div className="mock-callout mock-callout-a">Main Zone</div>
                <div className="mock-callout mock-callout-b">Drill Result</div>
                <div className="mock-ellipse" />
                <div className="mock-inset" />
              </div>
            </div>
          </div>
          <div className="landing-mini-grid">
            <div className="landing-mini-card">
              <div className="mini-title">Upload</div>
              <div className="mini-line" />
              <div className="mini-line short" />
            </div>
            <div className="landing-mini-card">
              <div className="mini-title">Style</div>
              <div className="mini-color-row">
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="landing-mini-card">
              <div className="mini-title">Export</div>
              <div className="mini-button" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
