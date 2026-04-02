import React from 'react';

export default function LandingPage({ onOpenEditor, onLoadDemo }) {
  return (
    <div className="landing-shell"> 
      <div className="landing-card modern"> 
        <div className="landing-copy"> 
          <div className="landing-badge">Map production for exploration data</div>
          <h1>Build presentation-ready project maps from shapefiles in minutes.</h1>
          <p>
            Replace slow GIS cleanup and one-off design work with a focused editor for claims, drillholes, targets,
            inset maps, and export-ready layouts.
          </p>

          <div className="landing-actions landing-actions-sticky">
            <button className="btn primary large" type="button" onClick={onOpenEditor}>
              Open Map Editor
            </button>
            {onLoadDemo && (
              <button className="btn large" type="button" onClick={onLoadDemo}>
                Try Demo
              </button>
            )}
          </div>

          <div className="landing-pain-grid"> 
            <div className="landing-pain-card"> 
              <strong>Too much cleanup after export</strong>
              <span>Fix inconsistent legends, labels, spacing, and callouts in one place before the map leaves the editor.</span>
            </div>
            <div className="landing-pain-card"> 
              <strong>Maps are slow to update</strong>
              <span>Drop in revised claims or drillholes and keep the visual layout intact instead of rebuilding from scratch.</span>
            </div>
            <div className="landing-pain-card"> 
              <strong>Hard to make the story obvious</strong>
              <span>Use callouts, highlight zones, markers, inset maps, and cleaner framing to show what matters quickly.</span>
            </div>
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
                <div className="mock-callout mock-callout-a">Target Area</div>
                <div className="mock-callout mock-callout-b">Drill Result</div>
                <div className="mock-ellipse" />
                <div className="mock-inset" />
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
              <div className="mini-title">Export</div>
              <div className="mini-button" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
