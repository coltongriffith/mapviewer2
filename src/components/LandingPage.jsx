import React from 'react';

export default function LandingPage({ onOpenEditor }) {
  return (
    <div className="landing-shell"> 
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
          </div>

          <div className="landing-pain-grid">
            <div className="landing-pain-card">
              <strong>Skip the GIS cleanup loop</strong>
              <span>No more exporting to Illustrator to fix labels and spacing. Legends, callouts, and layout stay clean inside the editor.</span>
            </div>
            <div className="landing-pain-card">
              <strong>Update claims in seconds</strong>
              <span>Drop in a revised shapefile and your map layout — title, inset, north arrow, scale bar — stays intact. No rebuild required.</span>
            </div>
            <div className="landing-pain-card">
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
