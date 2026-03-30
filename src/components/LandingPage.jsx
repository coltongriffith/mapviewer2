import React from 'react';

export default function LandingPage({ onOpenEditor }) {
  return (
    <div className="landing-shell">
      <div className="landing-card">
        <div className="landing-badge">Built for junior mining teams</div>
        <h1>Create investor-ready mining maps without GIS bottlenecks.</h1>
        <p>
          Turn raw claim files, drillholes, and nearby property context into clean maps for news releases,
          decks, websites, and investor materials. Designed for geologists, IR teams, and marketing groups
          that need strong output fast.
        </p>
        <div className="landing-actions">
          <button className="btn primary large" type="button" onClick={onOpenEditor}>
            Open Map Editor
          </button>
        </div>
        <div className="landing-grid">
          <div className="landing-feature">
            <h3>Bring in your project data</h3>
            <p>Import zipped shapefiles or GeoJSON from your geologist or GIS workflow, then organize layers in one place.</p>
          </div>
          <div className="landing-feature">
            <h3>Style maps for marketing</h3>
            <p>Adjust claim colors, drillhole styling, labels, legends, logo placement, inset maps, and callouts without starting from scratch in GIS.</p>
          </div>
          <div className="landing-feature">
            <h3>Export for presentations</h3>
            <p>Produce cleaner map outputs for investor decks, website pages, fact sheets, and news releases in PNG or SVG.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
