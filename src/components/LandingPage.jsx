import React from 'react';

export default function LandingPage({ onOpenEditor }) {
  return (
    <div className="landing-shell">
      <div className="landing-card">
        <div className="landing-badge">Mapviewer</div>
        <h1>Marketing-ready mining maps, without GIS friction.</h1>
        <p>
          Upload a zipped shapefile or GeoJSON, style the map inside the editor, add labels and callouts,
          then export PNG or SVG.
        </p>
        <div className="landing-actions">
          <button className="btn primary large" type="button" onClick={onOpenEditor}>
            Open Map Editor
          </button>
        </div>
        <div className="landing-grid">
          <div className="landing-feature">
            <h3>Upload</h3>
            <p>Use the left panel in the editor to drag and drop a zipped shapefile or GeoJSON.</p>
          </div>
          <div className="landing-feature">
            <h3>Design</h3>
            <p>Assign layer roles, add your logo and inset, and click drillholes to create editable labels.</p>
          </div>
          <div className="landing-feature">
            <h3>Export</h3>
            <p>Export presentation-ready PNG or SVG output once the layout looks right.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
