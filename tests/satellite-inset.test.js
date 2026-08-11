import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { INSET_MODES } from '../src/projectState.js';

// The component and the exporter are coupled by one string — the container's
// class name. If either side is renamed, the inset renders perfectly on screen
// and comes out BLANK in the exported PDF, with nothing to indicate why. That
// is the same silent-divergence shape as the feature key in featureIdentity,
// and the same reason it is pinned here.

const component = readFileSync('src/components/SatelliteInset.jsx', 'utf8');
const exporter = readFileSync('src/export/renderScene.js', 'utf8');
const app = readFileSync('src/App.jsx', 'utf8');

describe('the satellite locator is reachable', () => {
  it('is offered as an inset mode', () => {
    expect(INSET_MODES.satellite_locator).toBeTruthy();
  });

  it('has a control that can select it', () => {
    expect(app).toMatch(/f-inset-mode/);
    expect(app).toMatch(/insetMode === 'satellite_locator'/);
  });

  it('offers an imagery choice only in this mode', () => {
    // A basemap picker beside the vector locator would do nothing.
    const block = app.slice(app.indexOf('f-inset-basemap') - 400, app.indexOf('f-inset-basemap') + 200);
    expect(block).toMatch(/insetMode === 'satellite_locator'/);
  });
});

describe('the screen and the export agree on where the tiles are', () => {
  it('uses the same container class on both sides', () => {
    const cls = /SATELLITE_INSET_CLASS = '([^']+)'/.exec(component)?.[1];
    expect(cls, 'the component no longer names its container').toBeTruthy();
    expect(
      exporter.includes(cls),
      `export/renderScene.js does not look for "${cls}" — the inset would export blank`,
    ).toBe(true);
  });

  it('captures tiles rather than re-fetching them', () => {
    // One pipeline, not two. A second tile fetch in the exporter would
    // eventually disagree with what the editor showed.
    expect(exporter).toMatch(/getTileImages\(container\)/);
  });

  it('falls back to the vector locator when there is nothing to capture', () => {
    // Better a province outline than an empty white panel in a client's deck.
    expect(exporter).toMatch(/drawSatelliteInsetCanvas/);
    expect(exporter).toMatch(/Fall through to the vector locator/);
  });

  it('redraws the extent box, which tile capture cannot see', () => {
    // Leaflet puts it in the overlay pane; getTileImages only reads the tile
    // pane. A locator without its marker is just a photograph.
    expect(exporter).toMatch(/leaflet-overlay-pane path/);
  });
});

describe('the inset shows what is on the map', () => {
  it('measures visible geometry, not trimmed geometry', () => {
    // Same rule as framing and the legend: a removed block must not stretch
    // the locator over ground the user deleted.
    expect(component).toMatch(/visibleGeojson\(l\)/);
  });

  it('keeps tiles as <img> so the exporter can read them', () => {
    // preferCanvas would render tiles the capture cannot find.
    expect(component).toMatch(/preferCanvas: false/);
  });

  it('requests tiles with CORS, or the export canvas is tainted', () => {
    expect(component).toMatch(/crossOrigin: true/);
  });

  it('always sets a view, even with no layers', () => {
    // A Leaflet map with no view is not empty, it is unusable, and later calls
    // against it throw.
    expect(component).toMatch(/map\.setView\(/);
  });

  it('reports a failing tile source like every other overlay', () => {
    expect(component).toMatch(/tileerror/);
    expect(component).toMatch(/reportError\(/);
  });
});
