import React from 'react';

export default function LandingPage({ onOpenEditor }) {
  return (
    <div className="landing-shell"> 
      <div className="landing-card modern"> 
        <div className="landing-copy"> 
          <div className="landing-badge">Built for mineral exploration teams</div>
          <h1>Stop rebuilding maps. Start presenting results.</h1>
          <p>
            Drop in your shapefiles and get a clean, export-ready map — complete with legends, callouts, and inset locators.
            No GIS cleanup, no Illustrator, no rebuilding from scratch when data changes.
          </p>

          <div className="landing-actions landing-actions-sticky">
            <button className="btn primary large" type="button" onClick={onOpenEditor}>
              Upload Your Data and Start
            </button>
          </div>

          <div className="landing-pain-grid">
            <div className="landing-pain-card">
              <strong>Export once. Look great every time.</strong>
              <span>Legends, callout boxes, north arrows, and scale bars stay consistent and correctly placed — what you see in the editor is exactly what exports to PNG or SVG.</span>
            </div>
            <div className="landing-pain-card">
              <strong>New data shouldn't mean a new map.</strong>
              <span>Swap in updated claims, drill results, or target boundaries and your layout, styling, and annotations stay intact. Spend your time on the geology, not the map.</span>
            </div>
            <div className="landing-pain-card">
              <strong>Make reviewers understand it before you say a word.</strong>
              <span>Callout boxes, highlight zones, and inset locator maps direct attention to what matters — so the result is obvious the moment the map lands in an inbox.</span>
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
